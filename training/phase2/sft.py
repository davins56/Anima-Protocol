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
    # System prompts are context, like user text — the same mapping
    # server/server.py applies, so training and serving see one layout.
    if role in ("user", "system"):
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


def fit_conversation(messages, block_size, reserve=0):
    """Drop the oldest turns until the encoded conversation fits.

    Cutting on a raw token boundary can slice a message in half or lose the
    role marker that says whose turn it is; cutting on message boundaries
    keeps every remaining turn intact. `reserve` holds back room for the
    reply that will be generated after the prompt. Returns the encoded ids,
    targets, and the messages that survived.
    """
    msgs = list(messages)
    budget = block_size - reserve
    while True:
        ids, targets = encode_conversation(msgs)
        if len(ids) <= budget or len(msgs) <= 1:
            return ids, targets, msgs
        msgs = msgs[1:]


def load_dataset():
    examples = []
    dropped = 0
    with open(SFT_DATA, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            conv = json.loads(line)["messages"]
            if not any(m["role"] in ("anima", "assistant") for m in conv):
                continue
            # A conversation longer than the window used to be thrown away, so
            # the model never saw a long, complete reply and learned to end
            # early. Keep the tail of the conversation instead.
            ids, targets, kept = fit_conversation(conv, cfg.block_size)
            if len(ids) < 10 or len(ids) > cfg.block_size:
                dropped += 1
                continue
            roles = {m["role"] for m in kept}
            if not roles & {"anima", "assistant"} or not roles - {"anima", "assistant"}:
                dropped += 1  # a reply with no prompt left teaches nothing
                continue
            examples.append((ids, targets))
    if dropped:
        print(f"dropped {dropped} examples whose final turn alone exceeds block_size={cfg.block_size}")
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


# --------------------- Step 4: sampling + chat ---------------------

SENTENCE_END = (".", "!", "?", "\u2026", '."', ".\u201d", "!\u201d", "?\u201d", '!"', '?"', ".)", ".\u2019")


def ends_sentence(text: str) -> bool:
    return text.rstrip().endswith(SENTENCE_END)


def trim_to_sentence(text: str, min_keep_ratio: float = 0.3) -> str:
    """Cut a length-capped reply back to its last complete sentence.

    Only trims when at least `min_keep_ratio` of the text survives; a reply
    that is one long unfinished sentence is returned as-is rather than
    reduced to nothing.
    """
    stripped = text.rstrip()
    if ends_sentence(stripped):
        return stripped
    best = -1
    for end in SENTENCE_END:
        idx = stripped.rfind(end)
        if idx >= 0:
            best = max(best, idx + len(end))
    if best >= int(len(stripped) * min_keep_ratio):
        return stripped[:best]
    return stripped


@torch.no_grad()
def generate_tokens(
    prompt_ids,
    max_new_tokens=256,
    temperature=0.8,
    top_k=40,
    repetition_penalty=1.15,
    min_new_tokens=8,
    soft_stop_ratio=0.75,
):
    """Sample a reply for an already-encoded prompt ending in <|anima|>.

    - The prompt must fit the window with room left for the reply; the loop
      never lets the prompt slide out of view (that is what made the model
      forget the question halfway through answering).
    - <|endoftext|> and role tokens are suppressed for the first
      `min_new_tokens` so a nervous model cannot answer with a fragment.
    - Repeated tokens are penalized; past `soft_stop_ratio` of the budget the
      first sentence end stops generation cleanly.
    Returns (token_ids, finish_reason) where finish_reason is "stop" or "length".
    """
    if model is None or cfg is None:
        raise RuntimeError("model is not loaded")
    init_tokenizer()
    device = next(model.parameters()).device
    model.eval()
    room = cfg.block_size - len(prompt_ids)
    if room < 1:
        raise ValueError(
            f"prompt is {len(prompt_ids)} tokens; block_size is {cfg.block_size}. "
            "Call fit_conversation with a reserve before generating."
        )
    budget = max(1, min(int(max_new_tokens), room))
    temperature = max(float(temperature), 1e-5)
    k = min(int(top_k), cfg.vocab_size) if top_k else 0
    stop_ids = {eot_id, *role_ids.values()}
    soft_stop_at = int(budget * soft_stop_ratio)

    idx = torch.tensor([prompt_ids], dtype=torch.long, device=device)
    out = []
    finish_reason = "length"
    for step in range(budget):
        logits, _ = model(idx)
        logits = logits[:, -1, :] / temperature
        if out and repetition_penalty and repetition_penalty != 1.0:
            seen = torch.tensor(sorted(set(out)), device=device)
            picked = logits[0, seen]
            logits[0, seen] = torch.where(picked > 0, picked / repetition_penalty, picked * repetition_penalty)
        if step < min_new_tokens:
            for sid in stop_ids:
                logits[0, sid] = float("-inf")
        if k > 0:
            v, _ = torch.topk(logits, k)
            logits[logits < v[:, [-1]]] = float("-inf")
        probs = F.softmax(logits, dim=-1)
        nxt = torch.multinomial(probs, 1)
        t = nxt.item()
        if t in stop_ids:
            finish_reason = "stop"
            break
        out.append(t)
        idx = torch.cat([idx, nxt], dim=1)
        if step >= soft_stop_at and ends_sentence(tok.decode(out[-8:])):
            finish_reason = "stop"
            break
    return out, finish_reason


def generate_reply(messages, max_new_tokens=256, temperature=0.8, top_k=40, **kw):
    """Encode a conversation, open Anima's turn, sample, and tidy the ending."""
    reserve = min(int(max_new_tokens), cfg.block_size // 2) + 1
    ids, _, _ = fit_conversation(messages, cfg.block_size, reserve=reserve)
    ids.append(role_ids["anima"])
    out, finish_reason = generate_tokens(ids, max_new_tokens, temperature, top_k, **kw)
    text = tok.decode(out).strip()
    if finish_reason == "length":
        text = trim_to_sentence(text)
    return text, finish_reason


@torch.no_grad()
def chat(user_text, history=None, max_new_tokens=200, temperature=0.8, top_k=40):
    """Talk to the fine-tuned model. history: list of prior message dicts."""
    if model is None or cfg is None:
        raise RuntimeError("call sft() before chat()")
    msgs = (history or []) + [{"role": "user", "content": user_text}]
    text, _ = generate_reply(msgs, max_new_tokens, temperature, top_k)
    return text


if __name__ == "__main__":
    sft()
    print("Anima:", chat("Hello, who are you?"))

# Dataset bootstrapping tip: until you have real transcripts, generate
# dialogues in Anima's voice with a strong hosted model, then hand-edit
# the best ones — quality over quantity. A few hundred great exchanges
# beat ten thousand mediocre ones at this scale.
