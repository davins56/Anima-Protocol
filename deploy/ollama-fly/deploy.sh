#!/usr/bin/env bash
# Deploy anima-chat-llm using the repository root as the Docker context
# (required so the Dockerfile can COPY scripts/llm/Modelfile.anima-chat).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
exec fly deploy \
  --config deploy/ollama-fly/fly.toml \
  --dockerfile deploy/ollama-fly/Dockerfile \
  "$@"
