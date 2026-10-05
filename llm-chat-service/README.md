# LLM Chat Service

Small OpenAI-compatible gateway for the self-hosted Anima model. It streams tokens as SSE, bounds conversation context, aborts stalled upstream requests, and exposes feedback and latency metrics.

## Run

```bash
cp .env.example .env
pnpm install
pnpm run typecheck
pnpm run dev
```

The default upstream is Ollama at `http://127.0.0.1:11434/v1` with model `anima-chat`.

## API

- `POST /api/chat` accepts `{ "conversation_id?": string, "message": string, "system_prompt?": string }` and returns SSE chunks.
- `GET /api/history?conversation_id=...` returns the bounded in-memory context.
- `POST /api/feedback` accepts `{ "conversation_id": string, "rating": "up" | "down", "comment?": string }`.
- `GET /healthz` reports service availability.
- `GET /metrics` reports request count and average upstream-open latency.

Set `CHAT_API_KEY` and send `Authorization: Bearer ...` outside local development. Conversation state is intentionally in-memory; use the existing Postgres store when durable history is required.
