# Anima Model — Training Pipeline & Serving

From-scratch LLM for the Anima Protocol app, sized for free-tier GPUs.

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

## Local checkpoint server

`server/server.py` exposes `/v1/chat/completions` for this tiny-GPT checkpoint.
It is a local preview, not the production anima-protocol.com chat path (that
stays on the Cloudflare Worker and the self-hosted Ollama model).

To listen beyond localhost, set `ANIMA_SERVER_TOKEN` and `ANIMA_HOST=0.0.0.0`.
Clients then send `Authorization: Bearer <token>`.

## Status

- [x] Phase 1 — pretrain (tiny GPT, ~10M params)
- [x] Phase 2 — SFT (chat format with role tokens)
- [x] Phase 3 — DPO (tone & guardrail preferences)
- [x] Phase 4 — serving (OpenAI-compatible API)
