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
# $0 accounts auto-fall back to google/gemma-4-31b-it:free on HTTP 402.
# To skip Venice from the first turn: ANIMA_OPENROUTER_FREE=true
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

Registry/CLI: [`lib/llm/README.md`](../../lib/llm/README.md) · Production host: [`deploy/ollama-fly/README.md`](../../deploy/ollama-fly/README.md).

## Production (always-on, public HTTPS)

The commands above run on your laptop only. The Cloudflare Worker at
`anima-protocol.com` cannot reach `localhost` (isolate fetch → CF error 1003)
and will not invent `http://localhost:11434/v1`. Set
`ANIMA_LOCAL_LLM_BASE_URL` to a public HTTPS `…/v1` URL, or bind
`OPENROUTER_API_KEY` so chat can use OpenRouter.

For a real self-hosted deployment, see
[`deploy/ollama-fly/`](../../deploy/ollama-fly/README.md): one `fly deploy`
gets you the same `anima-chat` model behind an authenticated, always-on
public URL, ready to plug into the Worker as `ANIMA_LOCAL_LLM_BASE_URL`.

## Lineup

| Role | Model | Notes |
|------|-------|-------|
| Bootstrap chat | `anima-chat` ← `qwen2.5:3b` | CPU / laptop, ~2 GB |
| Primary GPU chat | Fine-tuned Ministral 3 8B | Q4_K_M / FP8 on ~8–16 GB |
| Fine-tune base | `mistralai/Ministral-3-8B-Base-2512` | BF16 Base for LoRA/QLoRA |
| Chat backend | `ANIMA_LOCAL_LLM_BASE_URL` | The only chat backend — no Gemini/Groq/Kimi/Grok/Gateway path exists |

## Supported open-weight families

Run `pnpm llm:list-open-models` for the source-of-truth catalog. The five
documented families are:

| Family | Ollama example | vLLM / Hugging Face example | OpenRouter free example |
|--------|----------------|-----------------------------|-------------------------|
| Llama | `llama3.1:8b` | `meta-llama/Llama-3.1-8B-Instruct` | `meta-llama/llama-3.3-70b-instruct:free` |
| Qwen | `qwen2.5:3b` | `Qwen/Qwen2.5-7B-Instruct` | `qwen/qwen-2.5-7b-instruct:free` |
| Mistral | `mistral:7b` | `mistralai/Ministral-3-8B-Instruct-2512` | `mistralai/mistral-small-3.2-24b-instruct:free` |
| Gemma | `gemma3:4b` | `google/gemma-3-4b-it` | `google/gemma-3-12b-it:free` |
| DeepSeek | `deepseek-r1:7b` | `deepseek-ai/DeepSeek-R1-Distill-Qwen-7B` | `deepseek/deepseek-r1:free` |

For OpenRouter, set `ANIMA_OPENROUTER_MODEL_FAMILY=llama|qwen|mistral|gemma|deepseek`.
Exact `ANIMA_OPENROUTER_MODEL_STANDARD` / tier overrides still take precedence.
