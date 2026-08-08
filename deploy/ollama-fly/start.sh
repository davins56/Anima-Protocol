#!/bin/sh
# Runtime entrypoint: Ollama (loopback-only) behind an authenticated Caddy
# reverse proxy (public). Refuses to start without an auth token so this
# never accidentally goes live as an open, unauthenticated endpoint.
set -eu

if [ -z "${PROXY_AUTH_TOKEN:-}" ]; then
  echo "PROXY_AUTH_TOKEN is not set — refusing to start an unauthenticated public endpoint." >&2
  echo "Set it with: fly secrets set PROXY_AUTH_TOKEN=\$(openssl rand -hex 32)" >&2
  exit 1
fi

OLLAMA_HOST=127.0.0.1:11434 ollama serve &
OLLAMA_PID=$!

CADDY_PID=""
term_handler() {
  [ -n "$OLLAMA_PID" ] && kill -TERM "$OLLAMA_PID" 2>/dev/null || true
  [ -n "$CADDY_PID" ] && kill -TERM "$CADDY_PID" 2>/dev/null || true
  wait 2>/dev/null || true
  exit 0
}
trap term_handler TERM INT

for i in $(seq 1 30); do
  curl -sf http://127.0.0.1:11434/api/tags >/dev/null 2>&1 && break
  sleep 1
done

caddy run --config /etc/caddy/Caddyfile --adapter caddyfile &
CADDY_PID=$!

wait "$CADDY_PID"
