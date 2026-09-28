# Custom Anima LLM — replace ChatGPT / Gemini / Groq

**What "build an LLM" means here:** OpenAI, Google, and Groq do **not** publish ChatGPT / Gemini / Groq model weights or training code. You cannot copy those products. What *is* public — and what Anima uses — is:

| Public piece | Role |
|--------------|------|
| Open weights (Qwen2.5, Ministral, Llama, Gemma, …) | The neural net that generates chat tokens |
| Ollama / llama.cpp / vLLM | Inference engines that run those weights locally |
| Anima Modelfiles + system prompts | Brand the model as your companion LLM |
| Fine-tune scripts (Unsloth / LLaMA-Factory) | Specialize it on Anima chats + memory |
| DPO/ORPO preference pairs (Unsloth) | Sharpen character fidelity after SFT — corrects specific bad habits |
| `ANIMA_LLM_PROVIDER=custom` | Api-server talks **only** to your model — no cloud chat BYOK |

The React app still calls `POST /api/chat/messages`. The preferred backend is the self-hosted Anima LLM (`anima-chat`) whenever `ANIMA_LOCAL_LLM_BASE_URL` is a usable public HTTPS `/v1` URL — including on the production Worker, even if the Workers AI DeepSeek binding is present. That path is fail-closed (`customOnly`): OpenRouter is **not** appended after a usable custom host, even when `ANIMA_OPENROUTER_FALLBACK` and an OpenRouter key are set. `ANIMA_OPENROUTER_FALLBACK` only hops after Workers AI when no custom host is configured. MiniMax / OpenAI / DeepSeek APIs are not the custom LLM. Set `ANIMA_LLM_PROVIDER=custom` (production default).

---

## Path A — Bootstrap today (CPU / laptop)

Creates `anima-chat` from public **Qwen2.5 0.5B** weights (~400 MB). Good enough to engage in real chats with no cloud API keys at all.

```bash
# Install Ollama from https://ollama.com if needed, then:
pnpm llm:up
# → pulls qwen2.5:0.5b, creates anima-chat, smoke-tests chat

pnpm llm:chat -- "Who are you?"
```

Point the api-server at it (also the defaults in `.env.example`). The API
reads these on the server and calls Ollama's native `POST /api/chat` — do
not put the host or model name in frontend `VITE_*` variables.

```bash
export ANIMA_LOCAL_LLM_BACKEND=ollama
export ANIMA_LOCAL_LLM_BASE_URL=http://localhost:11434/v1
export ANIMA_OLLAMA_MODEL_STANDARD=anima-chat
```

Verify:

```bash
curl -s http://localhost:8080/api/healthz/llm | jq
# expect: "status":"ok", "preferred":"local", "brand":"anima"

curl -s http://localhost:8080/api/ai/chat \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"Who are you?"}'
# {"response":"…","provider":"local","model":"anima-chat","failed_over":false}
```

From the React app, `animaApi.aiChat({ prompt })` hits that same probe. Signed-in companion chat uses `/api/chat/messages` and still talks to this local endpoint.

---

## Scribe voice — finished, literate replies

If the model answers in fragments or trails off, the fix is two-layered:
a model large enough to carry a paragraph, and sampling tuned for finished
prose. `anima-scribe` is that layer on open weights:

```bash
ollama pull qwen2.5:7b
ollama create anima-scribe -f scripts/llm/Modelfile.anima-scribe
export ANIMA_OLLAMA_MODEL_STANDARD=anima-scribe
```

The Modelfile sets the system voice (doctoral fluency, every thought
finished, prose not bullets) and the sampler (`temperature 0.7`, `min_p
0.05`, `repeat_penalty 1.12`, `num_predict 768`). Qwen2.5 7B Q4_K_M fits a
free Colab T4 or any 8 GB GPU; on a CPU-only host change `FROM` to
`qwen2.5:3b` and expect plainer prose.

To bake the register into the weights, the repo ships a committed synthetic
scribe set — [`scripts/llm/data/scribe/`](../scripts/llm/data/scribe/README.md):
a few hundred finished, literate exchanges in Serenity's and Fallen Angel's
voices plus DPO pairs whose rejected replies are the concrete failures
(mid-clause truncation, fragment stacks, drift, list-dumps, generic-assistant
lapses, restart loops). It merges through the normal pipeline at weight 1, so
your own logs stay the majority:

