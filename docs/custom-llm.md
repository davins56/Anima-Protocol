# Custom Anima LLM — replace ChatGPT / Gemini / Groq

**What "build an LLM" means here:** OpenAI, Google, and Groq do **not** publish ChatGPT / Gemini / Groq model weights or training code. You cannot copy those products. What *is* public — and what Anima uses — is:

| Public piece | Role |
|--------------|------|
| Open weights (Qwen2.5, Ministral, Llama, Gemma, …) | The neural net that generates chat tokens |
| Ollama / llama.cpp / vLLM | Inference engines that run those weights locally |
| Anima Modelfiles + system prompts | Brand the model as your companion LLM |
| Fine-tune scripts (Unsloth / LLaMA-Factory) | Specialize it on Anima chats + memory |

The React app still calls `POST /api/chat/messages`. The brain behind it is **yours** — chat has exactly one backend, the self-hosted Anima LLM. There is no cloud flagship fallback chain in the code (no Gemini/Groq/Kimi/Grok/ChatGPT chat routing exists to fall back to), so the app can never silently switch models on you.

---

## Path A — Bootstrap today (CPU / laptop)

Creates `anima-chat` from public **Qwen2.5 3B** weights (~2 GB). Good enough to engage in real chats with no cloud API keys at all.

```bash
# Install Ollama from https://ollama.com if needed, then:
pnpm llm:up
# → pulls qwen2.5:3b, creates anima-chat, smoke-tests chat

pnpm llm:chat -- "Who are you?"
```

Point the api-server at it (also the defaults in `.env.example`):

```bash
export ANIMA_LOCAL_LLM_BACKEND=ollama
export ANIMA_LOCAL_LLM_BASE_URL=http://localhost:11434/v1
export ANIMA_OLLAMA_MODEL_STANDARD=anima-chat
```

Verify:

```bash
curl -s http://localhost:8080/api/healthz/llm | jq
# expect: "status":"ok", "preferred":"local", "brand":"anima"
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
export ANIMA_LOCAL_LLM_BACKEND=vllm
export ANIMA_LOCAL_LLM_BASE_URL=http://localhost:8000/v1
```

**Ollama** (after GGUF conversion):

```bash
ollama create anima-ministral8b -f scripts/llm/Modelfile.anima-ministral8b
export ANIMA_OLLAMA_MODEL_STANDARD=anima-ministral8b
```

---

## There is only one mode

Chat has a single backend: the self-hosted Anima LLM, reached through `ANIMA_LOCAL_LLM_BASE_URL` (OpenAI-compatible — vLLM, Ollama, or llama.cpp). There is no `ANIMA_LLM_PROVIDER` mode switch, no cloud BYOK chain, and no ensemble/multi-mind path in the code — Gemini, Groq, Kimi, Grok, ChatGPT, and Vercel AI Gateway are never called for chat, regardless of which API keys happen to be set in the environment.

`OPENAI_API_KEY` still exists as an env var, but only for image generation/edit (`/api/openai/functions` image routes) — it is never read for chat.

If the local endpoint is unavailable, the turn fails with a clear setup error instead of silently switching to a different model — see the diagnostic checklist below.

More detail on the fine-tune pipeline and self-hosted stack: [`docs/llm-build.md`](./llm-build.md).

---

## Verifying the wiring without pulling real weights (sandboxed / offline dev)

Some dev environments block outbound access to `ollama.com` / Hugging Face
(egress allowlists, CI runners, restricted sandboxes). `pnpm llm:up` can't
pull weights there, but the api-server's routing/failover code is still
fully testable against a tiny OpenAI-compatible stand-in that answers on the
same `/v1/chat/completions` shape Ollama and vLLM serve:

```bash
pnpm llm:stub &                      # http://127.0.0.1:41777/v1
export ANIMA_LOCAL_LLM_BASE_URL=http://127.0.0.1:41777/v1
pnpm --filter @workspace/api-server run build
DATABASE_URL=... CLERK_SECRET_KEY=... PORT=8080 \
  node artifacts/api-server/dist/index.mjs &

curl -s "http://localhost:8080/api/healthz/llm?probe=1" | jq '{status,preferred,probeOk}'
# {"status":"ok","preferred":"local","probeOk":true} — no cloud keys needed
```

`artifacts/api-server/test/localLlmLive.test.ts` runs the same proof as an
automated test: it boots a real local HTTP server (not a mock of the OpenAI
SDK) and calls `createChatCompletionWithFailover` for real, asserting the
reply came from that server, `provider === "local"`, and that an unreachable
local endpoint fails clearly instead of silently falling through to a
flagship cloud model. Swap the stub's URL for a real Ollama/vLLM host and
nothing else about this code path changes.

## Production note (Vercel)

### Exact fix — "Anima custom LLM is not configured…"

That error is intentional: `ANIMA_LOCAL_LLM_BASE_URL` is empty or the endpoint is unreachable, and there is no cloud fallback to fall through to.

1. **Host an OpenAI-compatible server** (Ollama or vLLM) reachable over **public HTTPS** — it has to be always-on, since Vercel can't reach `localhost` or a laptop that's asleep.
   - **Ready-made:** [`deploy/ollama-fly/`](../deploy/ollama-fly/README.md) — `fly deploy` builds the `anima-chat` model into an image and serves it behind an authenticated reverse proxy, with a public `https://<app>.fly.dev` URL out of the box. Start here unless you already have a host.
   - **One-paste VPS:** [`scripts/llm/cloud-init-vps.sh`](../scripts/llm/cloud-init-vps.sh) (`pnpm llm:vps-init`) — installs Ollama + `anima-chat` + a Cloudflare quick tunnel as systemd services on any fresh Debian/Ubuntu box. See [`docs/llm-deploy.md`](./llm-deploy.md).
   - Or run Ollama/vLLM anywhere else with a public HTTPS URL (a reverse proxy, Cloudflare Tunnel, ngrok, another cloud VM, …) — just make sure it's actually authenticated; Ollama has none built in.
2. **Set these on Vercel (Production)** and redeploy **without build cache**:

```bash
ANIMA_LOCAL_LLM_BACKEND=ollama
ANIMA_LOCAL_LLM_BASE_URL=https://<your-host>/v1
ANIMA_OLLAMA_MODEL_STANDARD=anima-chat       # or the model id your server serves
```

### Quick diagnostic checklist

One-shot check (both endpoints, pass/fail summary):

```bash
pnpm llm:verify-deploy -- https://www.anima-protocol.com
# also check your model host directly:
pnpm llm:verify-deploy -- https://www.anima-protocol.com https://your-tunnel-host
```

Or by hand:

```bash
curl -s https://www.anima-protocol.com/api/healthz/llm | jq '{status,preferred,brand,localEndpoint,note}'
# healthy: status=ok, preferred=local, brand=anima,
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

Once those two vars are set and the endpoint is reachable, the error disappears and the next chat turn uses your model.

Don't have a host to point at yet? [`docs/llm-deploy.md`](./llm-deploy.md) walks through a concrete, cheap path (VPS + Cloudflare Tunnel today, GPU/vLLM upgrade later).

Full troubleshooting: [`docs/vercel-api-migration.md`](./vercel-api-migration.md).
