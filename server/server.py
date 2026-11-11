# Anima Protocol — Phase 4: serve your own trained model.
# OpenAI-compatible chat completions (streaming and non-streaming) for the
# tiny-GPT checkpoint produced by training/phase3/dpo.py. The api-server can
# use it as the companion chat backend: set ANIMA_LOCAL_LLM_BACKEND=vllm (the
# generic OpenAI-compatible backend) and point ANIMA_LOCAL_LLM_BASE_URL at
# this server's /v1. See docs/custom-llm.md, "Your own trained model".
#
# It also speaks Ollama's native API (/api/chat, /api/generate, /api/tags,
# /api/ps, /api/show, /api/version), so ANIMA_LOCAL_LLM_BACKEND=ollama works
# against it too, with Ollama's sampler options and Modelfile defaults
# (server/Modelfile; see sampling.py and modelfile.py).
#
# Run (binds 127.0.0.1 only):
#   python server/server.py
# Test:
#   curl http://127.0.0.1:8000/v1/chat/completions \
#     -H "Content-Type: application/json" \
#     -d '{"model":"anima-own","messages":[{"role":"user","content":"Hello"}]}'
#
# ANIMA_CKPT and ANIMA_TOK_DIR override the checkpoint and tokenizer paths
# (defaults: out/anima-dpo/ckpt.pt and data/anima_tokens/).
#
# To listen on other interfaces, set ANIMA_SERVER_TOKEN and ANIMA_HOST:
#   ANIMA_SERVER_TOKEN=... ANIMA_HOST=0.0.0.0 python server/server.py
# Clients then send Authorization: Bearer <token>.

import hashlib
import hmac
import json
import logging
import os
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import torch
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

ROOT = Path(__file__).resolve().parents[1]
for _rel in ("training/phase1", "training/phase2"):
    _p = str(ROOT / _rel)
    if _p not in sys.path:
        sys.path.insert(0, _p)

import _paths  # noqa: F401
import modelfile as modelfile_lib
import modeling
import sampling
import sft
from learning import LessonError, LiveModel
from modelfile import Modelfile

ROOT = Path(__file__).resolve().parents[1]
log = logging.getLogger("anima.server")

# ----------------------------- Config -----------------------------

# Chat clients send whole companion prompts: a long system prompt, the full
# history, and sometimes inline images. Oversized input is trimmed to what
# the window can hold rather than rejected; these caps only bound the work.
MAX_REQUEST_MESSAGES = 512
MAX_CONTEXT_MESSAGES = 64
# A 5 MiB chat body is rejected (see the model-server suite). Lesson sync
# can carry the whole taught set, so it gets a larger cap.
MAX_BODY_BYTES = 4 * 1024 * 1024
MAX_SYNC_BODY_BYTES = 32 * 1024 * 1024
MAX_MESSAGES = 512
MAX_WAIT_SECONDS = 120
# Ollama reports a model loaded with keep_alive -1 as expiring at this time.
NEVER_EXPIRES = "2318-11-11T00:00:00Z"

device = "cpu"
live: LiveModel | None = None
modelfile = Modelfile()
started_at = time.time()
last_warm_ns = 0


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


def warmup_enabled() -> bool:
    return os.environ.get("ANIMA_WARMUP", "on").strip().lower() not in {"0", "off", "false", "no"}


def model_names() -> list[str]:
    """The served name plus ANIMA_MODEL_ALIASES (comma separated).

    The api-server checks its ANIMA_OLLAMA_MODEL_STANDARD against /api/tags;
    an alias lets that existing tag (e.g. anima-chat) find this model.
    """
    names = [model_id()]
    for alias in os.environ.get("ANIMA_MODEL_ALIASES", "").split(","):
        alias = alias.strip()
        if alias and alias not in names:
            names.append(alias)
    return names


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


def _bind_serving_model() -> None:
    """The sampler reads sft.model. Point it at the weights being served now.

    Learning replaces live.model with a new object, so this has to run on
    each request rather than once at startup.
    """
    if live is None:
        return
    sft.model = live.model
    sft.cfg = live.cfg


