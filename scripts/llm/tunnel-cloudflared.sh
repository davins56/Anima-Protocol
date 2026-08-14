#!/usr/bin/env bash
# Expose a local OpenAI-compatible LLM endpoint (Ollama/vLLM) over public HTTPS
# via a Cloudflare Tunnel — no account, no open router ports, no static IP.
#
# Quick tunnel (default): free, no Cloudflare account needed. Prints a random
# https://<random>.trycloudflare.com URL each run — fine for testing, but the
# URL changes every restart, so re-set ANIMA_LOCAL_LLM_BASE_URL on Vercel after
# each restart if you use this mode long-term.
#
# Named tunnel (persistent URL): set CLOUDFLARE_TUNNEL_TOKEN (from a Cloudflare
# Zero Trust tunnel you created — https://one.dash.cloudflare.com → Networks →
# Tunnels) for a stable hostname that survives restarts. Recommended for
# production once you've validated the quick-tunnel path works.
#
# Usage:
#   bash scripts/llm/tunnel-cloudflared.sh              # quick tunnel → :11434 (Ollama)
#   ANIMA_TUNNEL_PORT=8000 bash scripts/llm/tunnel-cloudflared.sh   # vLLM instead
#   CLOUDFLARE_TUNNEL_TOKEN=... bash scripts/llm/tunnel-cloudflared.sh  # named tunnel

set -euo pipefail

PORT="${ANIMA_TUNNEL_PORT:-11434}"

die() { echo "error: $*" >&2; exit 1; }

if ! command -v cloudflared >/dev/null 2>&1; then
  die "cloudflared not found. Install it first:
  # Debian/Ubuntu:
  curl -L --output /tmp/cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
  sudo dpkg -i /tmp/cloudflared.deb
  # macOS: brew install cloudflared
  # Other platforms: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
fi

if ! curl -sf "http://127.0.0.1:${PORT}/v1/models" >/dev/null 2>&1 \
  && ! curl -sf "http://127.0.0.1:${PORT}/api/tags" >/dev/null 2>&1; then
  echo "warning: nothing answering on http://127.0.0.1:${PORT} yet." >&2
  echo "  Run 'pnpm llm:up' (Ollama) or the vLLM docker-compose first, then re-run this." >&2
fi

if [[ -n "${CLOUDFLARE_TUNNEL_TOKEN:-}" ]]; then
  echo "Starting named Cloudflare Tunnel (persistent hostname, configured in the Cloudflare dashboard)…"
  exec cloudflared tunnel run --token "${CLOUDFLARE_TUNNEL_TOKEN}"
fi

echo "Starting a Cloudflare quick tunnel → http://127.0.0.1:${PORT}"
echo "The public https://*.trycloudflare.com URL prints below once connected."
echo "Set on Vercel:  ANIMA_LOCAL_LLM_BASE_URL=<that URL>/v1"
echo "(quick tunnels are for testing — the URL changes on every restart;"
echo " see the header of this script for a persistent named-tunnel option)"
echo
exec cloudflared tunnel --url "http://127.0.0.1:${PORT}"
