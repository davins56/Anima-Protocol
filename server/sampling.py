# Anima Protocol — Ollama-style sampling for the served model.
#
# The api-server tunes replies through the knobs Ollama exposes (options on
# /api/chat, PARAMETER lines in a Modelfile). This module gives the own model
# the same knobs, applied in llama.cpp's order: repeat / presence / frequency
# penalties over a recent window, temperature, top_k, top_p, min_p. A seed
# makes one request reproducible without touching the global RNG, and stop
# strings end a reply the way Ollama's `stop` does.
#
# Streaming and non-streaming replies come from the same generator
# (`reply_pieces`), so the same seed gives the same text either way.

from __future__ import annotations

import time
from dataclasses import dataclass, field, replace
from typing import Any, Iterable, Iterator, Mapping

import torch
import torch.nn.functional as F

import _paths  # noqa: F401  (puts training/phase1 and phase2 on sys.path)
import sft

MAX_NEW_TOKENS = 768
DEFAULT_MAX_TOKENS = 384
MAX_STOP_SEQUENCES = 8
MAX_STOP_CHARS = 64
# Below this temperature the sampler takes the most likely token.
GREEDY_TEMPERATURE = 1e-4
# A run-on sentence longer than this streams at a word boundary instead of
# waiting for its full stop.
STREAM_FLUSH_CHARS = 160


@dataclass(frozen=True)
class SamplingOptions:
    """One request's sampler. Field names follow Ollama's `options`."""

    temperature: float = 0.8
    top_k: int = 40
    top_p: float = 0.9
    min_p: float = 0.0
    # The repetition penalty this server always used (Ollama's default is 1.1).
    repeat_penalty: float = 1.15
    # Tokens of context the penalties look back over; -1 means the whole window.
    repeat_last_n: int = 64
    presence_penalty: float = 0.0
    frequency_penalty: float = 0.0
    seed: int | None = None
    stop: tuple[str, ...] = ()
    num_predict: int = DEFAULT_MAX_TOKENS
    # Context window in tokens. Never more than the model's block_size.
    num_ctx: int | None = None
    # End-of-turn is blocked for this many tokens so a reply is not a fragment.
    min_tokens: int = 0
    extra: dict[str, Any] = field(default_factory=dict, compare=False)


def _number(value, cast=float):
    if value is None or isinstance(value, bool):
        return None
    try:
        out = cast(value)
    except (TypeError, ValueError):
        return None
    if isinstance(out, float) and out != out:  # NaN
        return None
    if isinstance(out, float) and out in (float("inf"), float("-inf")):
        return None
    return out


def _clamp(value, low, high):
    return min(max(value, low), high)


def _stops(value) -> tuple[str, ...]:
    if value is None:
        return ()
    if isinstance(value, str):
        value = [value]
    if not isinstance(value, (list, tuple)):
        return ()
    out = []
    for item in value:
        if isinstance(item, str) and item and item not in out:
            out.append(item[:MAX_STOP_CHARS])
    return tuple(out[:MAX_STOP_SEQUENCES])


def merge_options(base: SamplingOptions, overrides: Mapping[str, Any] | None) -> SamplingOptions:
    """Apply request (or Modelfile) options on top of `base`.

    Unknown names and values that are not numbers are ignored, as Ollama
    does, so an option meant for another model never fails a request.
    """
    if not overrides:
        return base
    changes: dict[str, Any] = {}
    temperature = _number(overrides.get("temperature"))
    if temperature is not None:
        changes["temperature"] = _clamp(temperature, 0.0, 2.0)
    top_k = _number(overrides.get("top_k"), int)
    if top_k is not None:
        changes["top_k"] = max(top_k, 0)
    top_p = _number(overrides.get("top_p"))
    if top_p is not None:
        changes["top_p"] = _clamp(top_p, 0.0, 1.0) or 1.0
    min_p = _number(overrides.get("min_p"))
    if min_p is not None:
        changes["min_p"] = _clamp(min_p, 0.0, 0.99)
    repeat = overrides.get("repeat_penalty", overrides.get("repetition_penalty"))
    repeat = _number(repeat)
    if repeat is not None:
        changes["repeat_penalty"] = _clamp(repeat, 0.0, 2.0) or 1.0
    last_n = _number(overrides.get("repeat_last_n"), int)
    if last_n is not None:
        changes["repeat_last_n"] = max(last_n, -1)
    for name in ("presence_penalty", "frequency_penalty"):
        value = _number(overrides.get(name))
        if value is not None:
            changes[name] = _clamp(value, -2.0, 2.0)
    if "seed" in overrides:
        seed = _number(overrides.get("seed"), int)
        changes["seed"] = seed if seed is not None and seed >= 0 else None
    if "stop" in overrides:
        changes["stop"] = _stops(overrides.get("stop"))
    num_predict = _number(overrides.get("num_predict"), int)
    if num_predict is not None:
        # Ollama uses -1 (and -2) for "until the window is full".
        changes["num_predict"] = MAX_NEW_TOKENS if num_predict < 0 else _clamp(num_predict, 1, MAX_NEW_TOKENS)
    num_ctx = _number(overrides.get("num_ctx"), int)
    if num_ctx is not None and num_ctx > 0:
        changes["num_ctx"] = num_ctx
    min_tokens = _number(overrides.get("min_tokens"), int)
    if min_tokens is not None:
        changes["min_tokens"] = _clamp(min_tokens, 0, 128)
    return replace(base, **changes) if changes else base


