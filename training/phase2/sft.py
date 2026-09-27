# Anima Protocol — Phase 2: SFT (supervised fine-tuning).
# Teaches the pretrained checkpoint to converse in Anima's voice using
# the reserved role tokens (from Phase 1's tokenizer).
# Expects a JSONL dataset of conversations:
#   {"messages": [{"role": "user", "content": "..."}, {"role": "anima", "content": "..."}]}
# Same Colab T4 that ran Phase 1 is fine.

import json
import os
import random
import sys
from pathlib import Path

import torch
import torch.nn as nn
import torch.nn.functional as F

ROOT = Path(__file__).resolve().parents[2]
for _sub in ("phase1",):
    _p = str(ROOT / "training" / _sub)
    if _p not in sys.path:
        sys.path.insert(0, _p)

from train import GPT, GPTConfig  # reuse the Phase 1 model

# ----------------------------- Config -----------------------------

SFT_DATA = str(ROOT / "data" / "sft" / "anima_dialogues.jsonl")
CKPT_PATH = str(ROOT / "out" / "anima-tiny" / "ckpt.pt")
TOK_DIR = str(ROOT / "data" / "anima_tokens")
OUT_DIR = str(ROOT / "out" / "anima-sft")
MAX_EXAMPLES = 20000
EPOCHS = 3
BATCH_SIZE = 32
LR = 1e-4

_SPECIAL_STRINGS = ("<|endoftext|>", "<|user|>", "<|anima|>")

# Filled by init_tokenizer(). Importing this module does not load weights.
tok = None
role_ids = {}
eot_id = None
model = None
cfg = None


def init_tokenizer(tok_dir=None):
    """Load the Phase 1 tokenizer. Safe to call more than once."""
    global tok, role_ids, eot_id
    if tok is not None and tok_dir is None:
        return tok
    tok_dir = tok_dir or TOK_DIR
    meta_path = os.path.join(tok_dir, "meta.json")
    tok_path = os.path.join(tok_dir, "tokenizer.json")
    if not os.path.isfile(meta_path) or not os.path.isfile(tok_path):
        raise SystemExit(f"missing tokenizer in {tok_dir}; run training/phase1/data_pipeline.py")
    with open(meta_path, encoding="utf-8") as f:
        meta = json.load(f)
    from tokenizers import Tokenizer
    with open(tok_path, encoding="utf-8") as f:
        tok = Tokenizer.from_str(f.read())
    roles = {"user": meta["special"]["user"], "anima": meta["special"]["anima"]}
    role_ids = {r: tok.token_to_id(s) for r, s in roles.items()}
    eot_id = tok.token_to_id(meta["special"]["endoftext"])
    if any(v is None for v in role_ids.values()) or eot_id is None:
        raise SystemExit("role tokens missing from tokenizer")
    return tok


def _role_token_id(role: str) -> int:
    if role in ("anima", "assistant"):
        return role_ids["anima"]
    if role == "user":
        return role_ids["user"]
    raise KeyError(f"unknown role {role!r}")


def encode_text(text: str):
    """Encode message text without letting role markers flip the loss mask."""
    init_tokenizer()
    for special in _SPECIAL_STRINGS:
        text = text.replace(special, " ")
    return tok.encode(text, add_special_tokens=False).ids


# --------------------- Step 2: build packed sequences ---------------------
# Format: <|endoftext|> <|user|> text <|anima|> text <|endoftext|>
# Loss is masked to Anima's turns only — the model learns to *respond*,
# not to imitate the user.
# targets[i] == ids[i] when token i should be predicted, else -100.
# masked_next_token_loss shifts by one so logits[t] predict token t+1.

def encode_conversation(messages):
    init_tokenizer()
    ids, targets = [], []
    ids.append(eot_id)
    targets.append(-100)
    for m in messages:
        rid = _role_token_id(m["role"])
        ids.append(rid)
        targets.append(-100)  # role tokens are context, never targets
        text_ids = encode_text(m["content"])
        ids.extend(text_ids)
        targets.extend([-100] * len(text_ids))
        ids.append(eot_id)
        targets.append(-100)
    # mark Anima's text (and its closing <|endoftext|>) as tokens to predict
    final_ids, final_targets = ids[:], targets[:]
    in_anima = False
    anima_id = role_ids["anima"]
    for i, t in enumerate(final_ids):
        if t == anima_id:
            in_anima = True
        elif in_anima and t == eot_id:
            final_targets[i] = eot_id
            in_anima = False
        elif in_anima:
            final_targets[i] = final_ids[i]
    return final_ids, final_targets


def masked_next_token_loss(logits, y):
    """Cross-entropy of next-token preds. Prompt positions stay ignore_index."""
    shift_logits = logits[:, :-1, :].reshape(-1, logits.size(-1))
    shift_y = y[:, 1:].reshape(-1)
    return F.cross_entropy(shift_logits, shift_y, ignore_index=-100)


