# Anima Protocol — Phase 4: serve the steward's own model and let it learn.
#
# OpenAI-compatible chat completions (streaming or not) for the tiny-GPT
# checkpoint produced by training/phase3/dpo.py, plus lesson endpoints the app
# uses to correct it (see learning.py). The api-server routes a steward's chats
# here when "Answer my chats with my model" is on (Settings -> Model Tutor).
#
# Run (binds 127.0.0.1 only):
#   python server/server.py
# Test:
#   curl http://127.0.0.1:8000/v1/chat/completions \
#     -H "Content-Type: application/json" \
#     -d '{"model":"anima-own","messages":[{"role":"user","content":"Hello"}]}'
#
# To listen on other interfaces, set ANIMA_SERVER_TOKEN and ANIMA_HOST:
#   ANIMA_SERVER_TOKEN=... ANIMA_HOST=0.0.0.0 python server/server.py
# Clients then send Authorization: Bearer <token>.
#
# Environment:
#   ANIMA_CKPT         base checkpoint (default out/anima-dpo/ckpt.pt)
#   ANIMA_TOK_DIR      tokenizer dir (default data/anima_tokens)
#   ANIMA_LIVE_DIR     learned versions + lesson store (default out/anima-live)
#   ANIMA_MODEL_ID     model id reported to clients (default anima-own)
#   ANIMA_LEARNING     "off" disables the lesson endpoints (serving only)

import hmac
import json
import logging
import os
import time
import uuid
from pathlib import Path
from typing import Any

import torch
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

import _paths  # noqa: F401
import modeling
import sft
from learning import LessonError, LiveModel

ROOT = Path(__file__).resolve().parents[1]
log = logging.getLogger("anima.server")

# ----------------------------- Config -----------------------------

MAX_MESSAGES = 256
MAX_NEW_TOKENS = 512
DEFAULT_MAX_TOKENS = 256
MAX_BODY_BYTES = 4 * 1024 * 1024
MAX_SYNC_BODY_BYTES = 32 * 1024 * 1024
MAX_WAIT_SECONDS = 30.0

device = "cpu"
live: LiveModel | None = None


def checkpoint_path() -> str:
    override = os.environ.get("ANIMA_CKPT", "").strip()
    if override:
        return override
    return str(ROOT / "out" / "anima-dpo" / "ckpt.pt")


def live_dir() -> str:
    override = os.environ.get("ANIMA_LIVE_DIR", "").strip()
    if override:
        return override
    return str(ROOT / "out" / "anima-live")


def model_id() -> str:
    return os.environ.get("ANIMA_MODEL_ID", "").strip() or "anima-own"


def learning_enabled() -> bool:
    return os.environ.get("ANIMA_LEARNING", "on").strip().lower() not in {"0", "off", "false", "no"}


def server_token() -> str:
    return os.environ.get("ANIMA_SERVER_TOKEN", "").strip()


def resolve_host(host: str | None = None) -> str:
    if host is None:
        host = os.environ.get("ANIMA_HOST", "127.0.0.1")
    if host in {"0.0.0.0", "::", "[::]"} and not server_token():
        raise SystemExit(
            "Refusing to listen on all interfaces without ANIMA_SERVER_TOKEN. "
            "Use the default 127.0.0.1 bind, or set ANIMA_SERVER_TOKEN."
        )
    return host


def load_runtime():
    global live, device
    sft.init_tokenizer()
    path = checkpoint_path()
    if not os.path.isfile(path):
        raise SystemExit(f"checkpoint not found: {path} (set ANIMA_CKPT or train phase 3)")
    device = "cuda" if torch.cuda.is_available() else "cpu"
    live = LiveModel(path, live_dir(), device=device)
    n_params = sum(p.numel() for p in live.model.parameters()) / 1e6
    print(f"Anima serving: {n_params:.1f}M params on {device} (version {live.version}, "
          f"{len(live.lessons)} lessons stored)")


def serving_model():
    if live is None:
        raise HTTPException(status_code=503, detail="model is not loaded")
    return live.model


# ----------------------------- HTTP plumbing -----------------------------

