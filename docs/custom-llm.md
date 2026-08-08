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

### Exact fix — “Anima custom LLM is selected…”

That banner is intentional: custom mode is on, but `ANIMA_LOCAL_LLM_BASE_URL` is empty or the endpoint is unreachable. Cloud BYOK (Gemini/Groq/Kimi/Grok/ChatGPT/Gateway) is **deliberately disabled**.

1. **Host an OpenAI-compatible server** (Ollama or vLLM) reachable over **public HTTPS** — it has to be always-on, since Vercel can't reach `localhost` or a laptop that's asleep.
   - **Ready-made:** [`deploy/ollama-fly/`](../deploy/ollama-fly/README.md) — `fly deploy` builds the `anima-chat` model into an image and serves it behind an authenticated reverse proxy, with a public `https://<app>.fly.dev` URL out of the box. Start here unless you already have a host.
   - Or run Ollama/vLLM anywhere else with a public HTTPS URL (a reverse proxy, Cloudflare Tunnel, ngrok, another cloud VM, …) — just make sure it's actually authenticated; Ollama has none built in.
2. **Set these on Vercel (Production)** and redeploy **without build cache**:

```bash
ANIMA_LLM_PROVIDER=custom                    # literal word "custom" — never an API key
ANIMA_LOCAL_LLM_BACKEND=ollama
ANIMA_LOCAL_LLM_BASE_URL=https://<your-host>/v1
ANIMA_OLLAMA_MODEL_STANDARD=anima-chat       # or the model id your server serves
```

3. Do **not** leave `ANIMA_LLM_PROVIDER=auto` (or paste a key into that field). Custom mode will not fall through to the cloud chain.

### Quick diagnostic checklist

```bash
curl -s https://www.anima-protocol.com/api/healthz/llm | jq '{mode,preferred,keys,localEndpoint,note}'
# healthy custom mode: mode=local, preferred=local, keys.local=true,
# localEndpoint.configured=true, localEndpoint.host=<your-host>, hasV1Path=true

# Live probe (tiny completion against the configured endpoint):
curl -s 'https://www.anima-protocol.com/api/healthz/llm?probe=1' | jq '{preferred,probeOk,localEndpoint,probes}'
```

Also verify the tunnel itself:

```bash
curl -sS https://<your-host>/v1/models
# model id in the list must match ANIMA_OLLAMA_MODEL_STANDARD
```

| Check | Expect |
|-------|--------|
| `/v1/models` or `/v1/chat/completions` on the tunnel | Valid OpenAI-compatible JSON |
| `ANIMA_OLLAMA_MODEL_STANDARD` | Exists on that server |
| `/api/healthz/llm` → `localEndpoint` | `configured: true`, correct `host`, `hasV1Path: true` |
| Vercel function logs | One `[llm] local client: host=… model=…` line at init |

Once those two vars are set and the endpoint is reachable, the banner disappears and the next chat turn uses your model.

### Cloud-chain confusion

If chat shows **“LLM credits/quota exhausted (tried Gemini → …)”**, production is still on the cloud chain — not Anima LLM. Set `ANIMA_LLM_PROVIDER=custom` and a public `ANIMA_LOCAL_LLM_BASE_URL` as above.

Full troubleshooting: [`docs/vercel-api-migration.md`](./vercel-api-migration.md).
