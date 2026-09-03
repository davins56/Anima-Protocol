#!/bin/sh
# Starts `ollama serve`, puts Caddy in front (Bearer PROXY_AUTH_TOKEN on /v1/*),
# bootstraps the branded `anima-chat` model on first boot (skipped once the
# Fly volume already has the weights), then stays up so Fly health checks pass
# during the first-boot pull.
#
# Same bootstrap conventions as scripts/llm/render/entrypoint.sh.
set -eu

if [ -z "${PROXY_AUTH_TOKEN:-}" ]; then
  echo "error: PROXY_AUTH_TOKEN must be set (fly secrets set PROXY_AUTH_TOKEN=… -a anima-chat-llm)" >&2
  exit 1
fi

OLLAMA_HOST="${OLLAMA_HOST:-0.0.0.0:11434}"
ANIMA_BOOTSTRAP_BASE="${ANIMA_BOOTSTRAP_BASE:-qwen2.5:3b}"
ANIMA_OLLAMA_CHAT_TAG="${ANIMA_OLLAMA_CHAT_TAG:-anima-chat}"
export OLLAMA_HOST

echo "Starting ollama serve on ${OLLAMA_HOST}..."
ollama serve &
SERVE_PID=$!

echo "Waiting for ollama serve to become ready..."
i=0
until curl -sf http://127.0.0.1:11434/api/tags >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -ge 60 ]; then
    echo "error: ollama serve did not become ready in time" >&2
    exit 1
  fi
  if ! kill -0 "$SERVE_PID" 2>/dev/null; then
    echo "error: ollama serve exited before becoming ready" >&2
    exit 1
  fi
  sleep 1
done

echo "Starting auth proxy on :8080..."
caddy run --config /Caddyfile --adapter caddyfile &
CADDY_PID=$!

bootstrap_model() {
  if ollama list 2>/dev/null | grep -q "^${ANIMA_OLLAMA_CHAT_TAG}"; then
    echo "${ANIMA_OLLAMA_CHAT_TAG} already present on volume, skipping bootstrap."
    return 0
  fi
  echo "Pulling open weights: ${ANIMA_BOOTSTRAP_BASE} (first boot; /healthz stays up)"
  ollama pull "${ANIMA_BOOTSTRAP_BASE}"
  echo "Creating Anima chat model: ${ANIMA_OLLAMA_CHAT_TAG}"
  ollama create "${ANIMA_OLLAMA_CHAT_TAG}" -f /Modelfile.anima-chat
  echo "Bootstrap complete: ${ANIMA_OLLAMA_CHAT_TAG}"
}

# Do not block health checks on the ~2 GB first pull.
bootstrap_model &
BOOTSTRAP_PID=$!

echo "Anima LLM proxy ready on :8080 (ollama :11434, model=${ANIMA_OLLAMA_CHAT_TAG})"

shutdown() {
  kill "$CADDY_PID" "$SERVE_PID" "$BOOTSTRAP_PID" 2>/dev/null || true
}
trap shutdown INT TERM

# Stay in the foreground until ollama or Caddy dies. A finished bootstrap is fine.
while kill -0 "$SERVE_PID" 2>/dev/null && kill -0 "$CADDY_PID" 2>/dev/null; do
  sleep 2
done

if ! kill -0 "$SERVE_PID" 2>/dev/null; then
  echo "error: ollama serve exited" >&2
  shutdown
  exit 1
fi
echo "error: auth proxy exited" >&2
shutdown
exit 1
