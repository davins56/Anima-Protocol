#!/usr/bin/env bash
# Optional local checkout of moeru-ai/airi.
#
# Production Worker / frontend / Codespace do not import this tree.
# It is not a git submodule: Cloudflare Workers Builds always runs
# `git submodule update` on clone, so unused gitlinks block deploys.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DEST="${1:-$ROOT/vendor/airi}"
URL="https://github.com/moeru-ai/airi.git"
REF="${AIRI_REF:-cc791fab954fbcfbef0bcb8d49ff75514f549c74}"

if [ -d "$DEST/.git" ]; then
  echo "airi already cloned at $DEST"
  exit 0
fi

if [ -e "$DEST" ] && [ ! -d "$DEST" ]; then
  echo "refusing to overwrite non-directory: $DEST" >&2
  exit 1
fi

mkdir -p "$(dirname "$DEST")"
git clone --filter=blob:none "$URL" "$DEST"
git -C "$DEST" checkout --detach "$REF"
echo "cloned $URL at $REF into $DEST"
