#!/usr/bin/env bash
# One-shot post-deploy check for the Anima custom LLM in production.
# Mirrors the "Quick diagnostic checklist" in docs/custom-llm.md so you don't
# have to hand-copy curl/jq commands after every deploy.
#
# Usage:
#   bash scripts/llm/verify-deploy.sh https://www.anima-protocol.com
#   bash scripts/llm/verify-deploy.sh https://www.anima-protocol.com https://your-tunnel-host
#   pnpm llm:verify-deploy -- https://www.anima-protocol.com

set -euo pipefail

APP_URL="${1:?usage: verify-deploy.sh <app-url> [tunnel-or-local-llm-url]}"
TUNNEL_URL="${2:-}"
FAILED=0

pass() { echo "  ✓ $*"; }
fail() { echo "  ✗ $*" >&2; FAILED=1; }

json_field() {
  # $1 = json on stdin, $2 = dotted path (simple, no arrays)
  node -e '
    let data = "";
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => {
      try {
        let value = JSON.parse(data);
        for (const key of process.argv[1].split(".")) value = value?.[key];
        console.log(value === undefined || value === null ? "" : value);
      } catch {
        console.log("");
      }
    });
  ' "$2" <<<"$1"
}

echo "== ${APP_URL%/}/api/healthz/llm =="
HEALTH="$(curl -sf "${APP_URL%/}/api/healthz/llm" || true)"
if [[ -z "${HEALTH}" ]]; then
  fail "unreachable"
else
  MODE="$(json_field "${HEALTH}" mode)"
  PREFERRED="$(json_field "${HEALTH}" preferred)"
  CONFIGURED="$(json_field "${HEALTH}" localEndpoint.configured)"
  HOST="$(json_field "${HEALTH}" localEndpoint.host)"
  HAS_V1="$(json_field "${HEALTH}" localEndpoint.hasV1Path)"
  NOTE="$(json_field "${HEALTH}" note)"

  echo "  mode=${MODE} preferred=${PREFERRED} localEndpoint.host=${HOST:-<none>} hasV1Path=${HAS_V1}"
  [[ -n "${NOTE}" ]] && echo "  note: ${NOTE}"

  [[ "${MODE}" == "local" ]] && pass "mode=local" || fail "mode=${MODE:-<empty>} (expected local — check ANIMA_LLM_PROVIDER)"
  [[ "${CONFIGURED}" == "true" ]] && pass "localEndpoint.configured=true" || fail "localEndpoint not configured — check ANIMA_LOCAL_LLM_BASE_URL"
  [[ "${HAS_V1}" == "true" ]] && pass "localEndpoint.hasV1Path=true" || fail "ANIMA_LOCAL_LLM_BASE_URL is missing a /v1 path"
fi

echo
echo "== ${APP_URL%/}/api/healthz/llm?probe=1 (live completion probe) =="
PROBE="$(curl -sf "${APP_URL%/}/api/healthz/llm?probe=1" || true)"
if [[ -z "${PROBE}" ]]; then
  fail "unreachable"
else
  PROBE_OK="$(json_field "${PROBE}" probeOk)"
  [[ "${PROBE_OK}" == "true" ]] && pass "probeOk=true" || fail "probeOk=${PROBE_OK:-false} — the app can't reach your model endpoint"
fi

if [[ -n "${TUNNEL_URL}" ]]; then
  echo
  echo "== ${TUNNEL_URL%/}/v1/models (direct check of your model host) =="
  MODELS="$(curl -sf "${TUNNEL_URL%/}/v1/models" || true)"
  if [[ -z "${MODELS}" ]]; then
    fail "unreachable"
  else
    pass "reachable: ${MODELS}"
  fi
fi

echo
if [[ "${FAILED}" -eq 0 ]]; then
  echo "All checks passed — production chat is on the self-hosted Anima LLM."
else
  echo "Some checks failed — see the 'Production note (Vercel)' section of docs/custom-llm.md." >&2
  exit 1
fi