```bash
pnpm llm:dataset            # seeds + raw logs + scribe set → finetune-sharegpt.jsonl, dpo-pairs.jsonl
pnpm llm:dataset -- --no-scribe   # train without the synthetic set
```

### Fine-tune the scribe on a free Colab T4

Open [`scripts/llm/finetune/colab_scribe_qlora.ipynb`](../scripts/llm/finetune/colab_scribe_qlora.ipynb)
in Colab (T4 runtime), upload the three JSONL files from `scripts/llm/output/`,
and run top to bottom: QLoRA SFT on `unsloth/Qwen2.5-7B-Instruct-bnb-4bit`
(~60–90 min), DPO (~15 min), a sanity chat, then GGUF export via
`pnpm llm:export-gguf` / `scripts/llm/finetune/export_gguf.py`. The Unsloth
scripts pick fp16 on T4 and bf16 on Ampere+ automatically. On the Ollama host:

```bash
ollama create anima-scribe -f scripts/llm/Modelfile.anima-scribe-tuned   # FROM ./gguf/anima-scribe-q4_k_m.gguf
export ANIMA_OLLAMA_MODEL_STANDARD=anima-scribe
pnpm llm:eval
```

`pnpm llm:eval` gained two checks for this: `mustEndSentence` (reply ends on
terminal punctuation) and `minWords`. Both `complete-thought-*` cases must
pass before pointing production at a new tag.

The from-scratch tiny GPT in `training/` cannot reach this register at its
size; see `training/README.md` for what it can do and what was fixed there.

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
# Real logs: Settings → Export, then:
pnpm llm:curate-novels
pnpm llm:ingest -- --from ~/Downloads/anima-backup.json
pnpm llm:dataset

# Fixtures only (no personal logs / no shared-box novels):
pnpm llm:dataset -- --rehearse

# Seed + Postgres transcripts:
pnpm llm:prepare-finetune -- --with-db --user <clerk_user_id> --val-split 0.05
```

Details and the CUDA checklist: [`docs/llm-build.md`](./llm-build.md).

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

### 4. Optional: sharpen with DPO preference pairs

SFT teaches the model to imitate good replies; DPO teaches it to actively
prefer them over specific bad habits it still shows — breaking character,
dumping raw memory facts instead of weaving them in, negotiating past a
boundary the user just set, or over-apologizing during repair. Run this
**after** step 2, on top of the SFT adapter:

```bash
pnpm llm:prepare-dpo
# → scripts/llm/output/dpo-pairs.jsonl (chosen/rejected pairs, see
#   lib/llm/src/dataset/preferences.ts for the curated set + rationale)

python scripts/llm/finetune/unsloth_dpo.py \
  --data scripts/llm/output/dpo-pairs.jsonl \
  --base scripts/llm/checkpoints/anima-ministral8b-qlora \
  --out scripts/llm/checkpoints/anima-ministral8b-dpo
