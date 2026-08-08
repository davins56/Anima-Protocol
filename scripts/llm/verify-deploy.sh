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

# Fetches a URL without letting a non-2xx status (health endpoints
# deliberately return 503 with diagnostic JSON) discard the response body.
# Sets FETCH_STATUS ("000" if unreachable) and FETCH_BODY.
fetch() {
  local tmp
  tmp="$(mktemp)"
  FETCH_STATUS="$(curl -s -o "${tmp}" -w '%{http_code}' "$1" || echo "000")"
  FETCH_BODY="$(cat "${tmp}")"
  rm -f "${tmp}"
}

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

# Looks up probes[].ok for the entry whose provider matches $2 (e.g. "local")
# — the aggregate probeOk can be true from a cloud provider even when local
# is broken, so this checks the provider that actually matters here.
json_probe_ok() {
  node -e '
    let data = "";
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => {
      try {
        const body = JSON.parse(data);
        const probes = Array.isArray(body.probes) ? body.probes : [];
        const entry = probes.find((p) => p && p.provider === process.argv[1]);
        console.log(entry ? String(!!entry.ok) : "");
      } catch {
        console.log("");
      }
    });
  ' "$2" <<<"$1"
}

echo "== ${APP_URL%/}/api/healthz/llm =="
fetch "${APP_URL%/}/api/healthz/llm"
if [[ "${FETCH_STATUS}" == "000" || -z "${FETCH_BODY}" ]]; then
  fail "unreachable"
else
  MODE="$(json_field "${FETCH_BODY}" mode)"
  PREFERRED="$(json_field "${FETCH_BODY}" preferred)"
  CONFIGURED="$(json_field "${FETCH_BODY}" localEndpoint.configured)"
  HOST="$(json_field "${FETCH_BODY}" localEndpoint.host)"
  HAS_V1="$(json_field "${FETCH_BODY}" localEndpoint.hasV1Path)"
  NOTE="$(json_field "${FETCH_BODY}" note)"

  echo "  HTTP ${FETCH_STATUS} · mode=${MODE} preferred=${PREFERRED} localEndpoint.host=${HOST:-<none>} hasV1Path=${HAS_V1}"
  [[ -n "${NOTE}" ]] && echo "  note: ${NOTE}"

  [[ "${MODE}" == "local" ]] && pass "mode=local" || fail "mode=${MODE:-<empty>} (expected local — check ANIMA_LLM_PROVIDER)"
  [[ "${CONFIGURED}" == "true" ]] && pass "localEndpoint.configured=true" || fail "localEndpoint not configured — check ANIMA_LOCAL_LLM_BASE_URL"
  [[ "${HAS_V1}" == "true" ]] && pass "localEndpoint.hasV1Path=true" || fail "ANIMA_LOCAL_LLM_BASE_URL is missing a /v1 path"
fi

echo
echo "== ${APP_URL%/}/api/healthz/llm?probe=1 (live completion probe) =="
fetch "${APP_URL%/}/api/healthz/llm?probe=1"
if [[ "${FETCH_STATUS}" == "000" || -z "${FETCH_BODY}" ]]; then
  fail "unreachable"
else
  LOCAL_PROBE_OK="$(json_probe_ok "${FETCH_BODY}" local)"
  PROBE_ERROR="$(json_field "${FETCH_BODY}" probeError)"
  echo "  HTTP ${FETCH_STATUS}"
  [[ -n "${PROBE_ERROR}" ]] && echo "  probeError: ${PROBE_ERROR}"
  # Check the "local" probe specifically — the aggregate probeOk can be true
  # from a cloud provider while local (what custom mode actually uses) fails.
  [[ "${LOCAL_PROBE_OK}" == "true" ]] && pass "local probe ok=true" || fail "local probe ok=${LOCAL_PROBE_OK:-<missing>} — the app can't reach your model endpoint"
fi

if [[ -n "${TUNNEL_URL}" ]]; then
  echo
  echo "== ${TUNNEL_URL%/}/v1/models (direct check of your model host) =="
  fetch "${TUNNEL_URL%/}/v1/models"
  echo "  HTTP ${FETCH_STATUS}"
  if [[ "${FETCH_STATUS}" == "000" || -z "${FETCH_BODY}" || ! "${FETCH_STATUS}" =~ ^2[0-9]{2}$ ]]; then
    fail "unreachable or errored: ${FETCH_BODY:-<empty body>}"
  else
    pass "reachable: ${FETCH_BODY}"
  fi
fi

echo
if [[ "${FAILED}" -eq 0 ]]; then
  echo "All checks passed — production chat is on the self-hosted Anima LLM."
else
  echo "Some checks failed — see the 'Production note (Vercel)' section of docs/custom-llm.md." >&2
  exit 1
fi
