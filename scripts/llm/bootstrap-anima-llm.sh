#!/usr/bin/env bash
# Bootstrap the Anima open chat LLM (no ChatGPT / Gemini / Groq).
#
# Installs nothing proprietary: uses Ollama + public Qwen2.5 weights, then
# creates the branded `anima-chat` model and smoke-tests OpenAI-compatible chat.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MODELFILE="${ROOT}/scripts/llm/Modelfile.anima-chat"
BASE_MODEL="${ANIMA_BOOTSTRAP_BASE:-qwen2.5:3b}"
ANIMA_TAG="${ANIMA_OLLAMA_CHAT_TAG:-anima-chat}"
OLLAMA_HOST="${OLLAMA_HOST:-127.0.0.1:11434}"
export OLLAMA_HOST

die() { echo "error: $*" >&2; exit 1; }

if ! command -v ollama >/dev/null 2>&1; then
  die "ollama not found. Install from https://ollama.com then re-run."
fi

if ! curl -sf "http://${OLLAMA_HOST}/api/tags" >/dev/null 2>&1; then
  echo "Starting ollama serve on ${OLLAMA_HOST}…"
  if command -v tmux >/dev/null 2>&1; then
    tmux has-session -t "=ollama-serve" 2>/dev/null || \
      tmux new-session -d -s "ollama-serve" -- ollama serve
  else
    nohup ollama serve >/tmp/ollama-serve.log 2>&1 &
  fi
  for _ in $(seq 1 30); do
    curl -sf "http://${OLLAMA_HOST}/api/tags" >/dev/null 2>&1 && break
    sleep 1
  done
  curl -sf "http://${OLLAMA_HOST}/api/tags" >/dev/null 2>&1 || \
    die "ollama did not become ready on ${OLLAMA_HOST}"
fi

echo "Pulling open weights: ${BASE_MODEL}"
ollama pull "${BASE_MODEL}"

echo "Creating Anima chat model: ${ANIMA_TAG}"
[[ -f "${MODELFILE}" ]] || die "missing ${MODELFILE}"
ollama create "${ANIMA_TAG}" -f "${MODELFILE}"

echo "Smoke-testing chat…"
RESP="$(curl -sf "http://${OLLAMA_HOST}/v1/chat/completions" \
  -H 'Content-Type: application/json' \
  -d "{\"model\":\"${ANIMA_TAG}\",\"messages\":[{\"role\":\"user\",\"content\":\"Reply with exactly: Anima LLM ready\"}],\"max_tokens\":32}")"

echo "${RESP}" | grep -qi 'anima' || {
  echo "${RESP}" >&2
  die "chat smoke test failed"
}

echo
echo "✓ Anima LLM is ready (open weights, local only)."
echo
echo "Wire the api-server (no Gemini/Groq/OpenAI chat keys needed):"
echo "  export ANIMA_LLM_PROVIDER=custom"
echo "  export ANIMA_LOCAL_LLM_BACKEND=ollama"
echo "  export ANIMA_LOCAL_LLM_BASE_URL=http://${OLLAMA_HOST}/v1"
echo "  export ANIMA_OLLAMA_MODEL_STANDARD=${ANIMA_TAG}"
echo "  export ANIMA_OLLAMA_MODEL_LIGHT=${ANIMA_TAG}"
echo "  export ANIMA_OLLAMA_MODEL_HEAVY=${ANIMA_TAG}"
echo
echo "Try a turn:"
echo "  pnpm llm:chat -- \"Who are you?\""
echo "  ollama run ${ANIMA_TAG}"
