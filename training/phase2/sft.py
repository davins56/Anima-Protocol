# Anima Protocol — Phase 2: SFT (supervised fine-tuning).
# Teaches the pretrained checkpoint to converse in Anima's voice using
# the reserved role tokens (from Phase 1's tokenizer).
# Expects a JSONL dataset of conversations:
#   {"messages": [{"role": "user", "content": "..."}, {"role": "anima", "content": "..."}]}
# Same Colab T4 that ran Phase 1 is fine.

import json
import os
import pickle
import random

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

from train import GPT, GPTConfig  # reuse the Phase 1 model

# ----------------------------- Config -----------------------------

SFT_DATA = "data/sft/anima_dialogues.jsonl"
CKPT_PATH = "out/anima-tiny/ckpt.pt"
TOK_DIR = "data/anima_tokens"
OUT_DIR = "out/anima-sft"
MAX_EXAMPLES = 20000
EPOCHS = 3
BATCH_SIZE = 32
LR = 1e-4


# --------------------- Step 1: load tokenizer + model ---------------------

with open(os.path.join(TOK_DIR, "meta.pkl"), "rb") as f:
    meta = pickle.load(f)
with open(os.path.join(TOK_DIR, "tokenizer.json")) as f:
    from tokenizers import Tokenizer
    tok = Tokenizer.from_str(f.read())

ROLES = {"user": meta["special"]["user"], "anima": meta["special"]["anima"]}
EOT = meta["special"]["endoftext"]
role_ids = {r: tok.token_to_id(s) for r, s in ROLES.items()}
eot_id = tok.token_to_id(EOT)
assert None not in role_ids.values() and eot_id is not None, "role tokens missing from tokenizer"

ckpt = torch.load(CKPT_PATH, map_location="cpu")
cfg = GPTConfig(**ckpt["cfg"])
model = GPT(cfg)
model.load_state_dict(ckpt["model"])
model.to("cuda" if torch.cuda.is_available() else "cpu")
print(f"loaded ckpt: {sum(p.numel() for p in model.parameters())/1e6:.1f}M params")


# --------------------- Step 2: build packed sequences ---------------------
# Format: <|endoftext|> <|user|> text <|anima|> text <|endoftext|>
# Loss is masked to Anima's turns only — the model learns to *respond*,
# not to imitate the user.

def encode_conversation(messages):
    ids, targets = [], []
    ids.append(eot_id)
    targets.append(-100)
    for m in messages:
        rid = role_ids[m["role"]]
        ids.append(rid)
        targets.append(-100)  # role tokens are context, never targets
        text_ids = tok.encode(m["content"]).ids
        ids.extend(text_ids)
        targets.extend([-100] * len(text_ids))
        ids.append(eot_id)
        targets.append(-100)
    # mark Anima's text (and its closing <|endoftext|>) as targets
    final_ids, final_targets = ids[:], targets[:]
    in_anima = False
    for i, t in enumerate(final_ids):
        if t == role_ids["anima"]:
            in_anima = True
        elif in_anima and t == eot_id:
            final_targets[i] = eot_id
            in_anima = False
        elif in_anima:
            final_targets[i] = final_ids[i]  # predict Anima's text
    return final_ids, final_targets


def load_dataset():
    examples = []
    with open(SFT_DATA, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            conv = json.loads(line)["messages"]
            if not any(m["role"] == "anima" for m in conv):
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


# --------------------- Step 3: train ---------------------

def sft():
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
            logits = logits.view(-1, logits.size(-1))
            loss = F.cross_entropy(logits, y.view(-1), ignore_index=-100)
            optim.zero_grad(set_to_none=True)
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optim.step()
            step += 1
            if step % 10 == 0:
                print(f"epoch {ep} step {step}/{total_steps} loss {loss.item():.4f}")
    os.makedirs(OUT_DIR, exist_ok=True)
    torch.save({"model": model.state_dict(), "cfg": cfg.__dict__}, os.path.join(OUT_DIR, "ckpt.pt"))
    with open(os.path.join(OUT_DIR, "sft_meta.pkl"), "wb") as f:
        pickle.dump({"role_ids": role_ids, "eot_id": eot_id}, f)
    print("saved to", OUT_DIR)


# --------------------- Step 4: chat ---------------------

@torch.no_grad()
def chat(user_text, history=None, max_new_tokens=200, temperature=0.8, top_k=40):
    """Talk to the fine-tuned model. history: list of prior message dicts."""
    device = next(model.parameters()).device
    model.eval()
    history = history or []
    msgs = history + [{"role": "user", "content": user_text}]
    ids, _ = encode_conversation(msgs)
    if ids and ids[-1] == eot_id:
        ids = ids[:-1]
    idx = torch.tensor([ids], device=device)
    for _ in range(max_new_tokens):
        idx_cond = idx[:, -cfg.block_size:]
        logits, _ = model(idx_cond)
        logits = logits[:, -1, :] / temperature
        if top_k:
            v, _ = torch.topk(logits, top_k)
            logits[logits < v[:, [-1]]] = float("-inf")
        probs = F.softmax(logits, dim=-1)
        nxt = torch.multinomial(probs, 1)
        if nxt.item() == eot_id or nxt.item() in role_ids.values():
            break
        idx = torch.cat([idx, nxt], dim=1)
    return tok.decode(idx[0].tolist()[len(ids):])


if __name__ == "__main__":
    sft()
    print("Anima:", chat("Hello, who are you?"))

# Dataset bootstrapping tip: until you have real transcripts, generate
# dialogues in Anima's voice with a strong hosted model, then hand-edit
# the best ones — quality over quantity. A few hundred great exchanges
# beat ten thousand mediocre ones at this scale.
