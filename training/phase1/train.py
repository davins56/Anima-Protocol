# Anima Protocol — Phase 1: train a small GPT from scratch.
# Default config is ~34M params with a 1024-token window; fits a free Colab
# T4 in fp16 (~1-2 h). Expects tokens from data_pipeline.py in
# <repo>/data/anima_tokens. Changing block_size or the tokenizer vocab means
# retraining every phase — old checkpoints will not load.

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
    block_size: int = 1024     # context length: room for history + a full reply
    n_layer: int = 8
    n_head: int = 8
    n_embd: int = 512         # 8 layers * 512 dim = ~34M params with an 8k vocab
    dropout: float = 0.1
    batch_size: int = 16
    grad_accum_steps: int = 4  # effective batch 64 x 1024 tokens
    max_iters: int = 6000
    # From-scratch pretrain, not a LoRA on a foundation model — 5e-4 is the
    # right scale here. LoRA SFT on Ministral uses 2e-4 (see unsloth_sft.py).
    lr: float = 5e-4
    warmup_iters: int = 300  # 5% of max_iters; CLI rescales when max_iters changes
    eval_interval: int = 250
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
        self.attn_dropout = cfg.dropout
        self.drop = nn.Dropout(cfg.dropout)

    def forward(self, x):
        B, T, C = x.shape
        q, k, v = self.qkv(x).split(C, dim=2)
        q = q.view(B, T, self.n_head, C // self.n_head).transpose(1, 2)
        k = k.view(B, T, self.n_head, C // self.n_head).transpose(1, 2)
        v = v.view(B, T, self.n_head, C // self.n_head).transpose(1, 2)
        # Fused causal attention never materializes the T x T matrix, which is
        # what lets a 1024-token window fit a T4.
        y = F.scaled_dot_product_attention(
            q, k, v, is_causal=True,
            dropout_p=self.attn_dropout if self.training else 0.0,
        )
        y = y.transpose(1, 2).contiguous().view(B, T, C)
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


def train(tok_dir=None, out_dir=None, overrides=None):
    tok_dir = tok_dir or str(ROOT / "data" / "anima_tokens")
    out_dir = out_dir or str(ROOT / "out" / "anima-tiny")
    device = "cuda" if torch.cuda.is_available() else "cpu"
    if device == "cpu":
        torch.set_num_threads(os.cpu_count() or 1)
    ids = load_tokens(tok_dir)
    with open(os.path.join(tok_dir, "meta.json"), encoding="utf-8") as f:
        meta = json.load(f)
    cfg = GPTConfig(vocab_size=meta["vocab_size"])
    for key, value in (overrides or {}).items():
        if not hasattr(cfg, key):
            raise SystemExit(f"unknown training override: {key}")
        setattr(cfg, key, value)
    if cfg.n_embd % cfg.n_head != 0:
        raise SystemExit(f"n_embd ({cfg.n_embd}) must be divisible by n_head ({cfg.n_head})")
    train_ids, val_ids = train_val_split(ids, cfg)
    print(f"device={device}  tokens={len(ids):,}  vocab={cfg.vocab_size}")

    model = GPT(cfg).to(device)
    n_params = sum(p.numel() for p in model.parameters())
    print(f"parameters: {n_params/1e6:.1f}M")

    optim = torch.optim.AdamW(model.parameters(), lr=cfg.lr, betas=(0.9, 0.95), weight_decay=0.1)
    use_amp = device == "cuda"
    scaler = torch.amp.GradScaler("cuda", enabled=use_amp)
    os.makedirs(out_dir, exist_ok=True)
    ckpt_path = os.path.join(out_dir, "ckpt.pt")
    best_val = float("inf")

    def save():
        torch.save({"model": model.state_dict(), "cfg": cfg.__dict__}, ckpt_path)

    for it in range(cfg.max_iters):
        lr = cfg.lr * min((it + 1) / cfg.warmup_iters, 1.0) / max(1, (it + 1) / 3000)
        for g in optim.param_groups:
            g["lr"] = lr
        if it % cfg.eval_interval == 0 or it == cfg.max_iters - 1:
            losses = estimate_loss(model, train_ids, val_ids, cfg, device)
            val_s = f"{losses['val']:.3f}" if "val" in losses else "n/a"
            print(f"step {it:5d} | train {losses['train']:.3f} | val {val_s}")
            # Keep the checkpoint with the best held-out loss. A small corpus
            # overfits in a few thousand steps and the overfit model is the
            # one that rambles; the best-val one generalizes.
            score = losses.get("val", losses["train"])
            if score < best_val:
                best_val = score
                save()
        optim.zero_grad(set_to_none=True)
        for _ in range(cfg.grad_accum_steps):
            x, y = get_batch(train_ids, cfg, device)
            with torch.autocast(device_type="cuda", dtype=torch.float16, enabled=use_amp):
                _, loss = model(x, y)
            scaler.scale(loss / cfg.grad_accum_steps).backward()
        scaler.unscale_(optim)
        nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        scaler.step(optim)
        scaler.update()

    if best_val == float("inf"):
        save()
    print(f"saved best checkpoint (val {best_val:.3f}) to", out_dir)
    return model


def _cli_overrides(argv=None):
    """Flags default to None so an omitted flag keeps the T4 recipe in GPTConfig."""
    import argparse
    parser = argparse.ArgumentParser(description="Phase 1 from-scratch Anima GPT")
    parser.add_argument("--max-iters", type=int, default=None)
    parser.add_argument("--batch-size", type=int, default=None)
    parser.add_argument("--grad-accum", type=int, default=None)
    parser.add_argument("--block-size", type=int, default=None)
    parser.add_argument("--n-layer", type=int, default=None)
    parser.add_argument("--n-head", type=int, default=None)
    parser.add_argument("--n-embd", type=int, default=None)
    parser.add_argument("--lr", type=float, default=None)
    parser.add_argument("--warmup-iters", type=int, default=None)
    parser.add_argument("--eval-interval", type=int, default=None)
    parser.add_argument("--eval-iters", type=int, default=None)
    args = parser.parse_args(argv)
    overrides = {}
    mapping = {
        "max_iters": args.max_iters,
        "batch_size": args.batch_size,
        "grad_accum_steps": args.grad_accum,
        "block_size": args.block_size,
        "n_layer": args.n_layer,
        "n_head": args.n_head,
        "n_embd": args.n_embd,
        "lr": args.lr,
        "warmup_iters": args.warmup_iters,
        "eval_interval": args.eval_interval,
        "eval_iters": args.eval_iters,
    }
    for key, value in mapping.items():
        if value is not None:
            overrides[key] = value
    # Keep the 5% warmup when the run is shorter than the 6000-step default.
    if "max_iters" in overrides and "warmup_iters" not in overrides:
        overrides["warmup_iters"] = max(1, int(round(overrides["max_iters"] * 0.05)))
    return overrides


if __name__ == "__main__":
    train(overrides=_cli_overrides())

# Sample generation after training:
#   model = train()
#   start = torch.tensor([[0]], device="cuda")  # token 0 = <|endoftext|>
#   print(model.generate(start, max_new_tokens=300)[0].tolist())