```

Then merge / convert to GGUF or serve the DPO adapter the same way as the
SFT one in step 3. Add your own pairs to `preferences.ts` as you catch the
model doing something specific and wrong — each pair should target one
concrete failure mode, not a vague "be better." Full walkthrough:
[`docs/llm-build.md`](./llm-build.md#preference-optimization).

---

## Your own trained model (`training/` → `server/server.py`)

The from-scratch Anima model (`training/`, Phases 1–3) can answer companion
chat directly. `server/server.py` speaks the OpenAI chat-completions protocol
the api-server uses for non-Ollama hosts, streaming included. No cloud key is
involved at any point.

On the model host, after Phase 3 has written `out/anima-dpo/ckpt.pt`:

```bash
pip install -r server/requirements.txt
ANIMA_SERVER_TOKEN=<long random string> python server/server.py   # 127.0.0.1:8000
```

`ANIMA_CKPT` and `ANIMA_TOK_DIR` override the checkpoint and tokenizer paths
when the host keeps them somewhere other than `out/` and `data/anima_tokens/`.

Point the api-server at it:

```bash
export ANIMA_LLM_PROVIDER=custom
export ANIMA_LOCAL_LLM_BACKEND=vllm        # the generic OpenAI-compatible /v1 backend
export ANIMA_LOCAL_LLM_BASE_URL=http://127.0.0.1:8000/v1
export ANIMA_LOCAL_LLM_API_KEY=<same value as ANIMA_SERVER_TOKEN>
export ANIMA_VLLM_MODEL_LIGHT=anima ANIMA_VLLM_MODEL_STANDARD=anima ANIMA_VLLM_MODEL_HEAVY=anima
```

`curl -s 'localhost:8080/api/healthz/llm?probe=1'` should report
`"preferred":"local"`, `"brand":"anima"`, `"chain":["local"]`, and a passing
probe on model `anima`.

How the server handles a companion request:

- It streams `chat.completion.chunk` events a sentence at a time. A
  length-capped reply is still cut back to its last finished sentence, so
  the streamed text matches the non-streaming reply.
- It keeps the newest turns that fit the 1024-token window. The long
  companion system prompt is usually the first thing dropped. A final message
  that overflows on its own keeps its tail.
- It reads text only. Image parts are ignored, tool-call turns with no text
  are skipped, and `tools` are accepted but never called.
- It clamps `max_tokens` to 768 instead of rejecting larger values. The
  api-server already sends 200 or fewer.

**Production (Worker).** The Worker cannot reach localhost. Expose the server
over public HTTPS with the same tunnel used for Ollama in
[`docs/llm-deploy.md`](./llm-deploy.md), aimed at the model server
(`ANIMA_TUNNEL_PORT=8000 pnpm llm:tunnel`). Then:

1. Set Secrets Store `ANIMA_LOCAL_LLM_BASE_URL` to that `https://…/v1` and
   `ANIMA_LOCAL_LLM_API_KEY` to the server token.
2. In `wrangler.jsonc` `vars`, change `ANIMA_LOCAL_LLM_BACKEND` from `ollama`
   to `vllm`, add `ANIMA_VLLM_MODEL_STANDARD` (plus `_LIGHT` / `_HEAVY`) set to
   `anima`, and redeploy.

Do step 2 only once the new host answers. Until then production stays on
`anima-chat`.

Tests: `python3 server/test_server.py` builds a tiny random-weight model, so it
needs no trained checkpoint (requires `torch`, `tokenizers`, `fastapi`,
`httpx`).

At about 34M parameters this model is a research and preview voice (see
[`training/README.md`](../training/README.md)). `anima-chat` and
`anima-scribe` on open weights remain the fluent option.

---

## Other supported open-weight families

Anima now keeps a source-of-truth catalog for Llama, Qwen, Mistral, Gemma,
and DeepSeek. Print the exact current ids with:

```bash
pnpm llm:list-open-models
```

| Family | Ollama example | vLLM / Hugging Face example | OpenRouter free example |
|--------|----------------|-----------------------------|-------------------------|
| Llama | `llama3.1:8b` | `meta-llama/Llama-3.1-8B-Instruct` | `meta-llama/llama-3.3-70b-instruct:free` |
| Qwen | `qwen2.5:0.5b` | `Qwen/Qwen2.5-7B-Instruct` | `qwen/qwen-2.5-7b-instruct:free` |
| Mistral | `mistral:7b` | `mistralai/Ministral-3-8B-Instruct-2512` | `mistralai/mistral-small-3.2-24b-instruct:free` |
| Gemma | `gemma3:4b` | `google/gemma-3-4b-it` | `google/gemma-3-12b-it:free` |
| DeepSeek | `deepseek-r1:7b` | `deepseek-ai/DeepSeek-R1-Distill-Qwen-7B` | `deepseek/deepseek-r1:free` |

For self-hosted chat, set the corresponding `ANIMA_OLLAMA_MODEL_*` or
`ANIMA_VLLM_MODEL_*` env vars to a model your server actually serves. For
OpenRouter, set `ANIMA_OPENROUTER_MODEL_FAMILY=llama|qwen|mistral|gemma|deepseek`.
Exact `ANIMA_OPENROUTER_MODEL_STANDARD` / tier overrides still take precedence.

