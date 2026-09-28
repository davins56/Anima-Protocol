# Anima Model — Training Pipeline & Serving

From-scratch LLM for the Anima Protocol app, sized for free-tier GPUs.

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

## In the app, and teaching it

The exported model runs inside the app, on each person's device. Lessons
taught in the app (**Teach** under a chat reply, plus automatic ones when
"Always learning" is on) are learned by `server/trainer.py` on a GitHub Actions
schedule, which publishes the next version. Setup and how learning works:
[`docs/own-model.md`](../docs/own-model.md).

`server/server.py` still serves a checkpoint as an OpenAI-compatible API for
local experiments (127.0.0.1:8000; set `ANIMA_SERVER_TOKEN` and
`ANIMA_HOST=0.0.0.0` to listen wider).

Lessons downloaded from the app (`steward_lessons.jsonl`,
`steward_preferences.jsonl`) go in `data/sft/` and `data/prefs/`; phases 2 and 3
train on them alongside your datasets.

Tests: `pip install -r server/requirements-test.txt -r server/requirements-trainer.txt && python -m unittest discover -s server/tests`
(the trainer tests also need `DATABASE_URL`; they use a throwaway schema).

## Status

- [x] Phase 1 — pretrain (tiny GPT, ~10M params)
- [x] Phase 2 — SFT (chat format with role tokens)
- [x] Phase 3 — DPO (tone & guardrail preferences)
- [x] Phase 4 — serving (OpenAI-compatible API)
- [x] Phase 5 — learns from lessons taught in the app (`server/learning.py`)
