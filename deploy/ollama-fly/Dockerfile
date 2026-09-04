# Standalone Anima LLM service for Fly.io (Docker runtime).
#
# Serves the self-hosted, open-weight `anima-chat` model (Qwen2.5 3B) over an
# OpenAI-compatible API behind a Caddy bearer-token proxy on :8080.
# Point the api-server's ANIMA_LOCAL_LLM_BASE_URL at
# https://anima-chat-llm.fly.dev/v1 and set ANIMA_LOCAL_LLM_API_KEY to the
# same value as PROXY_AUTH_TOKEN.
#
# Same image/bootstrap conventions as scripts/llm/render/Dockerfile.
# Build from the repository root so COPY scripts/llm/Modelfile.anima-chat works:
#   fly deploy --config deploy/ollama-fly/fly.toml --dockerfile deploy/ollama-fly/Dockerfile
#
# Mount a Fly volume at /root/.ollama so the ~2 GB of pulled weights survive
# restarts/redeploys instead of re-downloading every time.

# Debian Caddy (glibc) — ollama/ollama is Ubuntu/glibc. Do not copy a
# musl binary from caddy:2-alpine; it will not exec on this image.
FROM caddy:2 AS caddy

FROM ollama/ollama:latest

ENV OLLAMA_HOST=0.0.0.0:11434
ENV ANIMA_BOOTSTRAP_BASE=qwen2.5:3b
ENV ANIMA_OLLAMA_CHAT_TAG=anima-chat

COPY --from=caddy /usr/bin/caddy /usr/local/bin/caddy
COPY scripts/llm/Modelfile.anima-chat /Modelfile.anima-chat
COPY deploy/ollama-fly/Caddyfile /Caddyfile
COPY deploy/ollama-fly/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Proxy listens here. Ollama stays on 11434 (not published).
EXPOSE 8080

ENTRYPOINT ["/entrypoint.sh"]
