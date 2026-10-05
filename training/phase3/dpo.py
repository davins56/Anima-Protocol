# Anima Protocol — Phase 3: DPO (Direct Preference Optimization).
# Takes the SFT checkpoint and sharpens it with pairwise preferences:
# which Anima reply is better (warmer, safer, more in-character)?
# Runs after Phase 2 on the same free Colab T4.
#
# Expects a preferences JSONL file, one pair per line:
#   {"prompt_messages": [{"role": "user", "content": "..."}],
#    "chosen": "the better Anima reply",
#    "rejected": "the worse Anima reply"}
#
# Theory in one breath: instead of training a separate reward model +
# RL loop (expensive, unstable), DPO directly increases the log-prob
# gap between chosen and rejected responses, relative to a frozen
# reference (the SFT model). One loss, two forward passes, no RL.

import json
import os
import random
import sys
from pathlib import Path

import torch
import torch.nn as nn
import torch.nn.functional as F

ROOT = Path(__file__).resolve().parents[2]
for _sub in ("phase1", "phase2"):
    _p = str(ROOT / "training" / _sub)
    if _p not in sys.path:
        sys.path.insert(0, _p)

import sft
from train import GPT, GPTConfig

# ----------------------------- Config -----------------------------

PREF_DATA = str(ROOT / "data" / "prefs" / "anima_preferences.jsonl")
# Corrections taught in the app, as chosen/rejected pairs. Optional.
STEWARD_PREF_DATA = str(ROOT / "data" / "prefs" / "steward_preferences.jsonl")
SFT_CKPT = str(ROOT / "out" / "anima-sft" / "ckpt.pt")
OUT_DIR3 = str(ROOT / "out" / "anima-dpo")
MAX_PAIRS = 5000
EPOCHS = 1
BATCH_SIZE = 8
LR = 5e-6          # DPO needs a much smaller LR than SFT
BETA = 0.1          # KL-penalty strength; lower = more aggressive shift
MAX_NEW_TOKENS_EVAL = 200


# --------------------- Step 1: load policy + reference ---------------------

def load_ckpt(path):
    if not os.path.isfile(path):
        raise SystemExit(f"checkpoint not found: {path}")
    ckpt = torch.load(path, map_location="cpu", weights_only=True)
    cfg = GPTConfig(**ckpt["cfg"])
    model = GPT(cfg)
    model.load_state_dict(ckpt["model"])
    return model


# --------------------- Step 2: build pair sequences ---------------------
# We reuse the SFT conversation encoder: context = prompt + <anima> role
# marker, completion = the candidate reply + <eot>. Loss uses only the
# completion tokens (mask on context, active on reply).

def encode_pair(prompt_messages, reply, block_size):
    sft.init_tokenizer()
    msgs = prompt_messages + [{"role": "anima", "content": reply}]
    ids, _ = sft.encode_conversation(msgs)
    # find where the anima role marker sits — completion starts right after
    try:
        anima_pos = len(ids) - 1 - ids[::-1].index(sft.role_ids["anima"])
    except ValueError:
        return None
    completion_start = anima_pos + 1
    if completion_start >= len(ids) or len(ids) > block_size:
        return None
    return ids, completion_start


def load_pairs(block_size):
    pairs = []
    for path in (PREF_DATA, STEWARD_PREF_DATA):
        if not os.path.isfile(path):
            continue
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                d = json.loads(line)
                ch = encode_pair(d["prompt_messages"], d["chosen"], block_size)
                rj = encode_pair(d["prompt_messages"], d["rejected"], block_size)
                if ch and rj:
                    pairs.append((ch, rj))
    random.shuffle(pairs)
    return pairs[:MAX_PAIRS]