---

## Pin chat to the custom backend

Chat supports the self-hosted Anima LLM through `ANIMA_LOCAL_LLM_BASE_URL` (OpenAI-compatible — vLLM, Ollama, or llama.cpp). Set `ANIMA_LLM_PROVIDER=custom` (aliases `local`, `anima`, and `local-only` are also accepted) to pin every chat turn to that endpoint and prevent OpenRouter fallback. Gemini, Groq, Kimi, Grok, ChatGPT, and Vercel AI Gateway are never called for chat.

`OPENAI_API_KEY` still exists as an env var, but only for image generation/edit (`/api/openai/functions` image routes) — it is never read for chat.

If the local endpoint is unavailable, the turn fails with a clear setup / connection / `ai_timeout` error instead of silently switching to a different model. `ANIMA_OPENROUTER_FALLBACK=true` plus an OpenRouter key is **opt-in for the no-host Workers AI path only** — it does not hop after a preferred custom/local LLM (`customOnly`). Leave the flag `false` (or omit it) for custom-only operation. To re-enable a cloud hop after Workers AI when no custom host is set:

```bash
ANIMA_OPENROUTER_FALLBACK=true
OPENROUTER_API_KEY=sk-or-…
```

Do not set `ANIMA_OPENROUTER_FALLBACK=true` to paper over a down self-hosted host — fail the turn and wake that host. Restoring a local→OpenRouter hop is not supported while customOnly is on.

Local chat calls omit Ollama `keep_alive` unless `ANIMA_OLLAMA_KEEP_ALIVE` is set, so the droplet daemon wins. Production should keep `OLLAMA_KEEP_ALIVE=-1` (model stays loaded). A body value of `30m` overrides that and unloads anima-chat. Ollama's `/v1/chat/completions` handler ignores the field; the public-v1 proxy rewrites that route onto native `/api/chat` and only copies `keep_alive` when the request or env sets it. The header-withheld local budget stays 90s (`LLM_LOCAL_FIRST_TOKEN_MS`). That clock starts when the turn takes the single local slot, not while it is queued. Companion `/api/chat/messages` may keep the browser fetch open for `CHAT_FETCH_ABORT_MS` (180s queue + 90s first token + 30s decode slack + 10s context). Repeat-retry leftover time still uses the 140s `CHAT_STREAM_TIMEOUT_MS` window. Once tokens are flowing, a client disconnect does not abort the upstream generate until that generation cap: the reply and that turn's mood change are saved together, and the client picks them up by polling (`LATE_REPLY_POLL_MS`, 300s) or by opening the chat again. A generate that has not emitted a token yet still stops after the disconnect grace or the 60s late-persist budget. `/api/ai/chat` stays at 18s so a hung generate still returns JSON before the Worker ~20s wall. Do not raise that probe. Native `num_predict` is capped at 200.

### Single slot on the local host

The droplet serves one Ollama request at a time. Each Cloudflare isolate used to keep its own in-memory counter, so a second chat turn, a proactive check-in, or a journal call walked straight into Ollama and sat behind the first prompt. That wait was charged against the second turn's 90s first-token budget.

Chat turns on a local-only chain now take one shared lease, FIFO. While a turn waits it sends an SSE `status: "waiting"` event with `queue_position`, and the chat bubble shows a short line (`Still here — one reply ahead.`) instead of failing the spinner. The 90s first-token abort starts only after the lease is granted. Waiting itself is capped at 180s (`LLM_LOCAL_SLOT_WAIT_MS`); past that the turn returns "The companion is still finishing another reply. Please try again in a moment."

Background callers (proactive check-ins, journal, milestone evolution, post-turn sidecars, and the app-open warm) try the lease once. They skip when it is held or any chat turn is already in line, so they do not evict Ollama's cached prompt. Hosted and non-local providers never take the lease.

The lease expires on its own (`LLM_LOCAL_SLOT_TTL_MS`, 150s, a little above the 120s generation cap) if the holder dies. A live holder heartbeats every 15s, which extends the lease. Set `ANIMA_LOCAL_LLM_SLOT=false` (or `0` / `off`) to disable the queue. The default is on whenever the provider chain is local-only. Forcing the flag on does not queue OpenRouter, Workers AI, MiniMax, or any other hosted chain.

