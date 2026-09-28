#!/bin/sh
# Starts `ollama serve`, bootstraps the branded `anima-chat` model on first
# boot (skipped on later restarts once it's already on the persistent disk),
# then stays in the foreground serving traffic so Render sees a live process.
set -eu

# /v1/chat/completions drops keep_alive. The server default still applies.
export OLLAMA_KEEP_ALIVE="${OLLAMA_KEEP_ALIVE:-30m}"

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
  sleep 1
done

if ollama list 2>/dev/null | grep -q "^${ANIMA_BOOTSTRAP_BASE}"; then
  echo "${ANIMA_BOOTSTRAP_BASE} already present on disk, skipping pull."
else
  echo "Pulling open weights: ${ANIMA_BOOTSTRAP_BASE}"
  ollama pull "${ANIMA_BOOTSTRAP_BASE}"
fi
# Rebuild every boot so Modelfile changes (sampling, system prompt) apply.
echo "Creating Anima chat model: ${ANIMA_OLLAMA_CHAT_TAG}"
ollama create "${ANIMA_OLLAMA_CHAT_TAG}" -f /Modelfile.anima-chat

echo "Anima LLM ready on :11434 (${ANIMA_OLLAMA_CHAT_TAG})"
wait "$SERVE_PID"
