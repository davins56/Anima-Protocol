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

remote_is_airi() {
  local remote normalized
  remote="$(git -C "$1" remote get-url origin 2>/dev/null || true)"
  # Accept public HTTPS or credential-rewritten remotes; compare host + path only.
  normalized="${remote#*://}"
  normalized="${normalized#*@}"
  normalized="${normalized%%.git}"
  [ "$normalized" = "github.com/moeru-ai/airi" ]
}

head_is_ref() {
  [ "$(git -C "$1" rev-parse HEAD)" = "$REF" ]
}

if [ -e "$DEST" ] && [ ! -d "$DEST" ]; then
  echo "refusing to overwrite non-directory: $DEST" >&2
  exit 1
fi

created=0
if [ -d "$DEST/.git" ]; then
  if ! remote_is_airi "$DEST"; then
    echo "existing checkout at $DEST is not $URL" >&2
    exit 1
  fi
else
  if [ -d "$DEST" ] && [ -n "$(ls -A "$DEST" 2>/dev/null || true)" ]; then
    echo "refusing to clone into non-empty directory: $DEST" >&2
    exit 1
  fi
  mkdir -p "$(dirname "$DEST")"
  created=1
  trap 'if [ "${created:-0}" = 1 ]; then rm -rf "$DEST"; fi' EXIT
  git clone --filter=blob:none "$URL" "$DEST"
fi

if ! head_is_ref "$DEST"; then
  git -C "$DEST" fetch --filter=blob:none origin "$REF"
  git -C "$DEST" checkout --detach "$REF"
fi

if ! head_is_ref "$DEST"; then
  echo "checkout did not land on $REF" >&2
  exit 1
fi

created=0
trap - EXIT
echo "cloned $URL at $REF into $DEST"