def load_dataset():
    examples = []
    with open(SFT_DATA, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            conv = json.loads(line)["messages"]
            if not any(m["role"] in ("anima", "assistant") for m in conv):
                continue
            ids, targets = encode_conversation(conv)
            if len(ids) < 10 or len(ids) > cfg.block_size:
                continue  # skip trivial or too-long convos
            examples.append((ids, targets))
    random.shuffle(examples)
    return examples[:MAX_EXAMPLES]


def pad_batch(batch, device):
    B = len(batch)
    T = max(len(ids) for ids, _ in batch)
    x = torch.full((B, T), eot_id, dtype=torch.long)
    y = torch.full((B, T), -100, dtype=torch.long)
    for i, (ids, targets) in enumerate(batch):
        x[i, :len(ids)] = torch.tensor(ids)
        y[i, :len(targets)] = torch.tensor(targets)
    return x.to(device), y.to(device)


def load_pretrained():
    global model, cfg
    if not os.path.isfile(CKPT_PATH):
        raise SystemExit(f"checkpoint not found: {CKPT_PATH}")
    ckpt = torch.load(CKPT_PATH, map_location="cpu", weights_only=True)
    cfg = GPTConfig(**ckpt["cfg"])
    model = GPT(cfg)
    model.load_state_dict(ckpt["model"])
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model.to(device)
    print(f"loaded ckpt: {sum(p.numel() for p in model.parameters())/1e6:.1f}M params")
    return model


# --------------------- Step 3: train ---------------------

def sft():
    init_tokenizer()
    load_pretrained()
    device = next(model.parameters()).device
    examples = load_dataset()
    print(f"SFT examples: {len(examples)}")
    if not examples:
        raise SystemExit("no usable examples — check data/sft/anima_dialogues.jsonl")
    model.train()
    optim = torch.optim.AdamW(model.parameters(), lr=LR, betas=(0.9, 0.95), weight_decay=0.1)
    total_steps = EPOCHS * (len(examples) // BATCH_SIZE + 1)
    step = 0
    for ep in range(EPOCHS):
        random.shuffle(examples)
        for i in range(0, len(examples), BATCH_SIZE):
            batch = examples[i:i + BATCH_SIZE]
            x, y = pad_batch(batch, device)
            logits, _ = model(x)
            loss = masked_next_token_loss(logits, y)
            optim.zero_grad(set_to_none=True)
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optim.step()
            step += 1
            if step % 10 == 0:
                print(f"epoch {ep} step {step}/{total_steps} loss {loss.item():.4f}")
    os.makedirs(OUT_DIR, exist_ok=True)
    torch.save({"model": model.state_dict(), "cfg": cfg.__dict__}, os.path.join(OUT_DIR, "ckpt.pt"))
    with open(os.path.join(OUT_DIR, "sft_meta.json"), "w", encoding="utf-8") as f:
        json.dump({"role_ids": role_ids, "eot_id": eot_id}, f)
    print("saved to", OUT_DIR)


# --------------------- Step 4: chat ---------------------

@torch.no_grad()
def chat(user_text, history=None, max_new_tokens=200, temperature=0.8, top_k=40):
    """Talk to the fine-tuned model. history: list of prior message dicts."""
    if model is None or cfg is None:
        raise RuntimeError("call sft() before chat()")
    init_tokenizer()
    device = next(model.parameters()).device
    model.eval()
    history = history or []
    msgs = history + [{"role": "user", "content": user_text}]
    ids, _ = encode_conversation(msgs)
    # Open Anima's turn. The training format ends the user turn with <|endoftext|>.
    ids.append(role_ids["anima"])
    ids = ids[-cfg.block_size:]
    temperature = max(float(temperature), 1e-5)
    idx = torch.tensor([ids], dtype=torch.long, device=device)
    for _ in range(max_new_tokens):
        idx_cond = idx[:, -cfg.block_size:]
        logits, _ = model(idx_cond)
        logits = logits[:, -1, :] / temperature
        k = min(int(top_k), cfg.vocab_size) if top_k else 0
        if k > 0:
            v, _ = torch.topk(logits, k)
            logits[logits < v[:, [-1]]] = float("-inf")
        probs = F.softmax(logits, dim=-1)
        nxt = torch.multinomial(probs, 1)
        if nxt.item() == eot_id or nxt.item() in role_ids.values():
            break
        idx = torch.cat([idx, nxt], dim=1)
    return tok.decode(idx[0, len(ids):].tolist())


if __name__ == "__main__":
    sft()
    print("Anima:", chat("Hello, who are you?"))

# Dataset bootstrapping tip: until you have real transcripts, generate
# dialogues in Anima's voice with a strong hosted model, then hand-edit
# the best ones — quality over quantity. A few hundred great exchanges
# beat ten thousand mediocre ones at this scale.