def load_runtime():
    global live, device, modelfile
    modelfile = modelfile_lib.load()
    sft.init_tokenizer(os.environ.get("ANIMA_TOK_DIR", "").strip() or None)
    path = checkpoint_path()
    if not os.path.isfile(path):
        raise SystemExit(f"checkpoint not found: {path} (set ANIMA_CKPT or train phase 3)")
    device = "cuda" if torch.cuda.is_available() else "cpu"
    live = LiveModel(path, live_dir(), device=device)
    model = _serving_model()
    n_params = sum(p.numel() for p in model.parameters()) / 1e6
    print(f"Anima serving: {n_params:.1f}M params on {device}")
    if warmup_enabled():
        _warm()


def _serving_model():
    """The weights being served now.

    Learning swaps in a new module; a snapshot taken at startup would keep
    answering with the weights from before the lesson. A reply holds on to
    the module it started with, so a lesson landing mid-stream cannot change
    the weights under it.
    """
    if live is None:
        raise HTTPException(status_code=503, detail="model is not loaded")
    sft.model = live.model
    sft.cfg = live.cfg
    return live.model


# --------------------- Conversation encoding ---------------------
# Same layout as SFT/DPO: <|endoftext|> <|user|> … <|anima|> …. The prompt
# is fitted on message boundaries (modeling.fit_chat_prompt): the newest turn
# first, then the system prompt, then older history, the way Ollama trims a
# full window. Sampling lives in sampling.py; streaming and non-streaming
# replies share one generator, so a seed gives the same text either way.

def _prepare_messages(messages) -> list[dict]:
    """Request messages plus the Modelfile's SYSTEM and MESSAGE defaults.

    Like Ollama, the Modelfile SYSTEM only applies when the request has no
    system message of its own, and MESSAGE turns go before the conversation.
    """
    msgs = [m for m in modeling.normalize_messages(messages) if m["content"].strip()]
    dialogue = [m for m in msgs if m["role"] != "system"][-MAX_CONTEXT_MESSAGES:]
    system = [m for m in msgs if m["role"] == "system"]
    if not dialogue:
        raise HTTPException(status_code=400, detail="messages carry no text for this model to read")
    if not system and modelfile.system:
        system = [{"role": "system", "content": modelfile.system}]
    examples = modeling.normalize_messages(modelfile.messages)
    return [*system, *examples, *dialogue]


def _options(overrides: dict | None) -> sampling.SamplingOptions:
    """Built-in defaults, then Modelfile PARAMETERs, then the request."""
    return sampling.merge_options(
        sampling.merge_options(sampling.SamplingOptions(), modelfile.parameters),
        overrides,
    )


class _Turn:
    """One reply: the weights, the fitted prompt and the sampler it uses."""

    def __init__(self, messages, overrides: dict | None):
        self.model = _serving_model()
        self.options = _options(overrides)
        window = sampling.context_window(self.model, self.options)
        self.fit = modeling.fit_chat_prompt(
            _prepare_messages(messages),
            modeling.prompt_budget(window, self.options.num_predict),
        )
        self.stats = sampling.ReplyStats()

    def pieces(self):
        return sampling.reply_pieces(self.model, self.fit.ids, self.options, self.stats)

    def text(self) -> str:
        return "".join(self.pieces())


def _openai_overrides(req) -> dict:
    """OpenAI fields (plus the usual top_k / min_p extensions) as options."""
    fields = req.model_dump(exclude_none=True)
    out = {k: fields[k] for k in (
        "temperature", "top_p", "top_k", "min_p", "repetition_penalty", "repeat_penalty",
        "repeat_last_n", "presence_penalty", "frequency_penalty", "seed", "stop", "min_tokens",
    ) if k in fields}
    budget = req.max_tokens or req.max_completion_tokens
    if budget:
        out["num_predict"] = budget
    return out


# --------------------- API ---------------------

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
        if not path.startswith(("/v1/", "/api/")):
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
                # Wait on the real connection. A synthetic disconnect here
                # makes StreamingResponse cancel the stream before it starts.
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