def context_window(model, options: SamplingOptions) -> int:
    """Tokens the prompt and reply share: num_ctx, capped at block_size."""
    block = int(model.cfg.block_size)
    if options.num_ctx:
        return _clamp(int(options.num_ctx), 8, block)
    return block


def protected_ids() -> set[int]:
    """Turn markers. Penalties never touch them, or a reply could not end."""
    sft.init_tokenizer()
    return {sft.eot_id, *sft.role_ids.values()}


def next_token(
    logits: torch.Tensor,
    history: list[int],
    options: SamplingOptions,
    *,
    protected: set[int],
    suppress: Iterable[int] = (),
    generator: torch.Generator | None = None,
) -> int:
    """Pick one token from a 1-D logits row."""
    logits = logits.float().clone()
    vocab = logits.shape[-1]
    for token in suppress:
        logits[token] = float("-inf")

    if options.repeat_last_n == 0:
        window = []
    elif options.repeat_last_n < 0:
        window = history
    else:
        window = history[-options.repeat_last_n:]
    window = [t for t in window if t not in protected and 0 <= t < vocab]
    if window:
        seen, counts = torch.unique(
            torch.tensor(window, dtype=torch.long, device=logits.device), return_counts=True,
        )
        if options.repeat_penalty != 1.0:
            picked = logits[seen]
            logits[seen] = torch.where(
                picked > 0, picked / options.repeat_penalty, picked * options.repeat_penalty,
            )
        if options.frequency_penalty or options.presence_penalty:
            logits[seen] -= counts.to(logits.dtype) * options.frequency_penalty + options.presence_penalty

    if options.temperature <= GREEDY_TEMPERATURE:
        return int(torch.argmax(logits).item())

    logits = logits / options.temperature
    k = min(int(options.top_k), vocab) if options.top_k else 0
    if 0 < k < vocab:
        kth = torch.topk(logits, k).values[-1]
        logits[logits < kth] = float("-inf")
    probs = F.softmax(logits, dim=-1)

    if options.top_p < 1.0:
        sorted_probs, order = torch.sort(probs, descending=True)
        before = torch.cumsum(sorted_probs, dim=-1) - sorted_probs
        drop = before > options.top_p
        drop[0] = False  # the most likely token always survives
        probs[order[drop]] = 0.0
    if options.min_p > 0.0:
        probs[probs < options.min_p * probs.max()] = 0.0

    total = probs.sum()
    if not torch.isfinite(total) or total <= 0:
        return int(torch.argmax(logits).item())
    probs = probs / total
    return int(torch.multinomial(probs, 1, generator=generator).item())


def make_generator(options: SamplingOptions, device) -> torch.Generator | None:
    if options.seed is None:
        return None
    generator = torch.Generator(device=device)
    generator.manual_seed(int(options.seed))
    return generator


def iter_tokens(model, prompt_ids: list[int], options: SamplingOptions) -> Iterator[int]:
    """Yield reply token ids until Anima closes her turn or the budget ends.

    The generator's return value is the finish reason, "stop" or "length".
    """
    window = context_window(model, options)
    device = next(model.parameters()).device
    protected = protected_ids()
    budget = max(1, min(int(options.num_predict), window - min(len(prompt_ids), window - 1)))
    generator = make_generator(options, device)
    history = list(prompt_ids)
    idx = torch.tensor([prompt_ids[-window:]], dtype=torch.long, device=device)
    model.eval()
    for step in range(budget):
        with torch.no_grad():
            logits, _ = model(idx[:, -window:])
        token = next_token(
            logits[0, -1, :],
            history,
            options,
            protected=protected,
            suppress=protected if step < options.min_tokens else (),
            generator=generator,
        )
        if token in protected:
            return "stop"
        yield token
        history.append(token)
        idx = torch.cat([idx, torch.tensor([[token]], dtype=torch.long, device=device)], dim=1)
    return "length"


