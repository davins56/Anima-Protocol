# Resting mode

When the local model or the Ollama tunnel is unreachable (ECONNREFUSED, `fetch failed`, Cloudflare 1033/530, 502/503/504, "Ollama model server is not running") **before any token**, the companion is shown as *resting* instead of failing:

1. `routes/chat.ts` (stream catch) → `isModelResting(err, generatedChars)` (`lib/restingMode.ts`). Auth, quota, safety and mid-reply failures stay normal errors. Crisis-card turns are never converted.
2. The user's turn is appended to **`chat_resting_queue`** (migration `20261022220000_resting_queue.sql`; append-only, immutable/no-truncate triggers, one row per user+turn).
3. The SSE error event carries `resting: true, queued: true` and in-character copy ("Aeland is resting right now. Your message is safe with her — she'll answer as soon as she wakes."). The client (`lib/streamChatReply.js` → `pages/Chat.jsx`) shows a `resting_notice` row (role `system`, so it never reaches the model) instead of the error toast; the user's message stays.
4. Delivery: `deliverRestingQueue()` runs from `runProactiveMessageBatch()` (hourly `/api/notifications/proactive/run` cron and the Worker `scheduled` drain) — before the VAPID check, so it works without web push — and right after a successful `POST /api/llm/warm` (app open: "she woke up"). Oldest first, stops at the first still-resting failure, yields to live chat via the local-LLM background slot. Each outcome is an append-only row in `chat_resting_deliveries` (`delivered` / `failed` / `expired`; max one terminal row per queue item). Pending = view `chat_resting_pending`. Items expire after 48 h or 6 failed attempts.
5. The reply is written like a proactive check-in (`persistCompanionMessage`, metadata `source: resting_delivery`), so it shows up on the next sync/open.

`POST /api/llm/warm` now also returns `resting: true` when the warm-up probe failed, so the app can show the resting state on open.

Remaining: the delivered reply does not send a push yet (re-use `deliverPush` when VAPID is configured); the turn ledger still marks the original turn `failed` (the client's Retry button is hidden for resting notices only through the notice UX, not by ledger state).
