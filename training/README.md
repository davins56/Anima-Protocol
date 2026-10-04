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
| 4 — Into the app | `server/export_web.py` | `anima-model.bin`, uploaded in Settings → Model Tutor; runs in the browser, learns via `server/trainer.py` |

Paths are anchored at the repo root, so the commands below work from any cwd.
Checkpoints and tokenizer outputs (`out/`, `data/anima_tokens/`, `data/anima_corpus.txt`) are gitignored.

## Quickstart (Colab)

1. `mkdir -p data/raw data/sft data/prefs` and add your corpus + datasets.
2. `python training/phase1/data_pipeline.py` → `python training/phase1/train.py`
3. `python training/phase2/sft.py` → `python training/phase3/dpo.py`
4. `python server/export_web.py` → upload `out/anima-model.bin` in Settings → Model Tutor.

Steward corrections (Settings → Model Tutor → **Download for retraining**) land in
`data/sft/steward_lessons.jsonl` and `data/prefs/steward_preferences.jsonl`; both
Phase 2 and Phase 3 fold them in automatically alongside `anima_dialogues.jsonl` /
`anima_preferences.jsonl` whenever the files exist — no extra flag needed.

## Quick CPU smoke test (no GPU)

The defaults above target a free Colab/Kaggle T4. To sanity-check the whole
pipeline on a laptop or a GPU-less CI/sandbox VM in minutes instead of hours,
every Phase 1–3 hyperparameter can be overridden with an env var — unset vars
keep the Colab-sized defaults, so nothing changes for a normal run:

```bash
# Phase 1 — shrink the model and the schedule
ANIMA_TRAIN_BLOCK_SIZE=512 ANIMA_TRAIN_N_LAYER=4 ANIMA_TRAIN_N_HEAD=4 \
ANIMA_TRAIN_N_EMBD=128 ANIMA_TRAIN_BATCH_SIZE=8 ANIMA_TRAIN_GRAD_ACCUM_STEPS=1 \
ANIMA_TRAIN_MAX_ITERS=700 ANIMA_TRAIN_WARMUP_ITERS=30 \
ANIMA_TRAIN_EVAL_INTERVAL=100 ANIMA_TRAIN_EVAL_ITERS=10 \
  python training/phase1/data_pipeline.py && python training/phase1/train.py

# Phase 2 — fewer epochs/smaller batches on the same tiny checkpoint
ANIMA_SFT_EPOCHS=10 ANIMA_SFT_BATCH_SIZE=8 ANIMA_SFT_LR=3e-4 python training/phase2/sft.py

# Phase 3
ANIMA_DPO_EPOCHS=3 ANIMA_DPO_BATCH_SIZE=4 python training/phase3/dpo.py

python server/export_web.py
```

On a 4-core CPU VM with ~80K tokens of corpus, this ran a real ~3M-parameter
model through all three phases (loss falling 9.0 → 3.8 in Phase 1, DPO
pair-accuracy reaching 1.0) in well under 10 minutes total, and the exported
`anima-model.bin` served real completions from `server/server.py`. Point
`ANIMA_SFT_DATA` / `ANIMA_DPO_DATA` / `ANIMA_SFT_OUT_DIR` / `ANIMA_DPO_OUT_DIR`
(and friends — see the top of each script) at a scratch directory first if
you don't want to touch `data/sft/anima_dialogues.jsonl` or
`data/prefs/anima_preferences.jsonl`. This is a correctness smoke test, not a
substitute for a real corpus and a GPU — the resulting model is not fluent.

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
