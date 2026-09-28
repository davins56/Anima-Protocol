# Anima Protocol — prompt layout and sampling shared by serving and learning.
#
# The tiny GPT only sees `block_size` tokens (256 by default). The app sends
# long character prompts and history, so this module decides which recent
# turns fit, in the same <|endoftext|> <|user|> … <|anima|> … layout Phase 2
# SFT trained on, and samples replies one token at a time.

from dataclasses import dataclass

import torch
import torch.nn.functional as F

import _paths  # noqa: F401  (puts training/phase1 and phase2 on sys.path)
import sft

# Per-message cap before tokenizing. The context holds far less than this;
# the cap only bounds tokenizer work on very large pasted prompts.
MAX_TEXT_CHARS = 16_000
# The prompt keeps at least this many tokens, however long the reply budget.
MIN_PROMPT_TOKENS = 16


def message_text(content) -> str:
    """OpenAI message content (string, parts array, or null) as plain text."""
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for part in content:
            if isinstance(part, str):
                parts.append(part)
            elif isinstance(part, dict):
                text = part.get("text")
                if not isinstance(text, str):
                    text = part.get("content")
                if isinstance(text, str):
                    parts.append(text)
        return "".join(parts)
    return str(content)


def normalize_role(role) -> str:
    r = str(role or "").strip().lower()
    if r in ("assistant", "anima"):
        return "anima"
    if r in ("system", "developer"):
        return "system"
    # user, tool, function and unknown roles are context, not Anima's turn
    return "user"


def normalize_messages(messages) -> list[dict]:
    out = []
    for m in messages or []:
        if not isinstance(m, dict):
            continue
        text = message_text(m.get("content"))
        if len(text) > MAX_TEXT_CHARS:
            text = text[-MAX_TEXT_CHARS:]
        out.append({"role": normalize_role(m.get("role")), "content": text})
    return out


def _turn(role: str, text_ids) -> list[int]:
    rid = sft.role_ids["anima"] if role == "anima" else sft.role_ids["user"]
    return [rid, *text_ids, sft.eot_id]


