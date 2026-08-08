# Deploying the Anima LLM to production (no infra yet)

This is the recommended path when you don't already have a GPU box, VPS, or
cloud account picked out. Goal: a public HTTPS endpoint serving the branded
`anima-chat` model, wired into Vercel via `ANIMA_LOCAL_LLM_BASE_URL`, so
production chat never touches Gemini/Groq/Kimi/Grok/ChatGPT (see
[`docs/custom-llm.md`](./custom-llm.md) for the routing rules and the
`ANIMA_ALLOW_CLOUD_LLM` gate that keeps it that way).

Two stages: get it working (cheap CPU VPS, minutes to set up), then upgrade to
GPU (Ministral 3 8B) once you've validated the product loop end-to-end.

## Stage 1 — CPU VPS + Ollama + Cloudflare Tunnel

`anima-chat` (Qwen2.5 3B) runs acceptably on CPU — this is the same model
`pnpm llm:up` bootstraps locally. No GPU required to get a real endpoint live.

### 1. Get a small VPS

Any provider works; pick one you're comfortable with. Cheap, reliable options:

| Provider | Approx. spec / cost |
|----------|---------------------|
| Hetzner CX22 | 2 vCPU / 4 GB RAM, ~€4–5/mo |
| DigitalOcean Basic Droplet | 2 vCPU / 4 GB RAM, ~$12/mo (2 GB RAM tier, ~$6/mo, works but tighter) |
| Any VPS you already have an account with | 2+ vCPU / 4+ GB RAM recommended |

4 GB RAM is enough to hold the ~2 GB Qwen2.5 3B weights plus headroom.

### 2. Install Docker + bring up Ollama

SSH into the VPS, then either use the repo's dev compose file or a bare Ollama
install — the compose route is less setup:

```bash
git clone <your fork of this repo>
cd Anima-Protocol
docker compose -f docker-compose.dev.yml up -d ollama anima-llm-bootstrap
docker compose -f docker-compose.dev.yml logs -f anima-llm-bootstrap   # wait for "Anima LLM ready"
```

(You don't need the `postgres` service from that file here — the database can
stay wherever it already runs, e.g. Supabase/Neon/Vercel Postgres.)

Or without Docker: install Ollama directly (`curl -fsSL https://ollama.com/install.sh | sh`)
and run `bash scripts/llm/bootstrap-anima-llm.sh`.

Verify locally on the VPS:

```bash
curl -s http://127.0.0.1:11434/v1/models
```

### 3. Expose it over public HTTPS with a Cloudflare Tunnel

No account needed to start, no open ports, no static IP:

```bash
bash scripts/llm/tunnel-cloudflared.sh
# → prints https://<random-words>.trycloudflare.com
```

