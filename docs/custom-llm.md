# Custom Anima LLM (self-hosted)

Run Anima chat on **your own model** — no Gemini, Groq, Kimi, Grok, or AI Gateway.

The frontend stays the same (`POST /api/chat/messages`). Only the api-server’s LLM backend changes.

## Quick start

### 1. Serve a model (pick one)

**vLLM** (best throughput, needs NVIDIA GPU):

```bash
export ANIMA_VLLM_MODEL=Qwen/Qwen3.6-27B   # or your fine-tuned checkpoint
docker compose -f scripts/llm/docker-compose.vllm.yml up
```

**Ollama** (simpler single-user):

```bash
# After converting your fine-tune to GGUF:
ollama create anima-qwen27b -f scripts/llm/Modelfile.anima-qwen27b
```

### 2. Point the api-server at it

```bash
export ANIMA_LLM_PROVIDER=custom
export ANIMA_LOCAL_LLM_BASE_URL=http://localhost:8000/v1   # or http://localhost:11434/v1
export ANIMA_VLLM_MODEL_STANDARD=Qwen/Qwen3.6-27B          # must match served name
# For Ollama:
# export ANIMA_LOCAL_LLM_BACKEND=ollama
# export ANIMA_OLLAMA_MODEL_STANDARD=anima-qwen27b
```

Leave `GEMINI_API_KEY`, `GROQ_API_KEY`, `KIMI_API_KEY`, `XAI_API_KEY`, and `AI_GATEWAY_API_KEY` unset.

### 3. Verify

```bash
curl -s http://localhost:8080/api/healthz/llm | jq
# expect: "mode":"local", "preferred":"local", "brand":"anima", "keys.local": true
```

## Modes

| `ANIMA_LLM_PROVIDER` | Behavior |
|----------------------|----------|
| `custom` / `anima` / `local` | **Self-hosted only** (recommended) |
| `local-first` | Local first, then optional cloud BYOK if keys exist |
| `auto` | Cloud BYOK only (not used for a custom model) |
| `ensemble` | Opt-in cloud parallel minds (not the custom path) |

Aliases: `custom`, `anima`, and `local` all mean the same self-hosted path.

## Fine-tune your own weights

See [`docs/llm-build.md`](./llm-build.md) for dataset export, Unsloth / LLaMA-Factory SFT, and memory retrieval.

```bash
pnpm llm:prepare-finetune
pnpm llm:serve-hint
```

## Production note

Vercel serverless cannot reach a GPU on your laptop. For production custom LLM:

1. Host vLLM/Ollama on a GPU box with a public HTTPS URL (or run the whole api-server next to the GPU), and  
2. Set `ANIMA_LOCAL_LLM_BASE_URL` to that URL on the api-server.

Image generation still uses `OPENAI_API_KEY` if you enable look generation — chat does not.