def prompt_budget(block_size: int, max_tokens: int) -> int:
    """Prompt tokens that still leave room for the reply inside the window."""
    reserve = min(max(int(max_tokens), 1), block_size // 2)
    return max(block_size - reserve, MIN_PROMPT_TOKENS)


def fit_prompt(messages, budget: int) -> list[int]:
    """Token ids for `messages`, newest turns first, ending with <|anima|>.

    Dialogue is kept from the end backwards while whole turns fit. The newest
    turn is what the reply answers, so it is kept even when it alone is too
    long (its tail survives). System prompts only go in when they fit whole —
    a character sheet cut in half would mislead more than it helps.
    """
    sft.init_tokenizer()
    msgs = normalize_messages(messages)
    room = max(int(budget), MIN_PROMPT_TOKENS) - 2  # leading eot + trailing <|anima|>
    dialogue = [m for m in msgs if m["role"] != "system"]
    system = [m for m in msgs if m["role"] == "system"]

    kept = []  # newest first
    for i, m in enumerate(reversed(dialogue)):
        text_ids = sft.encode_text(m["content"])
        turn = _turn(m["role"], text_ids)
        if len(turn) <= room:
            kept.append(turn)
            room -= len(turn)
            continue
        if i == 0:
            keep = max(room - 2, 0)
            turn = _turn(m["role"], text_ids[-keep:] if keep else [])
            kept.append(turn)
            room -= len(turn)
        break

    system_kept = []  # newest first
    for m in reversed(system):
        turn = _turn("user", sft.encode_text(m["content"]))
        if len(turn) <= room:
            system_kept.append(turn)
            room -= len(turn)

    ids = [sft.eot_id]
    for turn in reversed(system_kept):
        ids.extend(turn)
    for turn in reversed(kept):
        ids.extend(turn)
    ids.append(sft.role_ids["anima"])
    return ids


# --------------------------- lessons ---------------------------

@dataclass
class LessonExample:
    """One taught correction, encoded for SFT and (when possible) DPO."""
    prompt_ids: list[int]
    sft_ids: list[int]
    sft_targets: list[int]
    chosen_seq: tuple[list[int], int]
    rejected_seq: tuple[list[int], int] | None


def _reply_ids(text: str, limit: int) -> list[int]:
    ids = sft.encode_text(text)[: max(limit - 1, 0)]
    return ids + [sft.eot_id]


def encode_lesson(messages, chosen: str, rejected: str | None, block_size: int) -> LessonExample:
    """Chosen and rejected replies share one prompt so DPO compares like with like."""
    sft.init_tokenizer()
    max_reply = max(block_size - block_size // 4, 8)
    chosen_ids = _reply_ids(chosen, max_reply)
    rejected_ids = None
    if rejected and rejected.strip() and rejected.strip() != chosen.strip():
        rejected_ids = _reply_ids(rejected, max_reply)
    longest = max(len(chosen_ids), len(rejected_ids or []))
    prompt = fit_prompt(messages, block_size - longest)
    start = len(prompt)
    return LessonExample(
        prompt_ids=prompt,
        sft_ids=prompt + chosen_ids,
        sft_targets=[-100] * start + chosen_ids,
        chosen_seq=(prompt + chosen_ids, start),
        rejected_seq=(prompt + rejected_ids, start) if rejected_ids else None,
    )


# --------------------------- sampling ---------------------------

def clamp_temperature(value) -> float:
    try:
        value = float(value)
    except (TypeError, ValueError):
        return 0.8
    if value != value or value in (float("inf"), float("-inf")):
        return 0.8
    return min(max(value, 1e-5), 2.0)


def iter_reply_tokens(model, prompt_ids, max_tokens: int, temperature=0.8, top_k=40):
    """Yield sampled token ids until Anima closes her turn or the budget ends."""
    cfg = model.cfg
    device = next(model.parameters()).device
    temperature = clamp_temperature(temperature)
    k = min(int(top_k), cfg.vocab_size) if top_k else 0
    stop = {sft.eot_id, *sft.role_ids.values()}
    idx = torch.tensor([prompt_ids[-cfg.block_size:]], dtype=torch.long, device=device)
    for _ in range(max(int(max_tokens), 0)):
        with torch.no_grad():
            logits, _ = model(idx[:, -cfg.block_size:])
        logits = logits[:, -1, :] / temperature
        if k > 0:
            v, _ = torch.topk(logits, k)
            logits[logits < v[:, [-1]]] = float("-inf")
        nxt = torch.multinomial(F.softmax(logits, dim=-1), 1)
        t = nxt.item()
        if t in stop:
            return
        yield t
        idx = torch.cat([idx, nxt], dim=1)


def iter_text_deltas(token_iter):
    """Decode a token stream into text pieces without splitting UTF-8 bytes.

    ByteLevel BPE can end a token in the middle of a multi-byte character;
    that decodes to U+FFFD until the next token completes it, so hold back
    until the text is whole again.
    """
    out: list[int] = []
    emitted = ""
    for t in token_iter:
        out.append(t)
        text = sft.tok.decode(out)
        if text.endswith("�") or not text.startswith(emitted):
            continue
        if len(text) > len(emitted):
            yield text[len(emitted):]
            emitted = text
    final = sft.tok.decode(out) if out else ""
    if final.startswith(emitted) and len(final) > len(emitted):
        yield final[len(emitted):]


def generate_text(model, prompt_ids, max_tokens: int, temperature=0.8, top_k=40) -> tuple[str, int, bool]:
    """(reply text, tokens generated, hit the length limit)."""
    tokens = list(iter_reply_tokens(model, prompt_ids, max_tokens, temperature, top_k))
    return sft.tok.decode(tokens), len(tokens), len(tokens) >= max_tokens
