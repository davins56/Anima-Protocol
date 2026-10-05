#!/usr/bin/env bash
# Public HTTPS OpenAI-compatible /v1 in front of local Ollama (CPU anima-chat).
# This is not GPU vLLM. Requires: Ollama on :11434, cloudflared, a named-tunnel
# token file, and a bearer file. Never commit proxy-token or tunnel-token.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
OLLAMA_HOST="${OLLAMA_HOST:-127.0.0.1:11434}"
PROXY_HOST="${ANIMA_LLM_PROXY_HOST:-127.0.0.1}"
PROXY_PORT="${ANIMA_LLM_PROXY_PORT:-18000}"
TOKEN_FILE="${CLOUDFLARE_TUNNEL_TOKEN_FILE:-$ROOT/tunnel-token}"
BEARER_FILE="${ANIMA_LLM_PROXY_TOKEN_FILE:-$ROOT/proxy-token}"
PUBLIC_URL="${ANIMA_PUBLIC_LLM_URL:-https://llm.anima-protocol.com/v1}"
CLOUDFLARED_BIN="${CLOUDFLARED_BIN:-cloudflared}"
LOG_DIR="${ANIMA_LLM_LOG_DIR:-$ROOT/logs}"

die() { echo "error: $*" >&2; exit 1; }

if ! curl -sf "http://${OLLAMA_HOST}/api/tags" >/dev/null 2>&1 \
  && ! curl -sf "http://${OLLAMA_HOST}/v1/models" >/dev/null 2>&1; then
  die "nothing listening on ${OLLAMA_HOST}. Run: pnpm llm:up"
fi

[[ -s "$BEARER_FILE" || -n "${ANIMA_LLM_PROXY_TOKEN:-}" ]] \
  || die "missing bearer. Write a hex token to $BEARER_FILE (openssl rand -hex 32) — do not commit it."

mkdir -p "$LOG_DIR"
export ANIMA_LLM_UPSTREAM="${ANIMA_LLM_UPSTREAM:-$OLLAMA_HOST}"
export ANIMA_LLM_PROXY_HOST="$PROXY_HOST"
export ANIMA_LLM_PROXY_PORT="$PROXY_PORT"
export ANIMA_LLM_PROXY_TOKEN_FILE="$BEARER_FILE"

if ! curl -sf "http://${PROXY_HOST}:${PROXY_PORT}/healthz" >/dev/null 2>&1; then
  nohup python3 "$ROOT/openai-proxy.py" >>"$LOG_DIR/openai-proxy.log" 2>&1 &
  echo "Started openai-proxy pid $!"
  for _ in $(seq 1 20); do
    curl -sf "http://${PROXY_HOST}:${PROXY_PORT}/healthz" >/dev/null 2>&1 && break
    sleep 0.3
  done
fi
curl -sf "http://${PROXY_HOST}:${PROXY_PORT}/healthz" >/dev/null 2>&1 \
  || die "proxy did not start. See $LOG_DIR/openai-proxy.log"

if pgrep -f 'cloudflared tunnel run' >/dev/null 2>&1; then
  echo "cloudflared already running"
else
  command -v "$CLOUDFLARED_BIN" >/dev/null 2>&1 \
    || die "cloudflared not on PATH. Set CLOUDFLARED_BIN or install cloudflared."
  [[ -s "$TOKEN_FILE" || -n "${CLOUDFLARE_TUNNEL_TOKEN:-}" ]] \
    || die "missing named-tunnel token ($TOKEN_FILE or CLOUDFLARE_TUNNEL_TOKEN). Do not commit it."
  TUNNEL_TOKEN="${CLOUDFLARE_TUNNEL_TOKEN:-$(cat "$TOKEN_FILE")}"
  nohup "$CLOUDFLARED_BIN" tunnel run --token "$TUNNEL_TOKEN" \
    >>"$LOG_DIR/cloudflared.log" 2>&1 &
  echo "Started cloudflared pid $!"
fi

echo "Public URL: ${PUBLIC_URL}"
echo "Model: anima-chat (Ollama, not vLLM)"
echo "Worker secrets: ANIMA_LOCAL_LLM_BASE_URL=${PUBLIC_URL}"
echo "                ANIMA_LOCAL_LLM_API_KEY=<contents of ${BEARER_FILE}>"
echo "Do not put the URL in wrangler.jsonc vars. Do not commit token files."
