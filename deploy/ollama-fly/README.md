# Deploy the Anima chat LLM as an always-on public host (Fly.io)

The rest of `scripts/llm/` gets you a working `anima-chat` model on your own
laptop. This directory does the same build, but as a small **always-on**
service with a public HTTPS URL — the piece Vercel production actually needs,
since it can't reach `localhost` or a laptop that's asleep.

What this deploys: Ollama serving the same Qwen2.5 3B `anima-chat` model
(baked into the image at build time — no persistent volume, no cold-start
pull), fronted by [Caddy](https://caddyserver.com/) enforcing a bearer-token
check on every request except the health-check path. **Do not remove that
proxy** — Ollama itself has no authentication, so an unguarded public URL
lets anyone run inference on your bill, or call `/api/pull` / `/api/delete`
to overwrite or wipe the model.

This is the CPU/laptop-tier model (~2GB, good enough for real chats, not a
match for a fine-tuned GPU model). For the GPU-tier Ministral 3 8B path, see
`scripts/llm/docker-compose.vllm.yml` and host it the same way (any Docker
host with a public HTTPS URL works — Fly GPU Machines, RunPod, etc.).

## Prerequisites

- A [Fly.io](https://fly.io) account and the `flyctl` CLI (`brew install
  flyctl`, or see <https://fly.io/docs/flyctl/install/>) — this is a paid
  service; a 2GB CPU machine kept always-on costs a few dollars a month.
- `fly auth login`

## Deploy

```bash
cd deploy/ollama-fly

# First run only: creates the app + fly.toml app name, picks a region.
# Say "no" to any Postgres/Redis/volume prompts — none are needed.
fly launch --no-deploy

# Generate a secret and store it as a Fly secret (never put it in fly.toml).
fly secrets set PROXY_AUTH_TOKEN=$(openssl rand -hex 32)

# Builds the image (bakes the model in) and deploys it.
fly deploy
```

The build step runs `ollama pull qwen2.5:3b` + `ollama create anima-chat`
inside the image, so it takes a few minutes the first time — that's expected.

## Verify it's actually working

```bash
# Unauthenticated → 401 (proves the endpoint isn't wide open)
curl -sS -o /dev/null -w '%{http_code}\n' https://<app-name>.fly.dev/v1/models

# Authenticated → the model list
curl -sS https://<app-name>.fly.dev/v1/models \
  -H "Authorization: Bearer $PROXY_AUTH_TOKEN"

# A real chat completion
curl -sS https://<app-name>.fly.dev/v1/chat/completions \
  -H "Authorization: Bearer $PROXY_AUTH_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"model":"anima-chat","messages":[{"role":"user","content":"Who are you?"}]}'
```

If `curl https://<app-name>.fly.dev/healthz` doesn't return `ok`, check `fly
logs` and `fly status` before touching Vercel — no point debugging the
client side of a backend that isn't up yet.

## Wire it into Vercel production

Set these on the Vercel project (Production environment), matching
`PROXY_AUTH_TOKEN` from above, then redeploy without build cache:

```bash
ANIMA_LOCAL_LLM_BACKEND=ollama
ANIMA_LOCAL_LLM_BASE_URL=https://<app-name>.fly.dev/v1
ANIMA_LOCAL_LLM_API_KEY=<same value as PROXY_AUTH_TOKEN>
ANIMA_OLLAMA_MODEL_STANDARD=anima-chat
ANIMA_OLLAMA_MODEL_LIGHT=anima-chat
ANIMA_OLLAMA_MODEL_HEAVY=anima-chat
```

`ANIMA_LOCAL_LLM_API_KEY` is what the api-server's OpenAI-compatible client
sends as `Authorization: Bearer …` on every request — it must exactly match
`PROXY_AUTH_TOKEN`, or Caddy will reject it with 401 and chat will report the
"custom LLM is selected, but the endpoint is unreachable" error described in
`../../docs/custom-llm.md`.

Confirm from the app side:

```bash
curl -s 'https://<your-vercel-domain>/api/healthz/llm?probe=1' | jq '{preferred,probeOk,localEndpoint}'
# expect: preferred=local, probeOk=true, localEndpoint.configured=true
```

## Updating the model later

Edit `Modelfile.anima-chat` (keep it in sync with
`../../scripts/llm/Modelfile.anima-chat`, the source of truth for the system
prompt), then `fly deploy` again — the image rebuild re-runs the bake step.

## Cost / idle note

`auto_stop_machines = false` in `fly.toml` keeps one machine running
continuously so chat never eats a cold-start delay — that's also what costs
money 24/7. If idle-cost matters more than latency, flip it to `true` (Fly
will stop the machine when idle and restart it on the next request, adding
roughly 10-30s to that first turn).
