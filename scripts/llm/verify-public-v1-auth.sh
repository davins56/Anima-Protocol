#!/usr/bin/env bash
# Verify bearer auth on the public Anima model host.
#
# Fails (exit 1) if any unauthenticated /v1/* or /api/chat path answers.
# This is the regression guard for the tunnel-ingress mistake where
# llm.anima-protocol.com is pointed at Ollama (:11434) instead of the bearer
# proxy (:18000), which silently exposes the model to anyone on the internet.
#
# Usage:
#   pnpm llm:verify-auth
#   ANIMA_LLM_BASE=https://llm.anima-protocol.com pnpm llm:verify-auth
#   ANIMA_LLM_PROXY_TOKEN_FILE=scripts/llm/public-v1/proxy-token pnpm llm:verify-auth
#
# Exit codes:
#   0  /v1/* requires a bearer token; /healthz stays open
#   1  at least one unauthenticated path answered (NOT SECURED)
set -uo pipefail

BASE="${ANIMA_LLM_BASE:-https://llm.anima-protocol.com}"
TOKEN="${ANIMA_LLM_PROXY_TOKEN:-}"
TOKEN_FILE="${ANIMA_LLM_PROXY_TOKEN_FILE:-}"
TIMEOUT="${ANIMA_LLM_VERIFY_TIMEOUT:-15}"

if [ -z "$TOKEN" ] && [ -n "$TOKEN_FILE" ]; then
  if [ -s "$TOKEN_FILE" ]; then
    TOKEN="$(tr -d '[:space:]' < "$TOKEN_FILE")"
  else
    echo "warn: token file '$TOKEN_FILE' is missing or empty; skipping the authenticated check" >&2
  fi
fi

rc=0
chk() { # label want actual
  if [ "$2" = "$3" ]; then
    printf 'PASS  %-30s %s\n' "$1" "$3"
  else
    printf 'FAIL  %-30s got %s, want %s\n' "$1" "$3" "$2"
    rc=1
  fi
}

code() {
  curl -s -o /dev/null -w '%{http_code}' --max-time "$TIMEOUT" "$@" 2>/dev/null || echo "000"
}

echo "Target: $BASE"
echo

# /healthz is deliberately open (liveness) and must NOT require a token.
chk "healthz is open"            200 "$(code "$BASE/healthz")"

# Every model-facing route must reject a missing or wrong bearer.
chk "no-auth GET  /v1/models"    401 "$(code "$BASE/v1/models")"
chk "wrong-token /v1/models"     401 "$(code -H 'Authorization: Bearer wrong-token' "$BASE/v1/models")"
chk "no-auth POST /v1/chat"      401 "$(code -X POST "$BASE/v1/chat/completions" \
  -H 'Content-Type: application/json' \
  -d '{"model":"anima-chat","messages":[{"role":"user","content":"hi"}],"max_tokens":8}')"
chk "no-auth POST /api/chat"     401 "$(code -X POST "$BASE/api/chat" \
  -H 'Content-Type: application/json' \
  -d '{"model":"anima-chat","messages":[]}')"

if [ -n "$TOKEN" ]; then
  chk "good-token GET /v1/models" 200 "$(code -H "Authorization: Bearer $TOKEN" "$BASE/v1/models")"
else
  echo "SKIP  good-token GET /v1/models   (set ANIMA_LLM_PROXY_TOKEN_FILE to enable)"
fi

echo
if [ "$rc" -eq 0 ]; then
  echo "OK: /v1/* requires a bearer token; /healthz stays open."
  echo
  echo "Confirm the app can still reach the model (catches a token mismatch):"
  echo "  curl -sS 'https://anima-protocol.com/api/healthz/llm?probe=1'   # want probeOk: true"
else
  echo "NOT SECURED: at least one unauthenticated path answered."
  echo
  echo "Most likely cause: the Cloudflare Tunnel ingress for this hostname"
  echo "still points at Ollama (http://127.0.0.1:11434) instead of the"
  echo "bearer proxy (http://127.0.0.1:18000). See scripts/llm/public-v1/README.md."
  echo
  echo "Also confirm Ollama binds loopback only (OLLAMA_HOST=127.0.0.1:11434),"
  echo "so a future ingress edit cannot re-expose it."
  echo "A 404 on /healthz is a tell: that is Ollama's own 404, not the proxy's 'ok'."
fi
exit $rc