This is fine for validating the whole pipeline. For anything long-lived,
upgrade to a **named tunnel** (free Cloudflare account, persistent hostname
that survives VPS/process restarts — the URL doesn't change every time):

1. Cloudflare dashboard → Zero Trust → Networks → Tunnels → create a tunnel,
   point it at `http://localhost:11434`, grab the token.
2. `CLOUDFLARE_TUNNEL_TOKEN=<token> bash scripts/llm/tunnel-cloudflared.sh`
3. Run it under a process supervisor (systemd/tmux/pm2) so it survives reboots.

### 4. Wire Vercel to the tunnel

Set on Vercel (Production) and redeploy without build cache:

```bash
ANIMA_LLM_PROVIDER=custom
ANIMA_LOCAL_LLM_BACKEND=ollama
ANIMA_LOCAL_LLM_BASE_URL=https://<your-tunnel-host>/v1
ANIMA_OLLAMA_MODEL_STANDARD=anima-chat
```

### 5. Verify

```bash
curl -s https://www.anima-protocol.com/api/healthz/llm | jq '{mode,preferred,localEndpoint,note}'
# expect: mode=local, preferred=local, localEndpoint.configured=true, hasV1Path=true

curl -s 'https://www.anima-protocol.com/api/healthz/llm?probe=1' | jq '{preferred,probeOk,probes}'
```

Full troubleshooting checklist: the "Production note (Vercel)" section of [`docs/custom-llm.md`](./custom-llm.md).

## Stage 2 — GPU upgrade (Ministral 3 8B via vLLM)

Once Stage 1 is validated end-to-end, move to a GPU for a noticeably better
model. Cheapest way to try this without buying hardware: an on-demand GPU pod.

1. Rent a pod (RunPod, Vast.ai, Lambda, etc.) — one NVIDIA GPU with ≥16 GB
   VRAM (e.g. RTX 4090 / A10) is enough to serve Ministral 3 8B in BF16 or
   FP8. Most of these providers give you a container with Docker + NVIDIA
   Container Toolkit pre-installed.
2. On the pod:

   ```bash
   export ANIMA_VLLM_MODEL=mistralai/Ministral-3-8B-Instruct-2512
   docker compose -f scripts/llm/docker-compose.vllm.yml up -d
   ```

3. Expose port 8000 over HTTPS — either the tunnel script
   (`ANIMA_TUNNEL_PORT=8000 bash scripts/llm/tunnel-cloudflared.sh`) or the
   provider's own HTTPS proxy URL for exposed ports, if it has one.
4. Update Vercel:

   ```bash
   ANIMA_LOCAL_LLM_BACKEND=vllm
   ANIMA_LOCAL_LLM_BASE_URL=https://<your-vllm-host>/v1
   ANIMA_VLLM_MODEL_STANDARD=mistralai/Ministral-3-8B-Instruct-2512
   ```

5. Re-run the `/api/healthz/llm` checks from Stage 1.

For an actually fine-tuned checkpoint (not just the stock Instruct weights) on
this same GPU, see the "Path B — GPU upgrade" section of
[`docs/custom-llm.md`](./custom-llm.md) — `pnpm llm:prepare-finetune`, then
`scripts/llm/finetune/unsloth_sft.py` or LLaMA-Factory, then point
`ANIMA_VLLM_MODEL` at the resulting checkpoint.

## Alternative: Render (no VPS/SSH/tunnel needed)

If you'd rather not manage a VPS, SSH, or a Cloudflare Tunnel, Render can host
the same `anima-chat` model as a Docker web service with a stable public
HTTPS URL out of the box.

**Do not use Render's auto-detected Node build** — that deploys the *main*
Anima Protocol app, not the LLM. Create a **second, separate** service
specifically for the model:

1. Render dashboard → New → Web Service → pick this repo.
2. **Language: switch to `Docker`** (not the auto-detected Node).
3. **Dockerfile Path**: `scripts/llm/render/Dockerfile`
4. **Name**: something distinct from the main app, e.g. `anima-llm`.
5. **Instance Type**: at least **Standard** (2 GB RAM / $25mo). The Free and
   Starter tiers (512 MB) are too small to hold the ~2 GB `anima-chat`
   (Qwen2.5 3B) weights — the process will OOM. **Pro** (4 GB / $85mo) gives
   comfortable headroom if you later swap in a bigger model.
6. **Advanced → Add Disk**: mount path `/root/.ollama`, size ≥10 GB. Without
   this, every redeploy re-downloads the ~2 GB weights from scratch.
7. Deploy. First boot pulls the base weights and creates `anima-chat` — watch
   the logs for `Anima LLM ready on :11434`. This can take a few minutes.
8. Copy the service's `onrender.com` URL, then set on Vercel (Production) and
   redeploy without build cache:
   ```bash
   ANIMA_LLM_PROVIDER=custom
   ANIMA_LOCAL_LLM_BACKEND=ollama
   ANIMA_LOCAL_LLM_BASE_URL=https://<your-service>.onrender.com/v1
   ANIMA_OLLAMA_MODEL_STANDARD=anima-chat
   ```
9. Verify with the same `/api/healthz/llm` checks as Stage 1.

## Cost-cutting notes

- Stop/pause the GPU pod when not actively serving traffic if your provider
  bills by the hour — Stage 1's CPU VPS can be the always-on fallback while
  the GPU is only up during active development/eval sessions.
- A quick tunnel's URL changes on restart; if you're rebooting the VPS often
  during setup, expect to re-paste `ANIMA_LOCAL_LLM_BASE_URL` on Vercel each
  time until you switch to a named tunnel.
