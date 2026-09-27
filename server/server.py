# Anima Protocol — Phase 4: local checkpoint preview.
# OpenAI-style chat completions for the tiny-GPT checkpoint produced by
# training/phase3/dpo.py. This is not the production anima-protocol.com
# chat path (that stays on the Cloudflare Worker and the self-hosted
# Ollama model).
#
# Run (binds 127.0.0.1 only):
#   python server/server.py
# Test:
#   curl http://127.0.0.1:8000/v1/chat/completions \
#     -H "Content-Type: application/json" \
#     -d '{"model":"anima","messages":[{"role":"user","content":"Hello"}]}'
#
# To listen on other interfaces, set ANIMA_SERVER_TOKEN and ANIMA_HOST:
#   ANIMA_SERVER_TOKEN=... ANIMA_HOST=0.0.0.0 python server/server.py
# Clients then send Authorization: Bearer <token>.

import math
import os
import sys
import time
import uuid
from pathlib import Path

import torch
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parents[1]
for _rel in ("training/phase1", "training/phase2"):
    _p = str(ROOT / _rel)
    if _p not in sys.path:
        sys.path.insert(0, _p)

import sft
from train import GPT, GPTConfig

# ----------------------------- Config -----------------------------

MAX_MESSAGES = 32
MAX_CONTENT_CHARS = 4000
MAX_NEW_TOKENS = 512
MAX_BODY_BYTES = 256 * 1024

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
    sft.init_tokenizer()
    path = checkpoint_path()
    if not os.path.isfile(path):
        raise SystemExit(f"checkpoint not found: {path} (set ANIMA_CKPT or train phase 3)")
    ckpt = torch.load(path, map_location="cpu", weights_only=True)
    cfg = GPTConfig(**ckpt["cfg"])
    model = GPT(cfg)
    model.load_state_dict(ckpt["model"])
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model.to(device).eval()
    n_params = sum(p.numel() for p in model.parameters()) / 1e6
    print(f"Anima serving: {n_params:.1f}M params on {device}")


# --------------------- Conversation encoding ---------------------
# Same layout as SFT/DPO, then a trailing <|anima|> so the model answers.

def _api_messages(messages):
    mapped = []
    for m in messages:
        role = m["role"]
        if role in ("anima", "assistant"):
            role = "anima"
        else:
            # user, system, and unknown roles stay context, not an Anima turn
            role = "user"
        mapped.append({"role": role, "content": m["content"]})
    return mapped


def encode(messages, max_tokens=None):
    """Prompt ids ending in <|anima|>, fitted to `max_tokens` by whole messages."""
    budget = cfg.block_size if max_tokens is None else max_tokens
    return sft.encode_prompt(_api_messages(messages), budget)


def _temperature(value: float) -> float:
    try:
        value = float(value)
    except (TypeError, ValueError):
        return 1e-5
    if not math.isfinite(value):
        return 1e-5
    return min(max(value, 1e-5), 2.0)


@torch.no_grad()
def generate_reply(messages, max_tokens=256, temperature=0.8, top_k=40, top_p=0.9):
    max_tokens = max(1, min(int(max_tokens), MAX_NEW_TOKENS))
    temperature = _temperature(temperature)
    # Reserve part of the window for the reply; the prompt keeps whole messages.
    reserve = min(max_tokens, cfg.block_size // 2)
    ids = encode(messages, cfg.block_size - reserve)
    idx = torch.tensor([ids], dtype=torch.long, device=device)
    out = []
    for _ in range(max_tokens):
        logits, _ = model(idx[:, -cfg.block_size:])
        nxt = sft.sample_next(logits[:, -1, :], out, temperature, top_k, top_p)
        t = nxt.item()
        if t == sft.eot_id or t in sft.role_ids.values():
            break
        out.append(t)
        idx = torch.cat([idx, nxt], dim=1)
    return sft.tok.decode(out)


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
                return {"type": "http.disconnect"}
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
    content: str = Field(max_length=MAX_CONTENT_CHARS)


class ChatRequest(BaseModel):
    model: str = Field(default="anima", max_length=64)
    messages: list[Msg] = Field(min_length=1, max_length=MAX_MESSAGES)
    temperature: float = Field(default=0.8, ge=0.0, le=2.0)
    top_p: float = Field(default=0.9, gt=0.0, le=1.0)
    max_tokens: int = Field(default=256, ge=1, le=MAX_NEW_TOKENS)
    stream: bool = False  # rejected; this server does not stream


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
    if req.stream:
        raise HTTPException(status_code=400, detail="streaming is not supported")
    reply = generate_reply(
        [m.model_dump() for m in req.messages],
        max_tokens=req.max_tokens,
        temperature=req.temperature,
        top_p=req.top_p,
    )
    return ChatResponse(
        id="chatcmpl-" + uuid.uuid4().hex[:12],
        created=int(time.time()),
        model=req.model,
        choices=[{
            "index": 0,
            "message": {"role": "assistant", "content": reply},
            "finish_reason": "stop",
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