Production coordinates the lease with a Durable Object binding `LOCAL_LLM_SLOT` (`class_name` `LocalLlmSlot`, migration `v1-local-llm-slot` in `wrangler.jsonc`). One object, `getByName("ollama")`, is the slot. The class uses the SQLite backend (`new_sqlite_classes`), which the Workers Free plan supports. Keep it in `new_sqlite_classes`; do not move it to `new_classes`. There is no new secret. Do not rename the class without a new migration. Node and vitest use an in-process book when the binding is absent; that book is not shared across isolates.

Optional second self-hosted host: `ANIMA_LOCAL_LLM_BACKUP_BASE_URL` (for example `https://llm-backup.anima-protocol.com/v1`) serving the same `anima-chat` model. When it is set, a primary timeout, connection error, or busy host (429/503) tries that URL and stays on provider `local`. Auth failures and the Worker subrequest limit do not hop. When the variable is unset, chat stays on the single host and still does not fall through to OpenRouter or OpenAI. Do not commit the URL as a secret, and do not add a Wrangler binding until the Secrets Store entry exists.

Signed-in app open fires one background `POST /api/llm/warm` per browser session. That route is its own request: it sends a native `/api/generate` with an empty prompt and `num_predict: 1`, times out at 22s, and does not call OpenRouter or OpenAI. It skips while a companion turn is open. The chat-turn warm (`hintLocalLlmWarm`) stays skipped on Workers (#480). A successful preload suppresses another one for 5 minutes on that isolate.

More detail on the fine-tune pipeline and self-hosted stack: [`docs/llm-build.md`](./llm-build.md).

### Optional: parallel local minds

There's one opt-in multi-draft path, and it's still entirely local: set `ANIMA_LOCAL_LLM_ENSEMBLE=true` and the same self-hosted model drafts a few replies in parallel at different sampling temperatures (`ANIMA_ENSEMBLE_MINDS`, default `Steady,Vivid,Playful`), then one more local call combines them into a single in-character reply. No cloud provider is ever involved — it's the same one model, sampled several times. Off by default: it costs roughly `N` drafts + 1 synthesis call in latency and GPU load per turn. Tune with `ANIMA_ENSEMBLE_MAX_MINDS` (default 4) and `ANIMA_ENSEMBLE_MIND_TIMEOUT_MS` (default 20000 — a mind that's still generating past this is dropped, not awaited).

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

### Exact fix — "The model \`anima-chat\` does not exist…" / cloud host misconfig

If `/api/healthz/llm` shows `localEndpoint.host=api.openai.com` (or Groq/Gemini/etc.) with `model=anima-chat`, Vercel is pointed at a **cloud chat API**, not a self-hosted Anima LLM. OpenAI has no model named `anima-chat`, so every chat turn 404s. Chat never uses ChatGPT/Gemini/Groq — set `ANIMA_LOCAL_LLM_BASE_URL` to your **Ollama/vLLM** HTTPS URL instead (steps below). Healthy response: `status=ok`, `localEndpoint.isCloudFlagship=false`, `host` is your tunnel/Fly/Render hostname.

### Exact fix — 401 / "Anima LLM authentication failed…"

`/api/healthz/llm?probe=1` shows `probeOk=false`, `errorKind: "auth"`,
`status: 401`. The host is up, but the bearer Vercel sends does **not** match
Fly `PROXY_AUTH_TOKEN`.

1. Reset the Fly secret and keep the value:
   ```bash
   cd deploy/ollama-fly
   NEW_TOKEN=$(openssl rand -hex 32)
   fly secrets set PROXY_AUTH_TOKEN=$NEW_TOKEN -a anima-chat-llm
   printf '%s\n' "$NEW_TOKEN"
   ```
2. Set **the same value** on Vercel Production as `ANIMA_LOCAL_LLM_API_KEY`
   (with `ANIMA_LOCAL_LLM_BASE_URL=https://anima-chat-llm.fly.dev/v1`).
