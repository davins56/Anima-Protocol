# Fly.io Ollama host (`anima-chat-llm`)

Public HTTPS OpenAI-compatible API for the branded `anima-chat` model
(`qwen2.5:3b`, ~2 GB, CPU-friendly). The Cloudflare Worker at
`anima-protocol.com` cannot reach `localhost` (isolate fetch is rejected with
Cloudflare error 1003). This app is the intended `ANIMA_LOCAL_LLM_BASE_URL`.

Chat still uses only a self-hosted Anima LLM or OpenRouter. This host is not
Gemini, Groq, or OpenAI flagship.

## What you get

- Ollama on loopback `:11434`
- Caddy on `:8080` requiring `Authorization: Bearer <PROXY_AUTH_TOKEN>` on every `/v1/*` request (401 otherwise)
- `/healthz` — static `ok` (no Ollama / model call) so Fly checks pass during the first-boot pull
- Volume at `/root/.ollama` so weights survive restarts
- One machine kept running (`auto_stop_machines = "off"`, `min_machines_running = 1`)

The api-server sends the same header the OpenAI SDK uses:
`Authorization: Bearer <ANIMA_LOCAL_LLM_API_KEY>`. That value must equal
`PROXY_AUTH_TOKEN`. Never bake a token into the image or commit one.

## Scale-to-zero tradeoff

This `fly.toml` does **not** stop machines when idle. Interactive chat needs a
warm Ollama process; a cold start (machine boot + load `anima-chat` on CPU)
often exceeds the Worker's first-turn budget, so chat looks like it "never
starts."

If you switch to `auto_stop_machines = "stop"` or `"suspend"` to save money,
keep `min_machines_running = 0` only if you accept that the first message after
idle may time out. Do not change that without measuring a real chat turn.

## Prerequisites