class LimitBodyMiddleware:
    def __init__(self, app, max_bytes: int = MAX_BODY_BYTES, sync_max_bytes: int = MAX_SYNC_BODY_BYTES):
        self.app = app
        self.max_bytes = max_bytes
        self.sync_max_bytes = sync_max_bytes

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope.get("method") not in ("POST", "PUT", "PATCH"):
            await self.app(scope, receive, send)
            return
        path = scope.get("path", "")
        if not path.startswith("/v1/"):
            await self.app(scope, receive, send)
            return
        limit = self.sync_max_bytes if path == "/v1/lessons/sync" else self.max_bytes
        body = bytearray()
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            if message["type"] != "http.request":
                continue
            body.extend(message.get("body", b""))
            if len(body) > limit:
                raw = b'{"detail":"request too large","error":{"message":"request too large","type":"invalid_request_error"}}'
                await send({
                    "type": "http.response.start",
                    "status": 413,
                    "headers": [
                        [b"content-type", b"application/json"],
                        [b"content-length", str(len(raw)).encode()],
                    ],
                })
                await send({"type": "http.response.body", "body": raw})
                return
            if not message.get("more_body", False):
                break
        sent = False

        async def replay():
            nonlocal sent
            if sent:
                return await receive()
            sent = True
            return {"type": "http.request", "body": bytes(body), "more_body": False}

        await self.app(scope, replay, send)


app = FastAPI(title="Anima Protocol Model Server")
app.add_middleware(LimitBodyMiddleware)


def require_token(authorization: str | None = Header(default=None)):
    token = server_token()
    if not token:
        return
    if not hmac.compare_digest((authorization or "").encode(), f"Bearer {token}".encode()):
        raise HTTPException(status_code=401, detail="unauthorized")


@app.exception_handler(HTTPException)
async def _http_error(_request, exc: HTTPException):
    # `detail` for existing clients, `error.message` for OpenAI SDKs.
    return JSONResponse(
        {"detail": exc.detail, "error": {"message": str(exc.detail), "type": "invalid_request_error"}},
        status_code=exc.status_code,
    )


# ----------------------------- Chat -----------------------------

class ChatRequest(BaseModel):
    # OpenAI clients send many optional fields (tools, keep_alive, top_p, …).
    # Ignore what this model cannot use instead of rejecting the turn.
    model_config = ConfigDict(extra="ignore")

    model: str | None = Field(default=None, max_length=128)
    messages: list[Any] = Field(min_length=1, max_length=MAX_MESSAGES)
    temperature: float | None = None
    max_tokens: int | None = None
    max_completion_tokens: int | None = None
    stream: bool = False


def _max_tokens(req: ChatRequest) -> int:
    requested = req.max_completion_tokens or req.max_tokens or DEFAULT_MAX_TOKENS
    try:
        requested = int(requested)
    except (TypeError, ValueError):
        requested = DEFAULT_MAX_TOKENS
    return max(1, min(requested, MAX_NEW_TOKENS))


def _temperature(req: ChatRequest) -> float:
    return modeling.clamp_temperature(0.8 if req.temperature is None else req.temperature)


def _sse(payload: dict) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


def _stream_chat(model, prompt_ids, max_tokens, temperature, name):
    cid = "chatcmpl-" + uuid.uuid4().hex[:12]
    created = int(time.time())

    def chunk(delta, finish=None):
        return _sse({
            "id": cid,
            "object": "chat.completion.chunk",
            "created": created,
            "model": name,
            "choices": [{"index": 0, "delta": delta, "finish_reason": finish}],
        })

    yield chunk({"role": "assistant", "content": ""})
    count = 0

    def counted():
        nonlocal count
        for t in modeling.iter_reply_tokens(model, prompt_ids, max_tokens, temperature):
            count += 1
            yield t

    for delta in modeling.iter_text_deltas(counted()):
        yield chunk({"content": delta})
    yield chunk({}, "length" if count >= max_tokens else "stop")
    yield "data: [DONE]\n\n"


@app.get("/v1/models")
def list_models(_auth: None = Depends(require_token)):
    return {"object": "list", "data": [{"id": model_id(), "object": "model", "owned_by": "anima"}]}


@app.post("/v1/chat/completions")
def chat(req: ChatRequest, _auth: None = Depends(require_token)):
    model = serving_model()
    max_tokens = _max_tokens(req)
    temperature = _temperature(req)
    prompt_ids = modeling.fit_prompt(req.messages, modeling.prompt_budget(model.cfg.block_size, max_tokens))
    name = req.model or model_id()
    if req.stream:
        return StreamingResponse(
            _stream_chat(model, prompt_ids, max_tokens, temperature, name),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )
    text, n, hit_limit = modeling.generate_text(model, prompt_ids, max_tokens, temperature)
    return {
        "id": "chatcmpl-" + uuid.uuid4().hex[:12],
        "object": "chat.completion",
        "created": int(time.time()),
        "model": name,
        "choices": [{
            "index": 0,
            "message": {"role": "assistant", "content": text},
            "finish_reason": "length" if hit_limit else "stop",
        }],
        "usage": {
            "prompt_tokens": len(prompt_ids),
            "completion_tokens": n,
            "total_tokens": len(prompt_ids) + n,
        },
    }


