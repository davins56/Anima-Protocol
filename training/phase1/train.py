# Anima Protocol — Phase 1: train a tiny GPT from scratch.
# Runs on a free Colab T4 in ~30-60 min for a ~10M param model.
# Expects tokens produced by data_pipeline.py in <repo>/data/anima_tokens

import json
import math
import os
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

# Paths are anchored at the repo root so the script does not depend on cwd.
ROOT = Path(__file__).resolve().parents[2]


# ----------------------------- Config -----------------------------

@dataclass
class GPTConfig:
    vocab_size: int = 50257   # overridden from tokenizer meta
    block_size: int = 256      # context length
    n_layer: int = 6
    n_head: int = 6
    n_embd: int = 384         # 6 layers * 384 dim = ~10M params
    dropout: float = 0.1
    batch_size: int = 64
    max_iters: int = 5000
    lr: float = 3e-4
    warmup_iters: int = 100
    eval_interval: int = 500
    eval_iters: int = 20


def load_tokens(tok_dir: str):
    ids = np.fromfile(os.path.join(tok_dir, "train_ids.bin"), dtype=np.uint16)
    return ids


# ----------------------------- Model ------------------------------

class CausalSelfAttention(nn.Module):
    def __init__(self, cfg: GPTConfig):
        super().__init__()
        assert cfg.n_embd % cfg.n_head == 0
        self.qkv = nn.Linear(cfg.n_embd, 3 * cfg.n_embd)
        self.proj = nn.Linear(cfg.n_embd, cfg.n_embd)
        self.n_head = cfg.n_head
        self.drop = nn.Dropout(cfg.dropout)
        self.register_buffer(
            "mask", torch.tril(torch.ones(cfg.block_size, cfg.block_size))
            .view(1, 1, cfg.block_size, cfg.block_size)
        )

    def forward(self, x):
        B, T, C = x.shape
        q, k, v = self.qkv(x).split(C, dim=2)
        q = q.view(B, T, self.n_head, C // self.n_head).transpose(1, 2)
        k = k.view(B, T, self.n_head, C // self.n_head).transpose(1, 2)
        v = v.view(B, T, self.n_head, C // self.n_head).transpose(1, 2)
        att = (q @ k.transpose(-2, -1)) / math.sqrt(k.size(-1))
        att = att.masked_fill(self.mask[:, :, :T, :T] == 0, float("-inf"))
        att = F.softmax(att, dim=-1)
        att = self.drop(att)
        y = (att @ v).transpose(1, 2).contiguous().view(B, T, C)
        return self.drop(self.proj(y))


class Block(nn.Module):
    def __init__(self, cfg: GPTConfig):
        super().__init__()
        self.ln1 = nn.LayerNorm(cfg.n_embd)
        self.attn = CausalSelfAttention(cfg)
        self.ln2 = nn.LayerNorm(cfg.n_embd)
        self.mlp = nn.Sequential(
            nn.Linear(cfg.n_embd, 4 * cfg.n_embd),
            nn.GELU(),
            nn.Linear(4 * cfg.n_embd, cfg.n_embd),
            nn.Dropout(cfg.dropout),
        )

    def forward(self, x):
        x = x + self.attn(self.ln1(x))
        x = x + self.mlp(self.ln2(x))
        return x


class GPT(nn.Module):
    def __init__(self, cfg: GPTConfig):
        super().__init__()
        self.cfg = cfg
        self.tok_emb = nn.Embedding(cfg.vocab_size, cfg.n_embd)
        self.pos_emb = nn.Embedding(cfg.block_size, cfg.n_embd)
        self.drop = nn.Dropout(cfg.dropout)
        self.blocks = nn.ModuleList([Block(cfg) for _ in range(cfg.n_layer)])
        self.ln_f = nn.LayerNorm(cfg.n_embd)
        self.head = nn.Linear(cfg.n_embd, cfg.vocab_size, bias=False)
        self.apply(self._init_weights)

    def _init_weights(self, m):
        if isinstance(m, nn.Linear):
            nn.init.normal_(m.weight, mean=0.0, std=0.02)
            if m.bias is not None:
                nn.init.zeros_(m.bias)
        elif isinstance(m, nn.Embedding):
            nn.init.normal_(m.weight, mean=0.0, std=0.02)

    def forward(self, idx, targets=None):
        B, T = idx.shape
        assert T <= self.cfg.block_size
        pos = torch.arange(T, device=idx.device)
        x = self.drop(self.tok_emb(idx) + self.pos_emb(pos))
        for blk in self.blocks:
            x = blk(x)
        x = self.ln_f(x)
        logits = self.head(x)
        loss = None
        if targets is not None:
            loss = F.cross_entropy(
                logits.view(-1, logits.size(-1)), targets.view(-1)
            )
        return logits, loss

    @torch.no_grad()
    def generate(self, idx, max_new_tokens=200, temperature=0.8, top_k=40):
        self.eval()
        for _ in range(max_new_tokens):
            idx_cond = idx[:, -self.cfg.block_size:]
            logits, _ = self(idx_cond)
            logits = logits[:, -1, :] / max(float(temperature), 1e-5)
            if top_k is not None:
                k = min(int(top_k), logits.size(-1))
                if k > 0:
                    v, _ = torch.topk(logits, k)
                    logits[logits < v[:, [-1]]] = float("-inf")
            probs = F.softmax(logits, dim=-1)
            next_tok = torch.multinomial(probs, num_samples=1)
            idx = torch.cat([idx, next_tok], dim=1)
        return idx


# ----------------------------- Training -----------------------------

def get_batch(ids, cfg: GPTConfig, device):
    # i + block_size is a valid end, and the target window reaches the next token.
    hi = len(ids) - cfg.block_size
    if hi <= 0:
        raise ValueError(f"need more than {cfg.block_size} tokens, got {len(ids)}")
    ix = torch.randint(hi, (cfg.batch_size,))
    xs, ys = [], []
    for i in ix.tolist():
        xs.append(torch.from_numpy(ids[i:i + cfg.block_size].astype(np.int64)))
        ys.append(torch.from_numpy(ids[i + 1:i + cfg.block_size + 1].astype(np.int64)))
    return torch.stack(xs).to(device), torch.stack(ys).to(device)


def train_val_split(ids, cfg: GPTConfig):
    """Hold out the last 10%. Train only on the front so val loss is not memorized."""
    if len(ids) <= cfg.block_size:
        raise SystemExit(
            f"need more than {cfg.block_size} tokens to train; got {len(ids)}. "
            "Add text under data/raw and rerun data_pipeline.py."
        )
    cut = int(len(ids) * 0.9)
    train_ids, val_ids = ids[:cut], ids[cut:]
    if len(train_ids) <= cfg.block_size or len(val_ids) <= cfg.block_size:
        print(f"corpus has {len(ids)} tokens; training on all of them (too small for a val split)")
        return ids, None
    return train_ids, val_ids


@torch.no_grad()
def estimate_loss(model, train_ids, val_ids, cfg: GPTConfig, device):
    model.eval()
    out = {}
    parts = [("train", train_ids)]
    if val_ids is not None:
        parts.append(("val", val_ids))
    for split, data in parts:
        losses = []
        for _ in range(cfg.eval_iters):
            x, y = get_batch(data, cfg, device)
            _, loss = model(x, y)
            losses.append(loss.item())
        out[split] = sum(losses) / len(losses)
    model.train()
    return out


def train(tok_dir=None, out_dir=None):
    tok_dir = tok_dir or str(ROOT / "data" / "anima_tokens")
    out_dir = out_dir or str(ROOT / "out" / "anima-tiny")
    device = "cuda" if torch.cuda.is_available() else "cpu"
    ids = load_tokens(tok_dir)
    with open(os.path.join(tok_dir, "meta.json"), encoding="utf-8") as f:
        meta = json.load(f)
    cfg = GPTConfig(vocab_size=meta["vocab_size"])
    train_ids, val_ids = train_val_split(ids, cfg)
    print(f"device={device}  tokens={len(ids):,}  vocab={cfg.vocab_size}")

    model = GPT(cfg).to(device)
    n_params = sum(p.numel() for p in model.parameters())
    print(f"parameters: {n_params/1e6:.1f}M")

    optim = torch.optim.AdamW(model.parameters(), lr=cfg.lr, betas=(0.9, 0.95), weight_decay=0.1)
    for it in range(cfg.max_iters):
        lr = cfg.lr * min((it + 1) / cfg.warmup_iters, 1.0) / max(1, (it + 1) / 3000)
        for g in optim.param_groups:
            g["lr"] = lr
        if it % cfg.eval_interval == 0 or it == cfg.max_iters - 1:
            losses = estimate_loss(model, train_ids, val_ids, cfg, device)
            val_s = f"{losses['val']:.3f}" if "val" in losses else "n/a"
            print(f"step {it:5d} | train {losses['train']:.3f} | val {val_s}")
        x, y = get_batch(train_ids, cfg, device)
        _, loss = model(x, y)
        optim.zero_grad(set_to_none=True)
        loss.backward()
        nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        optim.step()

    os.makedirs(out_dir, exist_ok=True)
    torch.save({"model": model.state_dict(), "cfg": cfg.__dict__}, os.path.join(out_dir, "ckpt.pt"))
    print("saved to", out_dir)
    return model


if __name__ == "__main__":
    train()

# Sample generation after training:
#   model = train()
#   start = torch.tensor([[0]], device="cuda")  # token 0 = <|endoftext|>
#   print(model.generate(start, max_new_tokens=300)[0].tolist())
