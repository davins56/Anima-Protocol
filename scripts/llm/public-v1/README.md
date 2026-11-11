# Public HTTPS `/v1` (Ollama + Cloudflare Tunnel)

Expose a **local Ollama** `anima-chat` brain as a public OpenAI-compatible URL the Cloudflare Worker can call. This is **not GPU vLLM** (Ministral 8B still needs `scripts/llm/docker-compose.vllm.yml` on a GPU host).

The Worker at `anima-protocol.com` cannot reach `localhost` (Cloudflare error 1003). Production defaults to the Cloudflare brain (`ANIMA_CHAT_BRAIN=cloudflare`, [`docs/chat-brain.md`](../../../docs/chat-brain.md)). This directory is the **named-tunnel** path when Ollama is already running on a CPU box.

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

Do **not** put `ANIMA_LOCAL_LLM_BASE_URL` in `wrangler.jsonc` `vars`. Set `ANIMA_CHAT_BRAIN=self-hosted` in `wrangler.jsonc` `vars` to use it.

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

The tunnel dies when the origin box / `cloudflared` stops. For an always-on production brain, use `ANIMA_CHAT_BRAIN=cloudflare`.

## keep_alive

Ollama's OpenAI route (`/v1/chat/completions`) **drops** `keep_alive`. This proxy rewrites `POST /v1/chat/completions` onto native `POST /api/chat` and **streams** the reply. It does **not** inject `keep_alive`. The Worker also omits the field unless `ANIMA_OLLAMA_KEEP_ALIVE` is set, so the daemon value wins. A client hang-up closes the upstream connection so Ollama stops the generate. Translated `num_predict` is capped at 200.

Pin the daemon so the model stays loaded:

```bash
# systemd drop-in, or the shell that runs `ollama serve`
export OLLAMA_KEEP_ALIVE=-1
```

Restart **this proxy** after pulling the rewrite (`start-public-v1.sh` will not replace an already-healthy process). Companion `/api/chat/messages` waits 90s for the first token. Leave `/api/ai/chat` at 18s (Worker ~20s wall). Do not turn on `ANIMA_OPENROUTER_FALLBACK` to hide a cold box — customOnly stays fail-closed.

`ANIMA_LLM_PROXY_NATIVE=0` passes `/v1/chat/completions` through unchanged (vLLM).

## Voice (self-hosted, `anima-voice/1`)

Her voice runs on this box too ([`docs/voice-local.md`](../../../docs/voice-local.md)). The proxy forwards, with the same bearer, prefix stripped:

| Public path | Upstream | Open routes |
|------|------|------|
| `/tts/*` | Kokoro-FastAPI, `ANIMA_VOICE_TTS_UPSTREAM` (default `127.0.0.1:8880`) | `GET /health`, `GET /v1/audio/voices`, `POST /v1/audio/speech`, `POST /dev/captioned_speech`, `POST /dev/phonemize` |
| `/stt/*` | speaches (faster-whisper), `ANIMA_VOICE_STT_UPSTREAM` (default `127.0.0.1:8000`) | `GET /health`, `POST /v1/audio/transcriptions` |

Everything else under `/tts` and `/stt` is 404 (speaches model download/delete stays closed). Bodies over 4 MB are 413. The bearer is not forwarded to the local servers, so bind them to `127.0.0.1`. A client hang-up shuts the upstream socket.

```bash
# Kokoro on the GPU (Apache-2.0 weights)
docker run -d --restart unless-stopped --gpus all -p 127.0.0.1:8880:8880 ghcr.io/remsky/kokoro-fastapi-gpu:latest
# faster-whisper on the CPU
docker run -d --restart unless-stopped -p 127.0.0.1:8000:8000 \
  -v hf-hub-cache:/home/ubuntu/.cache/huggingface/hub ghcr.io/speaches-ai/speaches:latest-cpu
SPEACHES_BASE_URL=http://127.0.0.1:8000 uvx speaches-cli model download Systran/faster-distil-whisper-small.en
# Restart the proxy so it picks up the voice routes (a healthy old proxy is left running)
pkill -f openai-proxy.py; bash scripts/llm/public-v1/start-public-v1.sh   # ANIMA_VOICE_ONLY=1 if Ollama is not running
```

Smoke (expects `{"status":...}` from each):

```bash
T="Authorization: Bearer $(cat scripts/llm/public-v1/proxy-token)"
curl -sS -H "$T" https://llm.anima-protocol.com/tts/health
curl -sS -H "$T" https://llm.anima-protocol.com/stt/health
curl -sS -H "$T" https://llm.anima-protocol.com/tts/v1/audio/voices | head -c 300
```

Worker secrets (Secrets Store first, then a binding; not in `vars`): `ANIMA_LOCAL_VOICE_BASE_URL=https://llm.anima-protocol.com` (no `/v1`) and optionally `ANIMA_LOCAL_VOICE_API_KEY` (defaults to `ANIMA_LOCAL_LLM_API_KEY`). Without the URL, voice reports `disabled_by_user`; when the box is down it reports `box_unreachable`. There is no cloud fallback.

If chat moves to vLLM on the same GPU, cap `--gpu-memory-utilization` so Kokoro keeps its share.