class Msg(BaseModel):
    model_config = ConfigDict(extra="ignore")

    role: str = Field(max_length=32)
    # A string, OpenAI content parts, or null (assistant tool-call turns).
    content: str | list[dict[str, Any]] | None = None

# ----------------------------- Chat -----------------------------

class ChatRequest(BaseModel):
    """OpenAI chat completions. Unset fields fall back to the Modelfile."""

    model_config = ConfigDict(extra="ignore")

    model: str = Field(default="anima", max_length=128)
    messages: list[Msg] = Field(min_length=1, max_length=MAX_REQUEST_MESSAGES)
    temperature: float | None = Field(default=None, ge=0.0, le=2.0)
    top_p: float | None = Field(default=None, ge=0.0, le=1.0)
    top_k: int | None = Field(default=None, ge=0)
    min_p: float | None = Field(default=None, ge=0.0, le=1.0)
    # Clamped to the sampler's ceiling rather than rejected: OpenAI clients
    # send whatever budget they would give a hosted model.
    max_tokens: int | None = Field(default=None, ge=1)
    max_completion_tokens: int | None = Field(default=None, ge=1)
    repetition_penalty: float | None = Field(default=None, ge=0.0, le=2.0)
    repeat_last_n: int | None = Field(default=None, ge=-1)
    presence_penalty: float | None = Field(default=None, ge=-2.0, le=2.0)
    frequency_penalty: float | None = Field(default=None, ge=-2.0, le=2.0)
    seed: int | None = None
    stop: str | list[str] | None = None
    # 0 lets the model end on its stop token. A higher floor is for callers
    # that want to block one-word fragments; the default must not force a
    # short taught reply to keep talking past its stop.
    min_tokens: int | None = Field(default=None, ge=0, le=128)
    stream: bool = False


class ChatResponse(BaseModel):
    id: str
    object: str = "chat.completion"
    created: int
    model: str
    choices: list[dict[str, Any]]
    usage: dict[str, int]


def _openai_sse(pieces, completion_id: str, created: int, model_name: str):
    """OpenAI chat.completion.chunk events, ending with data: [DONE]."""
    def event(delta, finish_reason=None):
        chunk = {
            "id": completion_id,
            "object": "chat.completion.chunk",
            "created": created,
            "model": model_name,
            "choices": [{"index": 0, "delta": delta, "finish_reason": finish_reason}],
        }
        return f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n"

    # The role chunk goes out before any sampling so the client sees the
    # stream open right away.
    yield event({"role": "assistant", "content": ""})
    while True:
        try:
            text = next(pieces)
        except StopIteration as done:
            finish_reason = (done.value.finish_reason if done.value else None) or "stop"
            break
        yield event({"content": text})
    yield event({}, finish_reason)
    yield "data: [DONE]\n\n"


@app.get("/v1/models")
def list_models(_auth: None = Depends(require_token)):
    return {
        "object": "list",
        "data": [{"id": name, "object": "model", "owned_by": "anima"} for name in model_names()],
    }


@app.post("/v1/chat/completions")
def chat(req: ChatRequest, _auth: None = Depends(require_token)):
    # Fit the prompt before the 200 goes out so a bad request still gets
    # a real status code instead of a broken stream.
    turn = _Turn([m.model_dump() for m in req.messages], _openai_overrides(req))
    completion_id = "chatcmpl-" + uuid.uuid4().hex[:12]
    created = int(time.time())
    if req.stream:
        return StreamingResponse(
            _openai_sse(turn.pieces(), completion_id, created, req.model),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )
    reply = turn.text()
    stats = turn.stats
    return ChatResponse(
        id=completion_id,
        created=created,
        model=req.model,
        choices=[{
            "index": 0,
            "message": {"role": "assistant", "content": reply},
            "finish_reason": stats.finish_reason,
        }],
        usage={
            "prompt_tokens": stats.prompt_tokens,
            "completion_tokens": stats.completion_tokens,
            "total_tokens": stats.prompt_tokens + stats.completion_tokens,
        },
    )