# ----------------------------- Lessons -----------------------------

class LessonIn(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str | None = Field(default=None, max_length=80)
    messages: list[Any] = Field(default_factory=list, max_length=MAX_MESSAGES)
    chosen: Any = None
    rejected: Any = None
    created_at: float | None = None
    wait: float = Field(default=10.0, ge=0, le=MAX_WAIT_SECONDS)


class SyncIn(BaseModel):
    model_config = ConfigDict(extra="ignore")

    lessons: list[dict[str, Any]] = Field(default_factory=list)
    rebuild: bool = True
    wait: float = Field(default=0.0, ge=0, le=MAX_WAIT_SECONDS)


class WaitIn(BaseModel):
    model_config = ConfigDict(extra="ignore")

    wait: float = Field(default=10.0, ge=0, le=MAX_WAIT_SECONDS)


def learner() -> LiveModel:
    if not learning_enabled():
        raise HTTPException(status_code=403, detail="learning is disabled on this server (ANIMA_LEARNING=off)")
    if live is None:
        raise HTTPException(status_code=503, detail="model is not loaded")
    return live


def _job_response(job: dict | None):
    if job is None:
        raise HTTPException(status_code=404, detail="job not found")
    body = {
        "status": job["status"],
        "job_id": job["id"],
        "kind": job["kind"],
        "result": job.get("result"),
        "error": job.get("error"),
        "progress": job.get("progress"),
        "version": live.version if live else None,
    }
    if job["status"] == "failed":
        detail = job.get("error") or "learning failed"
        return JSONResponse(
            {**body, "detail": detail, "error": {"message": detail, "type": "learning_error"}},
            status_code=500,
        )
    return JSONResponse(body, status_code=200 if job["status"] == "done" else 202)


@app.post("/v1/lessons")
def teach(req: LessonIn, _auth: None = Depends(require_token)):
    model = learner()
    try:
        lesson = model.put_lesson(req.model_dump(exclude={"wait"}))
    except LessonError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    job_id = model.submit("learn", lesson["id"])
    return _job_response(model.wait(job_id, req.wait))


@app.get("/v1/lessons")
def lessons(_auth: None = Depends(require_token)):
    return {"lessons": learner().list_lessons()}


@app.get("/v1/lessons/status")
def lesson_status(_auth: None = Depends(require_token)):
    model = learner()
    return {"model": model_id(), "learning": True, **model.status()}


@app.get("/v1/lessons/jobs/{job_id}")
def lesson_job(job_id: str, _auth: None = Depends(require_token)):
    return _job_response(learner().job(job_id))


@app.delete("/v1/lessons/{lesson_id}")
def forget(lesson_id: str, _auth: None = Depends(require_token)):
    return learner().remove_lesson(lesson_id)


@app.post("/v1/lessons/sync")
def sync(req: SyncIn, _auth: None = Depends(require_token)):
    model = learner()
    try:
        count = model.replace_lessons(req.lessons)
    except LessonError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not req.rebuild:
        return {"status": "done", "lessons": count, "version": model.version}
    job_id = model.submit("rebuild")
    return _job_response(model.wait(job_id, req.wait))


@app.post("/v1/lessons/rollback")
def rollback(req: WaitIn | None = None, _auth: None = Depends(require_token)):
    model = learner()
    if not model.can_rollback():
        raise HTTPException(status_code=409, detail="nothing to roll back")
    job_id = model.submit("rollback")
    return _job_response(model.wait(job_id, (req or WaitIn()).wait))


@app.get("/health")
def health():
    return {"ok": live is not None, "version": live.version if live else None, "device": device}


if __name__ == "__main__":
    import uvicorn
    host = resolve_host()
    port = int(os.environ.get("PORT", "8000"))
    load_runtime()
    uvicorn.run(app, host=host, port=port)
else:
    # `uvicorn server:app` imports the module; fail fast if the checkpoint is missing.
    load_runtime()