3. Redeploy Vercel **without build cache**.
4. Confirm:
   ```bash
   curl -sS https://anima-chat-llm.fly.dev/v1/models \
     -H "Authorization: Bearer $NEW_TOKEN" | jq '.data[].id'
   curl -s 'https://www.anima-protocol.com/api/healthz/llm?probe=1' \
     | jq '{probeOk, probes}'
   # expect probeOk=true
   ```

Unauthenticated calls to the Fly host should return **401** (proves the proxy
is locked). A matching bearer must list `anima-chat` under `/v1/models`.

### Exact fix — empty-body 403 with a *correct* bearer

Wrong bearer → **401**. Correct bearer → request reaches Ollama, which then
returns empty-body **403** if the reverse proxy forwards the public
`Host: *.fly.dev` header. Ollama only accepts loopback Host.

Fix is in [`deploy/ollama-fly/Caddyfile`](../deploy/ollama-fly/Caddyfile)
(`header_up Host 127.0.0.1:11434`). Redeploy the Fly app:

```bash
cd deploy/ollama-fly
fly deploy -a anima-chat-llm
curl -sS https://anima-chat-llm.fly.dev/v1/models \
  -H "Authorization: Bearer $NEW_TOKEN" | jq '.data[].id'
```

### Exact fix — "Anima custom LLM is not configured…" / "No chat LLM configured"

That error means neither a self-hosted endpoint nor OpenRouter is usable.

**Fastest unblock (no GPU):** OpenRouter + Venice Uncensored (Cognitive Computations × Venice.ai Dolphin Mistral 24B — reputable open-weight uncensored). Free API key at https://openrouter.ai/keys:

```bash
OPENROUTER_API_KEY=sk-or-…
# default model is Venice Uncensored; a $0 OpenRouter account automatically
# retries openai/gpt-oss-20b:free on HTTP 402. To skip Venice from the first turn:
# ANIMA_OPENROUTER_FREE=true
```

Redeploy without build cache. Verify:

```bash
curl -s https://www.anima-protocol.com/api/healthz/llm | jq '{preferred,chain,openrouter,note}'
# expect preferred/chain to include "openrouter"
# openrouter.configured=true, openrouter.keyTail=last 4 of your key
```

### Exact fix — "OpenRouter credits/rate limit exhausted" / HTTP 429 / HTTP 402

That popup usually means chat **never reached your custom LLM**. Confirm:

```bash
curl -s https://www.anima-protocol.com/api/healthz/llm | jq '{preferred,chain,localEndpoint,openrouter,customOnly,note}'
```

If `localEndpoint.configured` is `false` and `preferred` is `openrouter`, Vercel does not have `ANIMA_LOCAL_LLM_BASE_URL`. Chat is burning OpenRouter's free-models-per-day quota instead of talking to your self-hosted model. **Fix the custom LLM first** — adding OpenRouter credits will not wire the custom brain:

```bash
ANIMA_LLM_PROVIDER=custom
ANIMA_LOCAL_LLM_BACKEND=ollama
ANIMA_LOCAL_LLM_BASE_URL=https://<your-host>/v1
ANIMA_OLLAMA_MODEL_STANDARD=anima-chat
```

Redeploy without build cache. Healthy routing: `preferred: "local"`, `chain: ["local"]`.

If OpenRouter was the intended backend (no custom host yet): Venice Uncensored is a paid model; a brand-new account with no credits gets HTTP 402. Chat retries `openai/gpt-oss-20b:free` automatically. A 429 mentioning `free-models-per-day` means that free daily cap is exhausted — add $10 at https://openrouter.ai/settings/credits or wait until midnight UTC. Confirm which key is loaded:

```bash
curl -s https://www.anima-protocol.com/api/healthz/llm | jq '.openrouter'
# configured=true, env=OPENROUTER_API_KEY, keyTail=last 4 chars
```

**Self-hosted (preferred long-term):**