def _sentence_end(text: str) -> int:
    """Index just past the last sentence end, as sft.trim_to_sentence finds it."""
    best = 0
    for end in sft.SENTENCE_END:
        idx = text.rfind(end)
        if idx >= 0:
            best = max(best, idx + len(end))
    return best


def _find_stop(text: str, stops: tuple[str, ...]) -> int | None:
    hits = [text.find(s) for s in stops]
    hits = [h for h in hits if h >= 0]
    return min(hits) if hits else None


def _partial_stop(text: str, stops: tuple[str, ...]) -> int:
    """Length of the longest tail of `text` that could open a stop string."""
    longest = 0
    for stop in stops:
        for n in range(min(len(stop) - 1, len(text)), 0, -1):
            if text.endswith(stop[:n]):
                longest = max(longest, n)
                break
    return longest


@dataclass
class ReplyStats:
    """What Ollama reports in the final `done` message."""

    finish_reason: str = "stop"
    prompt_tokens: int = 0
    completion_tokens: int = 0
    prompt_ns: int = 0
    eval_ns: int = 0


def reply_pieces(model, prompt_ids: list[int], options: SamplingOptions, stats: ReplyStats | None = None):
    """Yield the reply as text pieces. Returns a ReplyStats.

    Text goes out a sentence at a time, so a length-capped reply can still be
    cut back to its last finished sentence: that cut only ever falls on text
    not yet sent. A run-on sentence past STREAM_FLUSH_CHARS goes out at a word
    boundary. A stop string ends the reply and is never sent, and text that
    could be the start of one is held back until it is clear.
    """
    sft.init_tokenizer()
    stats = stats or ReplyStats()
    stats.prompt_tokens = len(prompt_ids)
    started = time.perf_counter_ns()
    steps = iter_tokens(model, prompt_ids, options)
    tokens: list[int] = []
    sent = ""
    text = ""
    finish = "length"
    stopped = False
    first_token_at = None
    while True:
        try:
            tokens.append(next(steps))
        except StopIteration as done:
            finish = done.value or "stop"
            break
        if first_token_at is None:
            first_token_at = time.perf_counter_ns()
        text = sft.tok.decode(tokens).lstrip()
        if text.endswith("�"):
            continue  # a multi-byte character is still being spelled out
        hit = _find_stop(text, options.stop)
        if hit is not None:
            text = text[:hit]
            finish = "stop"
            stopped = True
            break
        cut = _sentence_end(text)
        if cut <= len(sent) and len(text) - len(sent) > STREAM_FLUSH_CHARS:
            cut = text.rfind(" ", len(sent) + 1)
        cut -= _partial_stop(text[:max(cut, 0)], options.stop)
        if cut > len(sent) and text.startswith(sent):
            yield text[len(sent):cut]
            sent = text[:cut]
    final = (text if stopped else sft.tok.decode(tokens)).strip()
    if finish == "length":
        final = sft.trim_to_sentence(final)
    if len(final) > len(sent) and final.startswith(sent):
        yield final[len(sent):]
    ended = time.perf_counter_ns()
    stats.finish_reason = finish
    stats.completion_tokens = len(tokens)
    stats.prompt_ns = (first_token_at or ended) - started
    stats.eval_ns = ended - (first_token_at or ended)
    return stats


def generate(model, prompt_ids: list[int], options: SamplingOptions) -> tuple[str, ReplyStats]:
    """The whole reply, exactly as `reply_pieces` would stream it."""
    stats = ReplyStats()
    text = "".join(reply_pieces(model, prompt_ids, options, stats))
    return text, stats


def warm(model) -> int:
    """Run one forward pass so the first real reply skips cold-start work.

    Returns how long it took, in nanoseconds.
    """
    sft.init_tokenizer()
    started = time.perf_counter_ns()
    device = next(model.parameters()).device
    idx = torch.tensor([[sft.eot_id, sft.role_ids["anima"]]], dtype=torch.long, device=device)
    model.eval()
    with torch.no_grad():
        model(idx)
    if device.type == "cuda":
        torch.cuda.synchronize(device)
    return time.perf_counter_ns() - started
