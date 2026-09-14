# Anima LLM — public HTTPS host

Production chat is **one** backend: `ANIMA_LOCAL_LLM_BASE_URL` (OpenAI-compatible
`…/v1`). The Cloudflare Worker cannot reach `localhost`. This page is the
ops pointer so links from `docs/custom-llm.md` resolve. Renting the box and
flipping the secret is still a human step (TODO.llm.md "Still manual").

Do **not** set `ANIMA_LOCAL_LLM_BASE_URL` to `api.openai.com`.

## Paths that already exist

| Path | When |
|------|------|
| [`scripts/llm/public-v1/`](../scripts/llm/public-v1/README.md) | Ollama already running on a CPU box; named Cloudflare Tunnel (`https://llm.anima-protocol.com/v1`) |
| [`scripts/llm/tunnel-cloudflared.sh`](../scripts/llm/tunnel-cloudflared.sh) (`pnpm llm:tunnel`) | Quick tunnel for a laptop/VPS |
| [`scripts/llm/cloud-init-vps.sh`](../scripts/llm/cloud-init-vps.sh) (`pnpm llm:vps-init`) | Fresh Debian/Ubuntu: Ollama + `anima-chat` + systemd |
| [`deploy/ollama-fly/`](../deploy/ollama-fly/README.md) | Always-on Fly.io image |
| [`scripts/llm/docker-compose.vllm.yml`](../scripts/llm/docker-compose.vllm.yml) | GPU vLLM after QLoRA (Ministral 8B) |

After the host answers on HTTPS `/v1`:

```bash
# Worker / Vercel secrets — never commit values
ANIMA_LOCAL_LLM_BASE_URL=https://<host>/v1
ANIMA_LOCAL_LLM_API_KEY=<same as the proxy token>
ANIMA_LOCAL_LLM_BACKEND=ollama   # or vllm
ANIMA_OLLAMA_MODEL_STANDARD=anima-chat   # or anima-ministral8b after fine-tune

pnpm llm:verify-deploy -- https://anima-protocol.com https://<host>
```

Fine-tune + GGUF before pointing production at a new tag:
[`docs/llm-build.md`](./llm-build.md).