- [flyctl](https://fly.io/docs/flyctl/install/) logged in (`fly auth login`)
- Commands run from the **repository root** (the Dockerfile copies
  `scripts/llm/Modelfile.anima-chat`)

## Operator steps

```bash
# 1. Create the app without deploying (skip if anima-chat-llm already exists)
fly launch --no-deploy --config deploy/ollama-fly/fly.toml
# or: fly apps create anima-chat-llm

# 2. Persistent volume for Ollama weights (~2 GB model + headroom)
fly volumes create ollama_data --size 20 --app anima-chat-llm --yes

# 3. Bearer token — generate locally, do not commit
PROXY_AUTH_TOKEN="$(openssl rand -hex 32)"
fly secrets set PROXY_AUTH_TOKEN="${PROXY_AUTH_TOKEN}" -a anima-chat-llm
# keep the value for the Worker secret ANIMA_LOCAL_LLM_API_KEY

# 4. Deploy (repo root = Docker context)
fly deploy --config deploy/ollama-fly/fly.toml --dockerfile deploy/ollama-fly/Dockerfile
```

First boot pulls `qwen2.5:3b` and runs `ollama create anima-chat`. `/healthz`
stays up so Fly does not kill the machine during the pull. Watch progress:

```bash
fly logs -a anima-chat-llm
```

## Smoke test

```bash
# Replace TOKEN with the PROXY_AUTH_TOKEN you set. Do not log it to tickets.
curl -sS https://anima-chat-llm.fly.dev/v1/chat/completions \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model":"anima-chat","messages":[{"role":"user","content":"Reply with the single word: ok"}],"max_tokens":16}'
```

Expect HTTP 200 and a completion. Without the header, or with the wrong token:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' \
  https://anima-chat-llm.fly.dev/v1/chat/completions
# 401
```

## App-side env (Cloudflare Worker, not Vercel)

**Do not add LLM bindings to `wrangler.jsonc` until the Secrets Store
entries exist.** Cloudflare Workers Builds auto-deploys `main`. A
`secrets_store_secrets` object whose `secret_name` is missing from store
`a31e40473ef34db896b5bc1e6c1c4b86` makes `wrangler deploy` fail and takes
down the Worker (the whole site). Ordered runbook:

1. Create the `secret_name` in that store (values only in the dashboard).
2. Add the matching `{ binding, store_id, secret_name }` in `wrangler.jsonc`
   in the **same** commit.
3. Then deploy.

Today `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `DATABASE_URL`,
`OPENROUTER_API_KEY`, `ANIMA_LOCAL_LLM_BASE_URL`, and
`ANIMA_LOCAL_LLM_API_KEY` are declared in `wrangler.jsonc`
`secrets_store_secrets`. `ANIMA_LOCAL_LLM_BACKEND` is a committed `vars`
value (`ollama`) — do not bind the same name in Secrets Store or
`wrangler deploy` fails with "Bindings must have unique names".
**Create the LLM `secret_name`s in the store before merging this
binding list** or `wrangler deploy` fails and takes the site down.
Dashboard-only secrets are still dropped on the next git deploy unless
they are declared.

Chat is fail-closed (`ANIMA_LLM_PROVIDER=custom`). Missing local URL
does **not** fall through to OpenRouter. `OPENROUTER_API_KEY` may stay
bound for image / leftover paths.

| Name | Where | Value |
|------|--------|--------|
| `ANIMA_RUNTIME` | `wrangler.jsonc` `vars` (already committed) | `worker` (never invent localhost) |
| `ANIMA_LLM_PROVIDER` | `wrangler.jsonc` `vars` (already committed) | `custom` (local-only chat) |
| `ANIMA_LOCAL_LLM_BACKEND` | `wrangler.jsonc` `vars` only (not Secrets Store) | `ollama` |
| `ANIMA_OLLAMA_MODEL_STANDARD` | `wrangler.jsonc` `vars` (already committed) | `anima-chat` |
| `ANIMA_OPENROUTER_FREE` | `wrangler.jsonc` `vars` (already committed) | unused for chat; leftover |
| `MINIMAX_API_KEY` | Classic Worker secret (`wrangler secret put MINIMAX_API_KEY` / dashboard). **Not** Secrets Store — a missing store entry fails deploy | unused for chat |
| `ANIMA_LOCAL_LLM_BASE_URL` | Secrets Store + `wrangler.jsonc` binding (name only — never `vars`) | `https://llm.anima-protocol.com/v1` (or your public HTTPS `…/v1`) |
| `ANIMA_LOCAL_LLM_API_KEY` | Secrets Store + `wrangler.jsonc` binding (name only) | same as host `PROXY_AUTH_TOKEN` |
| `OPENROUTER_API_KEY` | Secrets Store + `wrangler.jsonc` binding (name only) | unused for chat; optional follow-up removal |

An explicit `http://localhost:11434/v1` on the Worker is treated as
misconfigured (not attempted).

Verify after the Worker redeploy:

```bash
curl -sS https://anima-protocol.com/api/healthz/llm
```

Expect `preferred: "local"`, `customOnly: true`, `chain: ["local"]`,
`localEndpoint.host` a public host (not localhost), `isHttps` true,
`hasV1Path` true. If the local URL is missing, `status: "error"` and an
empty chain — never `openrouter` / `minimax`.

## Performance

Ollama on Fly **CPU** with a 3B model is slow for long replies. That is
expected. Upgrade path: a Fly GPU machine, or a larger CPU/`performance-*`
VM, still serving `anima-chat` (or a fine-tuned tag) behind the same proxy.
Do not point `ANIMA_LOCAL_LLM_BASE_URL` at OpenAI, Groq, or Gemini.

## Files

| File | Role |
|------|------|
| `Dockerfile` | `ollama/ollama` + Caddy + Modelfile + entrypoint |
| `entrypoint.sh` | serve → proxy → background `anima-chat` bootstrap |
| `Caddyfile` | Bearer on `/v1/*`, static `/healthz` |
| `fly.toml` | app `anima-chat-llm`, volume, warm machine, HTTP check |
