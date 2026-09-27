#!/usr/bin/env bash
# Deploy the steward's own model to Fly with the repository root as the Docker
# context, after checking the trained files the image needs are present.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

CKPT_SRC="${CKPT_SRC:-out/anima-dpo/ckpt.pt}"
missing=0
for f in "$CKPT_SRC" data/anima_tokens/tokenizer.json data/anima_tokens/meta.json; do
  if [ ! -f "$f" ]; then
    echo "missing: $f" >&2
    missing=1
  fi
done
if [ "$missing" -ne 0 ]; then
  echo "Train (training/README.md) or copy your Colab outputs into place first." >&2
  echo "Use CKPT_SRC=out/anima-sft/ckpt.pt to serve the SFT checkpoint instead." >&2
  exit 1
fi

exec fly deploy \
  --config deploy/own-model-fly/fly.toml \
  --dockerfile deploy/own-model-fly/Dockerfile \
  --build-arg "CKPT_SRC=${CKPT_SRC}" \
  "$@"