# ------------------------- Ollama-native API -------------------------
# /api/chat, /api/generate, /api/tags, /api/ps, /api/show and /api/version,
# so the api-server's Ollama adapter (ANIMA_LOCAL_LLM_BACKEND=ollama), its
# health probes and its app-open warm-up work against this model unchanged.
# Responses follow Ollama: newline-delimited JSON when streaming (the
# default), durations in nanoseconds, and an empty prompt loads the model.

class OllamaMessage(BaseModel):
    model_config = ConfigDict(extra="ignore")

    role: str = Field(max_length=32)
    content: str | None = ""
    # images, tool_calls and thinking are accepted and ignored: this model
    # reads text only.


class OllamaChatIn(BaseModel):
    model_config = ConfigDict(extra="ignore")

    model: str = Field(default="", max_length=128)
    messages: list[OllamaMessage] = Field(default_factory=list, max_length=MAX_REQUEST_MESSAGES)
    stream: bool = True
    options: dict[str, Any] | None = None
    # Accepted for compatibility. The weights stay resident for the life of
    # the process, so there is nothing to unload.
    keep_alive: str | int | float | None = None


class OllamaGenerateIn(BaseModel):
    model_config = ConfigDict(extra="ignore")

    model: str = Field(default="", max_length=128)
    prompt: str = ""
    system: str | None = None
    stream: bool = True
    options: dict[str, Any] | None = None
    keep_alive: str | int | float | None = None


class OllamaShowIn(BaseModel):
    model_config = ConfigDict(extra="ignore")

    model: str = Field(default="", max_length=128)
    name: str = Field(default="", max_length=128)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _ollama_name(requested: str) -> str:
    return requested.strip() or model_id()


def _warm() -> int:
    global last_warm_ns
    last_warm_ns = sampling.warm(_serving_model())
    return last_warm_ns


def _done_fields(turn: _Turn, total_ns: int) -> dict:
    stats = turn.stats
    return {
        "done": True,
        "done_reason": stats.finish_reason,
        "total_duration": total_ns,
        "load_duration": 0,
        "prompt_eval_count": stats.prompt_tokens,
        "prompt_eval_duration": stats.prompt_ns,
        "eval_count": stats.completion_tokens,
        "eval_duration": stats.eval_ns,
    }


def _ndjson(payloads):
    for payload in payloads:
        yield json.dumps(payload, ensure_ascii=False) + "\n"


def _ollama_reply(turn: _Turn, name: str, stream: bool, shape):
    """Stream or return one reply. `shape(text)` is the per-chunk body."""
    started = time.perf_counter_ns()
    if not stream:
        text = turn.text()
        return {"model": name, "created_at": _now_iso(), **shape(text),
                **_done_fields(turn, time.perf_counter_ns() - started)}

    def events():
        try:
            for piece in turn.pieces():
                yield {"model": name, "created_at": _now_iso(), **shape(piece), "done": False}
        except Exception as exc:  # the 200 already went out; say why in-band
            log.exception("ollama stream failed")
            yield {"error": str(exc) or exc.__class__.__name__}
            return
        yield {"model": name, "created_at": _now_iso(), **shape(""),
               **_done_fields(turn, time.perf_counter_ns() - started)}

    return StreamingResponse(_ndjson(events()), media_type="application/x-ndjson")


def _load_reply(name: str, shape) -> dict:
    """Ollama's answer to an empty request: the model is loaded and warm."""
    warm_ns = _warm()
    return {"model": name, "created_at": _now_iso(), **shape(""),
            "done": True, "done_reason": "load", "total_duration": warm_ns, "load_duration": warm_ns}


@app.post("/api/chat")
def ollama_chat(req: OllamaChatIn, _auth: None = Depends(require_token)):
    name = _ollama_name(req.model)

    def shape(text):
        return {"message": {"role": "assistant", "content": text}}

    if not req.messages:
        return _load_reply(name, shape)
    turn = _Turn([m.model_dump() for m in req.messages], req.options)
    return _ollama_reply(turn, name, req.stream, shape)


