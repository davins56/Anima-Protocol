# Custom Anima LLM — replace ChatGPT / Gemini / Groq

**What “build an LLM” means here:** OpenAI, Google, and Groq do **not** publish ChatGPT / Gemini / Groq model weights or training code. You cannot copy those products. What *is* public — and what Anima uses — is:

| Public piece | Role |
|--------------|------|
| Open weights (Qwen2.5, Ministral, Llama, Gemma, …) | The neural net that generates chat tokens |
| Ollama / llama.cpp / vLLM | Inference engines that run those weights locally |
| Anima Modelfiles + system prompts | Brand the model as your companion LLM |
| Fine-tune scripts (Unsloth / LLaMA-Factory) | Specialize it on Anima chats + memory |
| `ANIMA_LLM_PROVIDER=custom` | Api-server talks **only** to your model — no cloud chat BYOK |

The React app still calls `POST /api/chat/messages`. The brain behind it becomes **yours**.

---

## Path A — Bootstrap today (CPU / laptop)

Creates `anima-chat` from public **Qwen2.5 3B** weights (~2 GB). Good enough to engage in real chats without Gemini/Groq/OpenAI keys.

```bash
# Install Ollama from https://ollama.com if needed, then:
pnpm llm:up
# → pulls qwen2.5:3b, creates anima-chat, smoke-tests chat

pnpm llm:chat -- "Who are you?"
```

Point the api-server at it (also the defaults in `.env.example`):

```bash
export ANIMA_LLM_PROVIDER=custom
export ANIMA_LOCAL_LLM_BACKEND=ollama
export ANIMA_LOCAL_LLM_BASE_URL=http://localhost:11434/v1
export ANIMA_OLLAMA_MODEL_STANDARD=anima-chat
```

Leave `GEMINI_API_KEY`, `GROQ_API_KEY`, `KIMI_API_KEY`, `XAI_API_KEY`, and `AI_GATEWAY_API_KEY` unset.

Verify:

```bash
curl -s http://localhost:8080/api/healthz/llm | jq
# expect: "mode":"local", "preferred":"local", "brand":"anima"
```

---

## Path B — GPU upgrade (Ministral 3 8B)

| Role | Hugging Face id |
|------|-----------------|
| Serve (chat) | `mistralai/Ministral-3-8B-Instruct-2512` |
| Fine-tune base (LoRA) | `mistralai/Ministral-3-8B-Base-2512` |
| Optional memory specialist | `mistralai/Ministral-3-3B-Instruct-2512` |

Accept the Mistral license on Hugging Face and set `HUGGING_FACE_HUB_TOKEN` if the repo is gated.

### 1. Prepare your dataset

```bash
pnpm llm:prepare-finetune
# Seed + Postgres transcripts:
pnpm llm:prepare-finetune -- --with-db --user <clerk_user_id>
```

### 2. Fine-tune with LoRA (QLoRA)

```bash
pip install "unsloth[colab-new]" transformers datasets trl
python scripts/llm/finetune/unsloth_sft.py \
  --data scripts/llm/output/finetune-sharegpt.jsonl \
  --base mistralai/Ministral-3-8B-Base-2512 \
  --out scripts/llm/checkpoints/anima-ministral8b-qlora
```

Or LLaMA-Factory: `llamafactory-cli train scripts/llm/finetune/llama_factory_ministral.yaml`

### 3. Serve

**vLLM:**

```bash
export ANIMA_VLLM_MODEL=mistralai/Ministral-3-8B-Instruct-2512
docker compose -f scripts/llm/docker-compose.vllm.yml up
export ANIMA_LLM_PROVIDER=custom
export ANIMA_LOCAL_LLM_BACKEND=vllm
export ANIMA_LOCAL_LLM_BASE_URL=http://localhost:8000/v1
```

**Ollama** (after GGUF conversion):

```bash
ollama create anima-ministral8b -f scripts/llm/Modelfile.anima-ministral8b
export ANIMA_OLLAMA_MODEL_STANDARD=anima-ministral8b
```

---

## Modes

| `ANIMA_LLM_PROVIDER` | Behavior |
|----------------------|----------|
| *(unset)* / `custom` / `anima` / `local` | **Self-hosted Anima LLM only** (product default) |
| `local-first` | Local first, then optional cloud BYOK if keys exist |
| `auto` | Cloud BYOK only (Gemini → Groq → …) — opt-in only |

If `ANIMA_LLM_PROVIDER` contains an API key (`AQ.*`, `sk-`, …), it is ignored and chat **stays on custom** — it does not fall back to the cloud chain.

More detail: [`docs/llm-build.md`](./llm-build.md).

## Production note (Vercel)

If chat shows **“LLM credits/quota exhausted (tried Gemini → …)”**, production is still on the cloud chain — not Anima LLM. Check:

```bash
curl -s https://www.anima-protocol.com/api/healthz/llm | jq '{mode,preferred,keys,note}'
```

Vercel serverless cannot reach a laptop Ollama. Host Ollama/vLLM on a machine with a **public HTTPS** URL (or run the api-server beside the model), then set:

```bash
ANIMA_LLM_PROVIDER=custom          # must be the word "custom", never an API key
ANIMA_LOCAL_LLM_BACKEND=ollama
ANIMA_LOCAL_LLM_BASE_URL=https://<your-host>/v1
ANIMA_OLLAMA_MODEL_STANDARD=anima-chat
```

Redeploy without build cache. Full troubleshooting: [`docs/vercel-api-migration.md`](./vercel-api-migration.md).
