# Anima Protocol — Phase 4: serving layer.
# Wraps the trained checkpoint in an OpenAI-compatible chat completions
# API so the Anima Protocol app can use it with just a base-URL change.
#
# Run:  uvicorn server:app --host 0.0.0.0 --port 8000
# Test: curl http://localhost:8000/v1/chat/completions \
#         -H "Content-Type: application/json" \
#         -d '{"model":"anima","messages":[{"role":"user","content":"Hello"}]}'
#
# The app side needs exactly one change:
#   baseURL: http://localhost:8000/v1   apiKey: anything

import os
import pickle
import time
import uuid

import torch
import torch.nn.functional as F
from fastapi import FastAPI
from pydantic import BaseModel
from typing import List, Literal

from train import GPT, GPTConfig

# ----------------------------- Config -----------------------------

CKPT = os.environ.get("ANIMA_CKPT", "out/anima-dpo/ckpt.pt")
TOK_DIR = "data/anima_tokens"
device = "cuda" if torch.cuda.is_available() else "cpu"


# --------------------- Load tokenizer + model ---------------------

with open(os.path.join(TOK_DIR, "tokenizer.json")) as f:
    from tokenizers import Tokenizer
    tok = Tokenizer.from_str(f.read())
with open(os.path.join(TOK_DIR, "meta.pkl"), "rb") as f:
    meta = pickle.load(f)

role_ids = {r: tok.token_to_id(s) for r, s in
            {"user": meta["special"]["user"], "anima": meta["special"]["anima"]}.items()}
eot_id = tok.token_to_id(meta["special"]["endoftext"])

ckpt = torch.load(CKPT, map_location="cpu")
cfg = GPTConfig(**ckpt["cfg"])
model = GPT(cfg)
model.load_state_dict(ckpt["model"])
model.to(device).eval()
print(f"Anima serving: {sum(p.numel() for p in model.parameters())/1e6:.1f}M params on {device}")


# --------------------- Conversation encoding ---------------------
# Mirrors the SFT/DPO format: <eot> <user> text <anima> ...

def encode(messages):
    ids = [eot_id]
    for m in messages:
        rid = role_ids.get(m["role"], role_ids["user"])
        ids.append(rid)
        ids.extend(tok.encode(m["content"]).ids)
        ids.append(eot_id)
    # end by asking for Anima's turn
    ids.append(role_ids["anima"])
    return ids


@torch.no_grad()
def generate_reply(messages, max_tokens=256, temperature=0.8, top_k=40):
    ids = encode(messages)
    idx = torch.tensor([ids[-cfg.block_size:]], device=device)
    out = []
    for _ in range(max_tokens):
        logits, _ = model(idx[:, -cfg.block_size:])
        logits = logits[:, -1, :] / max(temperature, 1e-5)
        if top_k:
            v, _ = torch.topk(logits, top_k)
            logits[logits < v[:, [-1]]] = float("-inf")
        probs = F.softmax(logits, dim=-1)
        nxt = torch.multinomial(probs, 1)
        t = nxt.item()
        if t == eot_id or t in role_ids.values():
            break
        out.append(t)
        idx = torch.cat([idx, nxt], dim=1)
    return tok.decode(out)


# --------------------- API ---------------------

app = FastAPI(title="Anima Protocol Model Server")


class Msg(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    model: str = "anima"
    messages: List[Msg]
    temperature: float = 0.8
    max_tokens: int = 256
    stream: bool = False  # accepted; non-streaming response returned


class ChatResponse(BaseModel):
    id: str
    object: str = "chat.completion"
    created: int
    model: str
    choices: List[dict]


@app.get("/v1/models")
def list_models():
    return {"object": "list", "data": [{"id": "anima", "object": "model"}]}


@app.post("/v1/chat/completions", response_model=ChatResponse)
def chat(req: ChatRequest):
    t0 = time.time()
    reply = generate_reply(
        [m.dict() for m in req.messages],
        max_tokens=req.max_tokens,
        temperature=req.temperature,
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
    return {"ok": True, "checkpoint": CKPT, "device": device}

# Deployment notes:
# - Free-tier-friendly: this serves fine on a Colab T4 for a single user
#   (use ngrok/cloudflared to expose it). ~10M params = fast on CPU too.
# - For real users later: export to GGUF and serve with llama.cpp, or
#   quantize + serve on a $5 VPS. The /v1/* contract stays identical,
#   so the app never changes.
# - Add auth (a static bearer token check in 'chat') before any public URL.
