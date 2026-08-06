# Anima Protocol LLM starter stack

Fine-tune and serve **Ministral 3 8B** as the custom companion model for Anima.

## Goals

- Keep the app model-agnostic (OpenAI-compatible local + optional cloud hybrid).
- Export conversation data in ShareGPT / ChatML / Alpaca JSONL.
- Inject character, scenario, memory, and relationship context.
- Retrieve long-term memory (structured + embeddings) before every generation.

## Quick start

```bash
# 1) Prepare SFT data (seed examples; add --with-db for live transcripts)
pnpm llm:prepare-finetune

# 2) Fine-tune (CUDA machine) — Ministral 3 8B Base + LoRA
python scripts/llm/finetune/unsloth_sft.py \
  --data scripts/llm/output/finetune-sharegpt.jsonl \
  --base mistralai/Ministral-3-8B-Base-2512

# 3) Serve with vLLM
docker compose -f scripts/llm/docker-compose.vllm.yml up

# 4) Point api-server at your custom model (no cloud BYOK)
export ANIMA_LLM_PROVIDER=custom
export ANIMA_LOCAL_LLM_BASE_URL=http://localhost:8000/v1
```

Short guide: [`docs/custom-llm.md`](../../docs/custom-llm.md) · Full: [`docs/llm-build.md`](../../docs/llm-build.md).

## Suggested lineup

| Role | Model | Notes |
|------|-------|-------|
| Primary chat | Fine-tuned Ministral 3 8B | Q4_K_M / FP8 on ~8–16 GB |
| Fine-tune base | `mistralai/Ministral-3-8B-Base-2512` | BF16 Base for LoRA/QLoRA |
| Memory specialist (optional) | Ministral 3 3B Instruct | Summarize / compress |
| Custom mode | `ANIMA_LLM_PROVIDER=custom` | Self-hosted only — no Gemini/Groq/Kimi/Grok/Gateway |