@app.post("/api/generate")
def ollama_generate(req: OllamaGenerateIn, _auth: None = Depends(require_token)):
    name = _ollama_name(req.model)

    def shape(text):
        return {"response": text}

    if not req.prompt.strip():
        return _load_reply(name, shape)
    messages = [{"role": "user", "content": req.prompt}]
    if req.system:
        messages.insert(0, {"role": "system", "content": req.system})
    turn = _Turn(messages, req.options)
    return _ollama_reply(turn, name, req.stream, shape)


def _checkpoint_bytes() -> int:
    try:
        return os.path.getsize(checkpoint_path())
    except OSError:
        return 0


def _details() -> dict:
    model = _serving_model()
    params = sum(p.numel() for p in model.parameters())
    return {
        "format": "pytorch",
        "family": "anima-gpt",
        "families": ["anima-gpt"],
        "parameter_size": f"{params / 1e6:.1f}M",
        "quantization_level": "F32",
    }


def _digest() -> str:
    version = live.version if live else 0
    return hashlib.sha256(f"{checkpoint_path()}:{version}".encode()).hexdigest()


def _model_entries(extra: dict | None = None) -> list[dict]:
    try:
        modified = datetime.fromtimestamp(os.path.getmtime(checkpoint_path()), timezone.utc)
    except OSError:
        modified = datetime.fromtimestamp(started_at, timezone.utc)
    details, size, digest = _details(), _checkpoint_bytes(), _digest()
    return [{
        "name": f"{name}:latest" if ":" not in name else name,
        "model": f"{name}:latest" if ":" not in name else name,
        "modified_at": modified.isoformat().replace("+00:00", "Z"),
        "size": size,
        "digest": digest,
        "details": {"parent_model": "", **details},
        **(extra or {}),
    } for name in model_names()]


@app.get("/api/version")
def ollama_version():
    version = live.version if live else 0
    return {"version": f"anima-own-{version}"}


@app.get("/api/tags")
def ollama_tags(_auth: None = Depends(require_token)):
    return {"models": _model_entries()}


@app.get("/api/ps")
def ollama_ps(_auth: None = Depends(require_token)):
    # The weights are loaded once at startup and never evicted.
    vram = _checkpoint_bytes() if device == "cuda" else 0
    return {"models": _model_entries({"expires_at": NEVER_EXPIRES, "size_vram": vram})}


@app.post("/api/show")
def ollama_show(req: OllamaShowIn, _auth: None = Depends(require_token)):
    model = _serving_model()
    cfg = model.cfg
    options = _options(None)
    parameters = modelfile.parameter_lines() or "\n".join(
        f"{k:<20}{getattr(options, k)}" for k in
        ("temperature", "top_k", "top_p", "min_p", "repeat_penalty", "repeat_last_n", "num_predict")
    )
    source = modelfile.source or f"FROM {checkpoint_path()}\n"
    return {
        "modelfile": source,
        "parameters": parameters,
        "template": modelfile.template or "<|endoftext|><|user|>{{ .Prompt }}<|endoftext|><|anima|>",
        "system": modelfile.system or "",
        "details": {"parent_model": "", **_details()},
        "model_info": {
            "general.architecture": "anima-gpt",
            "general.parameter_count": sum(p.numel() for p in model.parameters()),
            "anima-gpt.context_length": int(cfg.block_size),
            "anima-gpt.embedding_length": int(cfg.n_embd),
            "anima-gpt.block_count": int(cfg.n_layer),
            "anima-gpt.attention.head_count": int(cfg.n_head),
            "anima-gpt.vocab_size": int(cfg.vocab_size),
        },
        "capabilities": ["completion"],
        "modified_at": _model_entries()[0]["modified_at"],
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
    return {
        "ok": live is not None,
        "version": live.version if live else None,
        "device": device,
        "warm_ms": round(last_warm_ns / 1e6, 2) if last_warm_ns else None,
        "modelfile": modelfile.path,
    }


if __name__ == "__main__":
    import uvicorn
    host = resolve_host()
    port = int(os.environ.get("PORT", "8000"))
    load_runtime()
    uvicorn.run(app, host=host, port=port)
else:
    # `uvicorn server:app` imports the module; fail fast if the checkpoint is missing.
    load_runtime()
