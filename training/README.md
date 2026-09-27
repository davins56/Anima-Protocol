# Anima Model — Training Pipeline & Serving

From-scratch LLM for the Anima Protocol app, sized for free-tier GPUs.

## Pipeline

| Phase | Script | Output |
|-------|--------|--------|
| 1 — Pretrain | `training/phase1/train.py` (+ `data_pipeline.py`) | `out/anima-tiny/ckpt.pt` |
| 2 — SFT | `training/phase2/sft.py` | `out/anima-sft/ckpt.pt` |
| 3 — DPO | `training/phase3/dpo.py` | `out/anima-dpo/ckpt.pt` |
| 4 — Serve | `server/server.py` | OpenAI-compatible API at :8000 |

## Quickstart (Colab)

1. `mkdir -p data/raw data/sft data/prefs` and add your corpus + datasets.
2. `python training/phase1/data_pipeline.py` → `python training/phase1/train.py`
3. `python training/phase2/sft.py` → `python training/phase3/dpo.py`
4. `uvicorn server:app` (run from `server/`), then point the app at
   `http://localhost:8000/v1` with any apiKey.

## App integration

The server mimics the OpenAI chat completions contract (`/v1/chat/completions`,
`/v1/models`), so existing client code works with a base-URL change only.

## Status

- [x] Phase 1 — pretrain (tiny GPT, ~10M params)
- [x] Phase 2 — SFT (chat format with role tokens)
- [x] Phase 3 — DPO (tone & guardrail preferences)
- [x] Phase 4 — serving (OpenAI-compatible API)
