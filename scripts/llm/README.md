# Anima Protocol LLM starter stack

Build a **chat LLM you own** — public open weights + local inference — so companions do not depend on ChatGPT, Gemini, or Groq.

## Goals

- Prefer a self-hosted Anima model (Ollama/vLLM) — no Gemini/Groq/ChatGPT flagship chain.
- Optional OpenRouter path for Venice Uncensored (Cognitive Computations × Venice.ai) or free open-weight models when you have no GPU host.
- Bootstrap on a laptop (Ollama + Qwen2.5 3B → `anima-chat`, or Dolphin → `anima-uncensored`).
- Upgrade on GPU (fine-tune Ministral 3 8B → vLLM / GGUF).
- Export conversation data in ShareGPT / ChatML / Alpaca JSONL.
- Retrieve long-term memory before every generation.

## Quick start (chat today)

```bash
pnpm llm:up                 # pull open weights + create anima-chat
pnpm llm:chat -- "Who are you?"

export ANIMA_LOCAL_LLM_BACKEND=ollama
export ANIMA_LOCAL_LLM_BASE_URL=http://localhost:11434/v1
export ANIMA_OLLAMA_MODEL_STANDARD=anima-chat
```

### Uncensored (local Dolphin or OpenRouter Venice)

```bash
# Local (free forever once pulled):
ollama pull dolphin-mistral
ollama create anima-uncensored -f scripts/llm/Modelfile.anima-uncensored
export ANIMA_OLLAMA_MODEL_STANDARD=anima-uncensored

# Or OpenRouter (free API key at https://openrouter.ai/keys) — Venice Uncensored:
export OPENROUTER_API_KEY=sk-or-…
# Zero-cost free-tier models instead: ANIMA_OPENROUTER_FREE=true
```

### No GPU / no network to Ollama or Hugging Face? Smoke-test the wiring

`pnpm llm:up` needs to reach `ollama.com` to pull real weights. In a sandboxed
dev container without that egress (or without a GPU), use the mock server to
verify the *wiring* — env vars, local-endpoint routing, `/api/healthz/llm` —
end-to-end without a real brain behind it:

```bash
pnpm llm:mock -- --port 11555     # canned OpenAI-compatible /v1 server, NOT a real model

export ANIMA_LOCAL_LLM_BASE_URL=http://127.0.0.1:11555/v1
export ANIMA_OLLAMA_MODEL_STANDARD=anima-chat-mock
pnpm llm:chat -- "Who are you?"   # should echo back through the mock
```

Swap the mock's URL for a real Ollama/vLLM endpoint once you have GPU/hosting
— nothing else in the wiring changes.

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
| Chat backend | `ANIMA_LOCAL_LLM_BASE_URL` | The only chat backend — no Gemini/Groq/Kimi/Grok/Gateway path exists |
