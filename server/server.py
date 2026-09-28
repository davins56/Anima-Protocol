# Anima Protocol — Phase 4: serve your own trained model.
# OpenAI-compatible chat completions (streaming and non-streaming) for the
# tiny-GPT checkpoint produced by training/phase3/dpo.py. The api-server can
# use it as the companion chat backend: set ANIMA_LOCAL_LLM_BACKEND=vllm (the
# generic OpenAI-compatible backend) and point ANIMA_LOCAL_LLM_BASE_URL at
# this server's /v1. See docs/custom-llm.md, "Your own trained model".
#
# Run (binds 127.0.0.1 only):
#   python server/server.py
# Test:
#   curl http://127.0.0.1:8000/v1/chat/completions \
#     -H "Content-Type: application/json" \
#     -d '{"model":"anima","messages":[{"role":"user","content":"Hello"}]}'
#
# ANIMA_CKPT and ANIMA_TOK_DIR override the checkpoint and tokenizer paths
# (defaults: out/anima-dpo/ckpt.pt and data/anima_tokens/).
#
# To listen on other interfaces, set ANIMA_SERVER_TOKEN and ANIMA_HOST:
#   ANIMA_SERVER_TOKEN=... ANIMA_HOST=0.0.0.0 python server/server.py
# Clients then send Authorization: Bearer <token>.

import json
import math
import os
import sys
import time
import uuid
from pathlib import Path
from typing import Any

import torch
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parents[1]
for _rel in ("training/phase1", "training/phase2"):
    _p = str(ROOT / _rel)
    if _p not in sys.path:
        sys.path.insert(0, _p)

import sft
from train import GPT, GPTConfig

# ----------------------------- Config -----------------------------

# Chat clients send whole companion prompts: a long system prompt, the full
# history, and sometimes inline images. Oversized input is trimmed to what
# the window can hold rather than rejected; these caps only bound the work.
MAX_REQUEST_MESSAGES = 512
MAX_CONTEXT_MESSAGES = 64
MAX_CONTENT_CHARS = 16000
MAX_NEW_TOKENS = 768
DEFAULT_MAX_TOKENS = 384
MAX_BODY_BYTES = 8 * 1024 * 1024
# A run-on sentence longer than this streams at a word boundary instead of
# waiting for its full stop.
STREAM_FLUSH_CHARS = 160

device = "cpu"
cfg = None
model = None


def checkpoint_path() -> str:
    override = os.environ.get("ANIMA_CKPT", "").strip()
    if override:
        return override
    return str(ROOT / "out" / "anima-dpo" / "ckpt.pt")


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
    global model, cfg, device
    sft.init_tokenizer(os.environ.get("ANIMA_TOK_DIR", "").strip() or None)
    path = checkpoint_path()
    if not os.path.isfile(path):
        raise SystemExit(f"checkpoint not found: {path} (set ANIMA_CKPT or train phase 3)")
    ckpt = torch.load(path, map_location="cpu", weights_only=True)
    cfg = GPTConfig(**ckpt["cfg"])
    model = GPT(cfg)
    model.load_state_dict(ckpt["model"])
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model.to(device).eval()
    sft.model, sft.cfg = model, cfg
    n_params = sum(p.numel() for p in model.parameters()) / 1e6
    print(f"Anima serving: {n_params:.1f}M params on {device}")


# --------------------- Conversation encoding ---------------------
# Same layout as SFT/DPO. sft.prompt_for_reply fits the history to the window
# on message boundaries and opens the <|anima|> turn; sampling uses the
# complete-thought rules (min length, repetition penalty, sentence stop).