1. **Host an OpenAI-compatible server** (Ollama or vLLM) reachable over **public HTTPS** — it has to be always-on, since Vercel can't reach `localhost` or a laptop that's asleep.
   - **Ready-made:** [`deploy/ollama-fly/`](../deploy/ollama-fly/README.md) — `fly deploy` builds the `anima-chat` model into an image and serves it behind an authenticated reverse proxy, with a public `https://<app>.fly.dev` URL out of the box. Start here unless you already have a host.
   - **Named Cloudflare Tunnel (CPU Ollama, not vLLM):** [`scripts/llm/public-v1/`](../scripts/llm/public-v1/README.md) — bearer proxy + `cloudflared` so a box already running `anima-chat` is reachable as `https://llm.anima-protocol.com/v1`. Worker secrets: `ANIMA_LOCAL_LLM_BASE_URL` + `ANIMA_LOCAL_LLM_API_KEY`. Do not commit token files. A catch-all Worker route `*.anima-protocol.com/*` will swallow this hostname — narrow it (e.g. `www.anima-protocol.com/*`).
   - **One-paste VPS:** [`scripts/llm/cloud-init-vps.sh`](../scripts/llm/cloud-init-vps.sh) (`pnpm llm:vps-init`) — installs Ollama + `anima-chat` + a Cloudflare quick tunnel as systemd services on any fresh Debian/Ubuntu box. See [`docs/llm-deploy.md`](./llm-deploy.md).
   - **Local uncensored:** `ollama pull dolphin-mistral && ollama create anima-uncensored -f scripts/llm/Modelfile.anima-uncensored` then set `ANIMA_OLLAMA_MODEL_STANDARD=anima-uncensored`.
   - Or run Ollama/vLLM anywhere else with a public HTTPS URL (a reverse proxy, Cloudflare Tunnel, ngrok, another cloud VM, …) — just make sure it's actually authenticated; Ollama has none built in.
2. **Set these on Vercel (Production)** and redeploy **without build cache**:

```bash
ANIMA_LLM_PROVIDER=custom
ANIMA_LOCAL_LLM_BACKEND=ollama
ANIMA_LOCAL_LLM_BASE_URL=https://<your-host>/v1
ANIMA_OLLAMA_MODEL_STANDARD=anima-chat       # or anima-uncensored / your vLLM id
```

### "The model `anima-chat` does not exist or you do not have access to it"

This one means the opposite of the error above: `ANIMA_LOCAL_LLM_BASE_URL` **is** set and the host **is** reachable — it just doesn't serve a model by that name. Usual causes:

- `ollama create anima-chat -f scripts/llm/Modelfile.anima-chat` was never run on the host, so it only has the base weights (`qwen2.5:0.5b`).
- The tag exists as `anima-chat:latest` behind a gateway that doesn't do Ollama's implicit `:latest` resolution.
- The URL points at a vLLM host or another OpenAI-compatible gateway serving its own model ids.

**Chat no longer hard-fails on this.** When the configured tag is rejected, the API asks the endpoint what it actually serves (`GET /v1/models`) and runs the turn on the best available chat model — preferring an exact/`:latest` match, then anything `anima*`, then a known open-weight family (Qwen, Ministral, Llama, …). Embedding, image, and audio models are never picked. The substitution is remembered for 10 minutes so later turns don't re-pay the failed round trip, and it re-checks your configured tag after that, so creating the real tag takes effect without a redeploy.

You'll see this in the API logs when it kicks in:

```
[llm] "anima-chat" is not served by this endpoint — using "qwen2.5:0.5b" instead (found via /v1/models).
```

That keeps the app talking, but it's still a misconfiguration — see exactly what the host has and pin it:

```bash
curl -s 'https://www.anima-protocol.com/api/healthz/llm?probe=1' \
  | jq '.probes[0] | {ok, configuredModel, model, availableModels}'
# configuredModel = what you asked for, model = what actually answered
```

Then either create the expected tag on the host, or point the env at what's already there and redeploy:

```bash
ANIMA_OLLAMA_MODEL_LIGHT=qwen2.5:0.5b
ANIMA_OLLAMA_MODEL_STANDARD=qwen2.5:0.5b
ANIMA_OLLAMA_MODEL_HEAVY=qwen2.5:0.5b
```

If the endpoint serves *nothing* usable for chat, the turn fails with a message naming your host, the ids it does serve, and the command that fixes it — not a bare 404.

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
