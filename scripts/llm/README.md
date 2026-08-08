# Anima Protocol LLM starter stack

Build a **chat LLM you own** — public open weights + local inference — so companions do not depend on ChatGPT, Gemini, or Groq.

## Goals

- Replace cloud chat APIs with a self-hosted Anima model (`ANIMA_LLM_PROVIDER=custom`).
- Bootstrap on a laptop (Ollama + Qwen2.5 3B → `anima-chat`).
- Upgrade on GPU (fine-tune Ministral 3 8B → vLLM / GGUF).
- Export conversation data in ShareGPT / ChatML / Alpaca JSONL.
- Retrieve long-term memory before every generation.

## Quick start (chat today)

```bash
pnpm llm:up                 # pull open weights + create anima-chat
pnpm llm:chat -- "Who are you?"

export ANIMA_LLM_PROVIDER=custom
export ANIMA_LOCAL_LLM_BACKEND=ollama
export ANIMA_LOCAL_LLM_BASE_URL=http://localhost:11434/v1
export ANIMA_OLLAMA_MODEL_STANDARD=anima-chat
```

## GPU fine-tune path

```bash
pnpm llm:prepare-finetune

python scripts/llm/finetune/unsloth_sft.py \
  --data scripts/llm/output/finetune-sharegpt.jsonl \
  --base mistralai/Ministral-3-8B-Base-2512

docker compose -f scripts/llm/docker-compose.vllm.yml up
export ANIMA_LOCAL_LLM_BACKEND=vllm
export ANIMA_LOCAL_LLM_BASE_URL=http://localhost:8000/v1
```

Short guide: [`docs/custom-llm.md`](../../docs/custom-llm.md) · Full: [`docs/llm-build.md`](../../docs/llm-build.md).

## Production (always-on, public HTTPS)

The commands above run on your laptop only — Vercel can't reach `localhost`.
For a real deployment, see [`deploy/ollama-fly/`](../../deploy/ollama-fly/README.md):
one `fly deploy` gets you the same `anima-chat` model behind an authenticated,
always-on public URL, ready to plug into `ANIMA_LOCAL_LLM_BASE_URL`.

## Lineup

| Role | Model | Notes |
|------|-------|-------|
| Bootstrap chat | `anima-chat` ← `qwen2.5:3b` | CPU / laptop, ~2 GB |
| Primary GPU chat | Fine-tuned Ministral 3 8B | Q4_K_M / FP8 on ~8–16 GB |
| Fine-tune base | `mistralai/Ministral-3-8B-Base-2512` | BF16 Base for LoRA/QLoRA |
| Custom mode | `ANIMA_LLM_PROVIDER=custom` | Self-hosted only — no Gemini/Groq/Kimi/Grok/Gateway |
