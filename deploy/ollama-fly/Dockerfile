# Always-on, publicly reachable Anima chat LLM for Vercel production.
#
# Bakes the CPU/laptop bootstrap model (Qwen2.5 3B, branded `anima-chat` —
# the same model scripts/llm/bootstrap-anima-llm.sh creates locally) into the
# image, and fronts Ollama with an authenticated Caddy reverse proxy so the
# public .fly.dev URL isn't a free-for-all inference endpoint.
#
# Deploy (from this directory) — see ./README.md for the full walkthrough:
#   fly launch --no-deploy
#   fly secrets set PROXY_AUTH_TOKEN=$(openssl rand -hex 32)
#   fly deploy

FROM caddy:2-alpine AS caddy
# Resolve the binary via PATH rather than hardcoding its location, so this
# doesn't silently break if a future caddy image layout changes.
RUN cp "$(command -v caddy)" /caddy-bin

FROM ollama/ollama:latest

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=caddy /caddy-bin /usr/local/bin/caddy
COPY Caddyfile /etc/caddy/Caddyfile
COPY Modelfile.anima-chat /tmp/Modelfile.anima-chat
COPY start.sh /usr/local/bin/start.sh
RUN chmod +x /usr/local/bin/start.sh

# Bake the model at build time so a Machine boots ready to serve — no
# persistent volume, no re-pull on restart, no cold-start pull. Ollama binds
# to loopback only; Caddy on :8080 is the sole externally reachable port.
RUN OLLAMA_HOST=127.0.0.1:11434 ollama serve & \
    server_pid=$! && \
    for i in $(seq 1 60); do \
      curl -sf http://127.0.0.1:11434/api/tags >/dev/null 2>&1 && break; \
      sleep 1; \
    done && \
    curl -sf http://127.0.0.1:11434/api/tags >/dev/null 2>&1 || (echo "ollama server did not start" >&2 && exit 1) && \
    ollama pull qwen2.5:3b && \
    ollama create anima-chat -f /tmp/Modelfile.anima-chat && \
    kill "$server_pid" && \
    wait "$server_pid" 2>/dev/null || true

EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/start.sh"]
