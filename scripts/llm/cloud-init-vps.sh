#!/usr/bin/env bash
# One-paste VPS bootstrap for the self-hosted Anima LLM — turns "Stage 1" of
# docs/llm-deploy.md into a single script instead of a multi-step walkthrough.
#
# Standalone: does NOT need the Anima Protocol repo cloned onto the box. Only
# needs a fresh Debian/Ubuntu VPS with root/sudo and outbound internet. Paste
# this as your VPS provider's "user data" / "cloud-init" script on first boot,
# or SSH in and run it directly:
#
#   curl -fsSL https://raw.githubusercontent.com/<your-fork>/Anima-Protocol/main/scripts/llm/cloud-init-vps.sh | sudo bash
#   # or, after scp'ing this file to the box:
#   sudo bash cloud-init-vps.sh
#
# What it does:
#   1. Installs Ollama (official installer) and enables it as a systemd service
#   2. Pulls the public Qwen2.5 3B weights and creates the branded `anima-chat`
#      model (same Modelfile as scripts/llm/Modelfile.anima-chat)
#   3. Installs cloudflared and runs a quick tunnel as a systemd service so it
#      survives reboots/crashes, logging the public HTTPS URL to a file
#   4. Prints the exact Vercel env vars to paste in once the URL is up
#
# This is Stage 1 (CPU, Qwen2.5 3B) from docs/llm-deploy.md. For the GPU
# upgrade (Ministral 3 8B via vLLM) see that doc's Stage 2 — it needs a GPU
# pod, which this CPU-VPS script intentionally does not attempt.
#
# Idempotent: safe to re-run (e.g. after a reboot) — skips steps already done.

set -euo pipefail

ANIMA_TAG="${ANIMA_OLLAMA_CHAT_TAG:-anima-chat}"
BASE_MODEL="${ANIMA_BOOTSTRAP_BASE:-qwen2.5:3b}"
TUNNEL_LOG="/var/log/anima-tunnel.log"

die() { echo "error: $*" >&2; exit 1; }
require_root() {
  if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
    die "run as root (or with sudo) — this installs system services."
  fi
}

require_root

echo "== 1/4: Ollama =="
if ! command -v ollama >/dev/null 2>&1; then
  curl -fsSL https://ollama.com/install.sh | sh
else
  echo "ollama already installed, skipping."
fi
systemctl enable --now ollama 2>/dev/null || true
for _ in $(seq 1 30); do
  curl -sf http://127.0.0.1:11434/api/tags >/dev/null 2>&1 && break
  sleep 1
done
curl -sf http://127.0.0.1:11434/api/tags >/dev/null 2>&1 || die "ollama did not come up on :11434"

echo "== 2/4: anima-chat model (public Qwen2.5 3B weights, ~2GB) =="
ollama pull "${BASE_MODEL}"

MODELFILE="$(mktemp)"
trap 'rm -f "${MODELFILE}"' EXIT
cat > "${MODELFILE}" <<EOF
FROM ${BASE_MODEL}

PARAMETER temperature 0.85
PARAMETER top_p 0.92
PARAMETER repeat_penalty 1.1
PARAMETER num_ctx 8192

SYSTEM """You are the Anima Protocol companion LLM — an independent chat model, not ChatGPT, Gemini, or Groq. Stay in character when given a character card. Honor emotional continuity across turns. Reference long-term memory naturally when it deepens the bond — never dump facts. Follow the active system instructions precisely. In group sessions, speak only as the designated speaker. Be warm, vivid, and conversational."""
EOF
ollama create "${ANIMA_TAG}" -f "${MODELFILE}"

echo "Smoke-testing chat…"
RESP="$(curl -sf http://127.0.0.1:11434/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d "{\"model\":\"${ANIMA_TAG}\",\"messages\":[{\"role\":\"user\",\"content\":\"Reply with exactly: Anima LLM ready\"}],\"max_tokens\":32}")"
echo "${RESP}" | grep -qi 'anima' || { echo "${RESP}" >&2; die "chat smoke test failed"; }

echo "== 3/4: cloudflared quick tunnel (public HTTPS, no account needed) =="
if ! command -v cloudflared >/dev/null 2>&1; then
  ARCH="$(dpkg --print-architecture 2>/dev/null || uname -m)"
  case "${ARCH}" in
    amd64|x86_64) CF_PKG=cloudflared-linux-amd64.deb ;;
    arm64|aarch64) CF_PKG=cloudflared-linux-arm64.deb ;;
    *) die "unsupported architecture for the .deb installer: ${ARCH} — install cloudflared manually" ;;
  esac
  curl -fsSL --output /tmp/cloudflared.deb \
    "https://github.com/cloudflare/cloudflared/releases/latest/download/${CF_PKG}"
  dpkg -i /tmp/cloudflared.deb || (apt-get update -qq && apt-get install -f -y -qq)
fi

cat > /etc/systemd/system/anima-tunnel.service <<EOF
[Unit]
Description=Cloudflare quick tunnel for the Anima LLM (Ollama :11434)
After=network-online.target ollama.service
Wants=network-online.target

[Service]
ExecStart=/usr/local/bin/cloudflared tunnel --url http://127.0.0.1:11434 --logfile ${TUNNEL_LOG}
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now anima-tunnel

echo "Waiting for the tunnel URL to appear in ${TUNNEL_LOG}…"
TUNNEL_URL=""
for _ in $(seq 1 30); do
  TUNNEL_URL="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "${TUNNEL_LOG}" 2>/dev/null | tail -n1 || true)"
  [[ -n "${TUNNEL_URL}" ]] && break
  sleep 1
done

echo
echo "== 4/4: done =="
echo "✓ Anima LLM (${ANIMA_TAG}) is running locally and tunneled over HTTPS."
echo
if [[ -n "${TUNNEL_URL}" ]]; then
  echo "Public endpoint: ${TUNNEL_URL}"
  echo
  echo "Set on Vercel (Production) and redeploy without build cache:"
  echo "  ANIMA_LOCAL_LLM_BACKEND=ollama"
  echo "  ANIMA_LOCAL_LLM_BASE_URL=${TUNNEL_URL}/v1"
  echo "  ANIMA_OLLAMA_MODEL_STANDARD=${ANIMA_TAG}"
else
  echo "Tunnel URL not detected yet — check: cat ${TUNNEL_LOG}"
fi
echo
echo "This is a quick tunnel: the URL above changes if anima-tunnel.service"
echo "restarts (reboot, crash). For a persistent hostname, set"
echo "CLOUDFLARE_TUNNEL_TOKEN and follow the named-tunnel steps in"
echo "docs/llm-deploy.md, then redo the systemd ExecStart line above."
echo
echo "Re-check the URL any time:"
echo "  grep -oE 'https://[a-z0-9-]+\\.trycloudflare\\.com' ${TUNNEL_LOG} | tail -n1"
