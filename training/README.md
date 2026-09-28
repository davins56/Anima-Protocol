# Anima Model — Training Pipeline & Serving

From-scratch LLM for the Anima Protocol app, sized for free-tier GPUs.

**Scope, honestly:** the default config is ~34M parameters with a
1024-token window. That is enough for coherent, finished sentences in the
voice of your corpus — it is not enough for doctoral-grade prose. The
production scribe voice lives on open weights:
[`scripts/llm/Modelfile.anima-scribe`](../scripts/llm/Modelfile.anima-scribe)
(see `docs/custom-llm.md` → "Scribe voice"). Treat this pipeline as the
research / preview model.

## Pipeline

| Phase | Script | Output |
|-------|--------|--------|
| 1 — Pretrain | `training/phase1/train.py` (+ `data_pipeline.py`) | `out/anima-tiny/ckpt.pt` |
| 2 — SFT | `training/phase2/sft.py` | `out/anima-sft/ckpt.pt` |
| 3 — DPO | `training/phase3/dpo.py` | `out/anima-dpo/ckpt.pt` |
| 4 — Serve | `server/server.py` | Local OpenAI-style API on 127.0.0.1:8000 |

Paths are anchored at the repo root, so the commands below work from any cwd.
Checkpoints and tokenizer outputs (`out/`, `data/anima_tokens/`, `data/anima_corpus.txt`) are gitignored.

## Quickstart (Colab)

1. `mkdir -p data/raw data/sft data/prefs` and add your corpus + datasets.
2. `python training/phase1/data_pipeline.py` → `python training/phase1/train.py`
3. `python training/phase2/sft.py` → `python training/phase3/dpo.py`
4. `python server/server.py` (listens on 127.0.0.1:8000 only).

## Why replies used to come out as incomplete thoughts

The first cut of this pipeline had a 256-token window, and three things
followed from it. Any SFT conversation longer than 256 tokens was thrown
away, so the model never saw a long, finished reply and learned to stop
early. The server truncated the prompt on a raw token boundary, which could
slice a message in half or drop the role marker. And generation re-fed only
the last 256 tokens each step, so on a long answer the user's question slid
out of the window mid-reply and the model drifted.

Current behavior:

- `block_size` is 1024; attention uses the fused kernel so it fits a T4 in fp16.
- SFT (`sft.fit_conversation`) drops the *oldest turns* of an over-long
  conversation instead of the whole example.
- Serving reserves room for the reply, never lets the prompt leave the
  window, suppresses `<|endoftext|>` for the first `min_tokens`, applies a
  repetition penalty, and stops at the first sentence end once 75% of the
  budget is spent. A reply that still hits the cap is trimmed back to its
  last complete sentence and reported with `finish_reason: "length"`.
- Pretraining keeps the best-validation checkpoint, not the last one — on a
  small corpus the overfit final checkpoint is the one that rambles.

## Corpus size

`train.py` sees ~390M tokens over its 6000 steps. A handful of novels is
1–5M tokens, so the model will loop over them many times; watch `val` in the
log and let best-val checkpointing do its job. To lift fluency, add
public-domain literary prose (Project Gutenberg) to `data/raw/` alongside
your own transcripts — keep your material in the majority if you want the
voice to stay yours.

## Local checkpoint server

`server/server.py` exposes `/v1/chat/completions` (streaming and
non-streaming) for this tiny-GPT checkpoint. The api-server can use it as the
companion chat backend with `ANIMA_LOCAL_LLM_BACKEND=vllm` and
`ANIMA_LOCAL_LLM_BASE_URL` set to its `/v1`. Production anima-protocol.com
stays on the self-hosted `anima-chat` Ollama model until you switch it. See
[`docs/custom-llm.md`](../docs/custom-llm.md), "Your own trained model".

To listen beyond localhost, set `ANIMA_SERVER_TOKEN` and `ANIMA_HOST=0.0.0.0`.
Clients then send `Authorization: Bearer <token>`. `ANIMA_CKPT` and
`ANIMA_TOK_DIR` override the checkpoint and tokenizer paths.
`python3 server/test_server.py` checks the protocol against a tiny
random-weight model.

## Status

- [x] Phase 1 — pretrain (small GPT, ~34M params, 1024-token window)
- [x] Phase 2 — SFT (chat format with role tokens)
- [x] Phase 3 — DPO (tone & guardrail preferences)
- [x] Phase 4 — serving (OpenAI-compatible API, complete-thought sampler)
