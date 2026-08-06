# Anima Protocol LLM starter stack

Fine-tune and serve a Qwen3.6-27B (or equivalent) companion model for Anima.

## Goals

- Keep the app model-agnostic (OpenAI-compatible local + cloud hybrid).
- Export conversation data in ShareGPT / ChatML / Alpaca JSONL.
- Inject character, scenario, memory, and relationship context.
- Retrieve long-term memory (structured + embeddings) before every generation.

## Quick start

```bash
# 1) Prepare SFT data (seed examples; add --with-db for live transcripts)
pnpm llm:prepare-finetune

# 2) Fine-tune (CUDA machine)
python scripts/llm/finetune/unsloth_sft.py \
  --data scripts/llm/output/finetune-sharegpt.jsonl \
  --base Qwen/Qwen3.6-27B

# 3) Serve with vLLM
docker compose -f scripts/llm/docker-compose.vllm.yml up

# 4) Point api-server at local model with cloud fallback
export ANIMA_LLM_PROVIDER=local-first
export ANIMA_LOCAL_LLM_BASE_URL=http://localhost:8000/v1
```

Full guide: [`docs/llm-build.md`](../../docs/llm-build.md).

## Suggested lineup

| Role | Model | Notes |
|------|-------|-------|
| Primary chat | Fine-tuned Qwen3.6-27B | Q4_K_M / Q5 on 24 GB |
| Memory specialist (optional) | Qwen2.5-7B Instruct | Summarize / compress |
| Cloud safety net | Gemini → Groq → Kimi → Grok → OpenAI | `local-first` failover |
| Anima ensemble | Gemini + Groq + ChatGPT minds | `ANIMA_LLM_PROVIDER=anima` |