def _message_text(content) -> str:
    """Text of an OpenAI message: a string, or the text parts of a content
    array. Image parts are dropped; this model reads text only."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for part in content:
            if isinstance(part, dict) and part.get("type") in ("text", "input_text"):
                text = part.get("text")
                if isinstance(text, str):
                    parts.append(text)
        return "\n".join(parts)
    return ""


def _api_messages(messages):
    mapped = []
    for m in messages[-MAX_CONTEXT_MESSAGES:]:
        text = _message_text(m.get("content"))
        if not text.strip():
            continue  # e.g. an assistant tool-call turn with content: null
        if m.get("role") in ("anima", "assistant"):
            role = "anima"
        else:
            # user, system, tool, and unknown roles stay context, not an Anima turn
            role = "user"
        mapped.append({"role": role, "content": text[-MAX_CONTENT_CHARS:]})
    return mapped


def _temperature(value: float) -> float:
    try:
        value = float(value)
    except (TypeError, ValueError):
        return 1e-5
    if not math.isfinite(value):
        return 1e-5
    return min(max(value, 1e-5), 2.0)


def _sampling(max_tokens=DEFAULT_MAX_TOKENS, temperature=0.8, top_k=40,
              repetition_penalty=1.15, min_tokens=8):
    return {
        "max_new_tokens": max(1, min(int(max_tokens), MAX_NEW_TOKENS)),
        "temperature": _temperature(temperature),
        "top_k": top_k,
        "repetition_penalty": repetition_penalty,
        "min_new_tokens": min_tokens,
    }


def _sentence_end(text: str) -> int:
    """Index just past the last sentence end, as sft.trim_to_sentence finds it."""
    best = 0
    for end in sft.SENTENCE_END:
        idx = text.rfind(end)
        if idx >= 0:
            best = max(best, idx + len(end))
    return best


def stream_reply(prompt_ids, max_new_tokens, temperature, top_k, **kw):
    """Yield reply text as it is sampled; the return value is the finish_reason.

    Text goes out a sentence at a time so the result matches the
    non-streaming reply: a length-capped reply is still cut back to its last
    finished sentence, and that cut only ever falls on text not yet sent. A
    run-on sentence past STREAM_FLUSH_CHARS goes out at a word boundary so
    the client is never left waiting on one long silence.
    """
    steps = sft.iter_tokens(prompt_ids, max_new_tokens, temperature, top_k, **kw)
    tokens, sent = [], ""
    while True:
        try:
            tokens.append(next(steps))
        except StopIteration as done:
            finish_reason = done.value
            break
        text = sft.tok.decode(tokens).lstrip()
        cut = _sentence_end(text)
        if cut <= len(sent) and len(text) - len(sent) > STREAM_FLUSH_CHARS:
            cut = text.rfind(" ", len(sent) + 1)
        if cut > len(sent) and text.startswith(sent):
            yield text[len(sent):cut]
            sent = text[:cut]
    final = sft.tok.decode(tokens).strip()
    if finish_reason == "length":
        final = sft.trim_to_sentence(final)
    if len(final) > len(sent) and final.startswith(sent):
        yield final[len(sent):]
    return finish_reason


def _sse_chunks(deltas, completion_id: str, created: int, model_name: str):
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
            text = next(deltas)
        except StopIteration as done:
            finish_reason = done.value or "stop"
            break
        yield event({"content": text})
    yield event({}, finish_reason)
    yield "data: [DONE]\n\n"


# --------------------- API ---------------------

class LimitBodyMiddleware:
    def __init__(self, app, max_bytes: int = MAX_BODY_BYTES):
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope.get("method") not in ("POST", "PUT", "PATCH"):
            await self.app(scope, receive, send)
            return
        if not scope.get("path", "").startswith("/v1/"):
            await self.app(scope, receive, send)
            return
        body = bytearray()
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            if message["type"] != "http.request":
                continue
            body.extend(message.get("body", b""))
            if len(body) > self.max_bytes:
                raw = b'{"detail":"request too large"}'
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
    if authorization != f"Bearer {token}":
        raise HTTPException(status_code=401, detail="unauthorized")


class Msg(BaseModel):
    role: str = Field(max_length=32)
    # A string, OpenAI content parts, or null (assistant tool-call turns).
    content: str | list[dict[str, Any]] | None = None


class ChatRequest(BaseModel):
    model: str = Field(default="anima", max_length=128)
    messages: list[Msg] = Field(min_length=1, max_length=MAX_REQUEST_MESSAGES)
    temperature: float = Field(default=0.8, ge=0.0, le=2.0)
    # Clamped to MAX_NEW_TOKENS rather than rejected: OpenAI clients send
    # whatever budget they would give a hosted model.
    max_tokens: int | None = Field(default=None, ge=1)
    max_completion_tokens: int | None = Field(default=None, ge=1)
    repetition_penalty: float = Field(default=1.15, ge=1.0, le=2.0)
    min_tokens: int = Field(default=8, ge=0, le=128)
    stream: bool = False


class ChatResponse(BaseModel):
    id: str
    object: str = "chat.completion"
    created: int
    model: str
    choices: list[dict]


@app.get("/v1/models")
def list_models(_auth: None = Depends(require_token)):
    return {"object": "list", "data": [{"id": "anima", "object": "model"}]}


@app.post("/v1/chat/completions", response_model=ChatResponse)
def chat(req: ChatRequest, _auth: None = Depends(require_token)):
    messages = _api_messages([m.model_dump() for m in req.messages])
    if not messages:
        raise HTTPException(status_code=400, detail="messages carry no text for this model to read")
    sampling = _sampling(
        max_tokens=req.max_tokens or req.max_completion_tokens or DEFAULT_MAX_TOKENS,
        temperature=req.temperature,
        repetition_penalty=req.repetition_penalty,
        min_tokens=req.min_tokens,
    )
    completion_id = "chatcmpl-" + uuid.uuid4().hex[:12]
    created = int(time.time())
    if req.stream:
        # Fit the prompt before the 200 goes out so a bad request still gets
        # a real status code instead of a broken stream.
        prompt_ids = sft.prompt_for_reply(messages, sampling["max_new_tokens"])
        return StreamingResponse(
            _sse_chunks(stream_reply(prompt_ids, **sampling), completion_id, created, req.model),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )
    reply, finish_reason = sft.generate_reply(messages, **sampling)
    return ChatResponse(
        id=completion_id,
        created=created,
        model=req.model,
        choices=[{
            "index": 0,
            "message": {"role": "assistant", "content": reply},
            "finish_reason": finish_reason,
        }],
    )


@app.get("/health")
def health():
    return {"ok": True, "checkpoint": checkpoint_path(), "device": device}


@app.exception_handler(HTTPException)
async def _http_error(_request, exc: HTTPException):
    return JSONResponse({"detail": exc.detail}, status_code=exc.status_code)


if __name__ == "__main__":
    import uvicorn
    host = resolve_host()
    port = int(os.environ.get("PORT", "8000"))
    load_runtime()
    uvicorn.run(app, host=host, port=port)
else:
    # `uvicorn server:app` imports the module; fail fast if the checkpoint is missing.
    load_runtime()
