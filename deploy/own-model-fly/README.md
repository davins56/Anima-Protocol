# Fly.io host for your own model (`anima-own-llm`)

Serves the tiny GPT you trained (`training/`) through `server/server.py` over a
public HTTPS, OpenAI-compatible API, and lets the app teach it (see
`docs/own-model.md`). The Cloudflare Worker at `anima-protocol.com` cannot reach
`localhost`, so this app provides the URL for `ANIMA_OWN_LLM_BASE_URL`.

## What you get

- `server/server.py` on `:8080` with CPU PyTorch.
- `Authorization: Bearer <ANIMA_SERVER_TOKEN>` required on every `/v1/*` route.
  The server refuses to start on a public interface without the token.
- `/health`, a public liveness check for Fly.
- A volume at `/data` for learned versions and the lesson store, so what it
  learns survives restarts and redeploys.
- Your trained checkpoint and tokenizer baked into the image. They are
  gitignored, so they are never committed.
- One machine kept running (`auto_stop_machines = "off"`). Learning runs in the
  background after a lesson request returns, and a machine stopped mid-lesson
  would lose that practice.

## Prerequisites

- [flyctl](https://fly.io/docs/flyctl/install/), logged in (`fly auth login`).
- The trained files at these paths (copy them down from Colab if you trained there):
  - `out/anima-dpo/ckpt.pt` (or set `CKPT_SRC=out/anima-sft/ckpt.pt`)
  - `data/anima_tokens/tokenizer.json`
  - `data/anima_tokens/meta.json`

## Steps

Run these from the repository root:

```bash
# 1. Create the app without deploying
fly apps create anima-own-llm

# 2. Volume for learned versions + lessons
fly volumes create anima_own_data --size 1 --app anima-own-llm --yes

# 3. Bearer token — generate locally, do not commit
ANIMA_SERVER_TOKEN="$(openssl rand -hex 32)"
fly secrets set ANIMA_SERVER_TOKEN="${ANIMA_SERVER_TOKEN}" -a anima-own-llm
# Keep the value: it becomes ANIMA_OWN_LLM_API_KEY on the api-server

# 4. Deploy (checks the trained files are present first)
deploy/own-model-fly/deploy.sh
```

## Check it

```bash
curl https://anima-own-llm.fly.dev/health
curl https://anima-own-llm.fly.dev/v1/chat/completions \
  -H "Authorization: Bearer $ANIMA_SERVER_TOKEN" -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Hello"}]}'
```

Then set `ANIMA_OWN_LLM_BASE_URL=https://anima-own-llm.fly.dev/v1` and
`ANIMA_OWN_LLM_API_KEY` on the api-server (see `docs/own-model.md` →
"Connect production").

## After a retrain

Copy the new `ckpt.pt` (and tokenizer, if phase 1 changed) into place and run
`deploy/own-model-fly/deploy.sh` again. The server sees a different base
checkpoint and relearns every stored lesson on top of it. To make it relearn
from the app's full lesson list, use Settings → Model Tutor → **Re-teach all
lessons**.

## Sizing

`shared-cpu-2x` / 2 GB serves and teaches the default ~13M-parameter model. A
lesson takes about 10–30 s. More CPUs make learning faster; a GPU is not needed.
