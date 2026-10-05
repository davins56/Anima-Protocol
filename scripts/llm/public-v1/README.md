# Public HTTPS `/v1` (Ollama + Cloudflare Tunnel)

Expose a **local Ollama** `anima-chat` brain as a public OpenAI-compatible URL the Cloudflare Worker can call. This is **not GPU vLLM** (Ministral 8B still needs `scripts/llm/docker-compose.vllm.yml` on a GPU host).

The Worker at `anima-protocol.com` cannot reach `localhost` (Cloudflare error 1003). Fly (`deploy/ollama-fly/`) is the always-on production path. This directory is the **named-tunnel** path when Ollama is already running on a CPU box.

## What you get

- Bearer proxy on `127.0.0.1:18000` in front of Ollama `:11434` (`Host: 127.0.0.1:11434` so Ollama does not 403)
- Unauthenticated `/v1/*` → **401**
- `/healthz` → `ok` (no model call)
- Named tunnel hostname, e.g. `https://llm.anima-protocol.com/v1`

Never commit `proxy-token` or `tunnel-token`. Weights stay on the host (`~/.ollama` / `OLLAMA_MODELS`), not in git.

## One-time Cloudflare

1. Create a Cloudflare Tunnel (`anima-llm`) with remote config.
2. Ingress: hostname `llm.anima-protocol.com` → `http://127.0.0.1:18000`.
3. DNS CNAME `llm` → `<tunnel-id>.cfargotunnel.com` (proxied).
4. **Worker routes:** a catch-all `*.anima-protocol.com/*` swallows the tunnel and serves the SPA instead of `/v1`. Narrow it (e.g. `www.anima-protocol.com/*`) or exclude `llm.`. Apex can stay on the Worker custom domain.
5. Write the tunnel token to `scripts/llm/public-v1/tunnel-token` (mode `600`) **or** export `CLOUDFLARE_TUNNEL_TOKEN`.
6. `openssl rand -hex 32 > scripts/llm/public-v1/proxy-token && chmod 600 scripts/llm/public-v1/proxy-token`

## Run

```bash
pnpm llm:up   # Ollama + anima-chat on :11434
bash scripts/llm/public-v1/start-public-v1.sh
```

Smoke:

```bash
curl -sS https://llm.anima-protocol.com/healthz
curl -sS -o /dev/null -w '%{http_code}\n' https://llm.anima-protocol.com/v1/models
# 401
curl -sS https://llm.anima-protocol.com/v1/models \
  -H "Authorization: Bearer $(cat scripts/llm/public-v1/proxy-token)"
```

## Worker wiring (Secrets Store, then binding)

Do **not** put `ANIMA_LOCAL_LLM_BASE_URL` in `wrangler.jsonc` `vars`. Ordered runbook is in [`deploy/ollama-fly/README.md`](../../../deploy/ollama-fly/README.md).

| Name | Value |
|------|--------|
| `ANIMA_LOCAL_LLM_BASE_URL` | `https://llm.anima-protocol.com/v1` |
| `ANIMA_LOCAL_LLM_API_KEY` | same string as `proxy-token` |
| `ANIMA_LOCAL_LLM_BACKEND` | already `ollama` in `vars` |
| `ANIMA_OLLAMA_MODEL_STANDARD` | already `anima-chat` in `vars` |

```bash
curl -sS 'https://anima-protocol.com/api/healthz/llm?probe=1'
# want: preferred=local, host=llm.anima-protocol.com, probeOk=true
```

The tunnel dies when the origin box / `cloudflared` stops. For a warm production host, use Fly.
