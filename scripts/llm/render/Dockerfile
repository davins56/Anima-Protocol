# Standalone Anima LLM service for Render (Docker runtime).
#
# Serves the self-hosted, open-weight `anima-chat` model (Qwen2.5 3B) over an
# OpenAI-compatible API on :11434 — no ChatGPT/Gemini/Groq involved. Point the
# api-server's ANIMA_LOCAL_LLM_BASE_URL at this service's Render URL + "/v1".
#
# Mount a persistent disk at /root/.ollama (Render → Advanced → Add Disk) so
# the ~2 GB of pulled weights survive restarts/redeploys instead of
# re-downloading every time.

FROM ollama/ollama:latest

ENV OLLAMA_HOST=0.0.0.0:11434
ENV ANIMA_BOOTSTRAP_BASE=qwen2.5:3b
ENV ANIMA_OLLAMA_CHAT_TAG=anima-chat

COPY scripts/llm/Modelfile.anima-chat /Modelfile.anima-chat
COPY scripts/llm/render/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 11434

ENTRYPOINT ["/entrypoint.sh"]
