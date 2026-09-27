# Anima Model — Training Pipeline & Serving

From-scratch LLM for the Anima Protocol app, sized for free-tier GPUs.

## Pipeline

| Phase | Script | Output |
|-------|--------|--------|
| 1 — Pretrain | `training/phase1/train.py` (+ `data_pipeline.py`) | `out/anima-tiny/ckpt.pt` |
| 2 — SFT | `training/phase2/sft.py` | `out/anima-sft/ckpt.pt` |
| 3 — DPO | `training/phase3/dpo.py` | `out/anima-dpo/ckpt.pt` |
| 4 — Serve + learn | `server/server.py` | OpenAI-compatible API that learns from lessons taught in the app |

Paths are anchored at the repo root, so the commands below work from any cwd.
Checkpoints and tokenizer outputs (`out/`, `data/anima_tokens/`, `data/anima_corpus.txt`) are gitignored.

## Quickstart (Colab)

1. `mkdir -p data/raw data/sft data/prefs` and add your corpus + datasets.
2. `python training/phase1/data_pipeline.py` → `python training/phase1/train.py`
3. `python training/phase2/sft.py` → `python training/phase3/dpo.py`
4. `python server/server.py` (listens on 127.0.0.1:8000 only).

## Serving, and teaching it from the app

`server/server.py` serves this checkpoint as an OpenAI-compatible API
(`/v1/chat/completions`, streaming or not) and fine-tunes it on lessons the
steward teaches in the app — **Teach** under a chat reply, and Settings → Model
Tutor. The steward can route their own chats to it; everyone else stays on the
self-hosted `anima-chat` model. Setup, deploy and how learning works:
[`docs/own-model.md`](../docs/own-model.md).

To listen beyond localhost, set `ANIMA_SERVER_TOKEN` and `ANIMA_HOST=0.0.0.0`.
Clients then send `Authorization: Bearer <token>`.

Lessons downloaded from the app (`steward_lessons.jsonl`,
`steward_preferences.jsonl`) go in `data/sft/` and `data/prefs/`; phases 2 and 3
train on them alongside your datasets.

Tests: `pip install -r server/requirements-test.txt && python -m unittest discover -s server/tests`.

## Status

- [x] Phase 1 — pretrain (tiny GPT, ~10M params)
- [x] Phase 2 — SFT (chat format with role tokens)
- [x] Phase 3 — DPO (tone & guardrail preferences)
- [x] Phase 4 — serving (OpenAI-compatible API)
- [x] Phase 5 — learns from lessons taught in the app (`server/learning.py`)