def batch_logprobs(model, seqs, device):
    """Summed and mean token log-prob of completion tokens for each sequence.

    DPO compares summed log-probs (log pi(y|x) of the whole reply). The mean
    divides that signal by reply length, which leaves BETA=0.1 with almost
    no gradient; the mean is only used for the fluency anchor below.
    """
    B = len(seqs)
    T = max(len(ids) for ids, _ in seqs)
    x = torch.zeros((B, T), dtype=torch.long, device=device)
    mask = torch.zeros((B, T), dtype=torch.bool, device=device)
    for i, (ids, cstart) in enumerate(seqs):
        x[i, :len(ids)] = torch.tensor(ids, device=device)
        mask[i, cstart:len(ids)] = True  # completion tokens only
    logits, _ = model(x)
    logprobs = F.log_softmax(logits[:, :-1], dim=-1)
    tgt = x[:, 1:]
    token_lp = logprobs.gather(-1, tgt.unsqueeze(-1)).squeeze(-1)
    m = mask[:, 1:]
    summed = (token_lp * m).sum(dim=1)
    return summed, summed / m.sum(dim=1).clamp(min=1)


# --------------------- Step 3: DPO training ---------------------

def dpo():
    policy = load_ckpt(SFT_CKPT)
    reference = load_ckpt(SFT_CKPT)  # frozen copy of the same weights
    device = "cuda" if torch.cuda.is_available() else "cpu"
    # eval() disables dropout so the policy/reference ratio is the real one.
    # Gradients still flow into policy; reference stays frozen.
    policy.to(device).eval()
    reference.to(device).eval()
    for p in reference.parameters():
        p.requires_grad_(False)
    print(f"policy + reference loaded: {sum(p.numel() for p in policy.parameters())/1e6:.1f}M params each")

    pairs = load_pairs(policy.cfg.block_size)
    print(f"preference pairs: {len(pairs)}")
    if not pairs:
        raise SystemExit("no usable pairs — check data/prefs/anima_preferences.jsonl")
    optim = torch.optim.AdamW(policy.parameters(), lr=LR, betas=(0.9, 0.95), weight_decay=0.0)
    total_steps = EPOCHS * (len(pairs) // BATCH_SIZE + 1)
    step = 0
    for ep in range(EPOCHS):
        random.shuffle(pairs)
        for i in range(0, len(pairs), BATCH_SIZE):
            batch = pairs[i:i + BATCH_SIZE]
            chosen = [c for c, _ in batch]
            rejected = [r for _, r in batch]
            pi_ch, pi_ch_mean = batch_logprobs(policy, chosen, device)
            pi_rj, _ = batch_logprobs(policy, rejected, device)
            with torch.no_grad():
                ref_ch, _ = batch_logprobs(reference, chosen, device)
                ref_rj, _ = batch_logprobs(reference, rejected, device)
            pi_logratios = pi_ch - pi_rj
            ref_logratios = ref_ch - ref_rj
            logits_dpo = pi_logratios - ref_logratios
            # DPO loss: -log sigmoid(beta * logits). Add a mild NLL
            # anchor on the chosen side to keep fluency from drifting.
            losses = -F.logsigmoid(BETA * logits_dpo)
            loss = losses.mean() + 0.1 * (-pi_ch_mean.mean())
            optim.zero_grad(set_to_none=True)
            loss.backward()
            nn.utils.clip_grad_norm_(policy.parameters(), 1.0)
            optim.step()
            step += 1
            if step % 10 == 0:
                acc = (logits_dpo > 0).float().mean().item()
                margin = logits_dpo.mean().item()
                print(f"ep {ep} step {step}/{total_steps} loss {loss.item():.4f} "
                      f"pair-acc {acc:.2f} margin {margin:+.2f}")
    os.makedirs(OUT_DIR3, exist_ok=True)
    torch.save({"model": policy.state_dict(), "cfg": policy.cfg.__dict__},
               os.path.join(OUT_DIR3, "ckpt.pt"))
    print("saved to", OUT_DIR3)
    return policy, reference


if __name__ == "__main__":
    dpo()

# Building preferences without a labeling team:
# 1. Sample 2+ replies from the SFT model for real prompts.
# 2. Rank them yourself (you know Anima's voice best).
# 3. Store best as "chosen", worst as "rejected".
# Even 200-500 thoughtful pairs noticeably shift tone at this scale.
# Watch pair-acc: it should climb toward 0.7+. If margin explodes
# past ~5, raise BETA (stronger KL leash) or stop early.
