# Intimacy / Pulse engine

Adult companion layer for Anima Protocol.

Branch `feat/intimacy-engine` starts the merge. Full patched `chat.ts`, `promptBuilder.ts`, and `Chat.jsx` plus UI dock/editor live in the drop-in pack produced with this change set.

## Runtime

- `GET /api/intimacy/:characterId`
- `PATCH /api/intimacy/:characterId`
- `GET /api/intimacy/:characterId/scene/:conversationId`

Profiles persist as `user_entities` (`IntimacyProfile`, `IntimacyScene`) so production does not wait on drizzle push. Optional tables: `lib/db/drizzle/0003_intimacy_engine.sql`.

## Turn law

`closed → tension → contact → peak → aftercare`

Safeword / hard limit → aftercare, heat 15. Therapy mode disables the engine. Adult flag (`settings.adult_content_enabled`) must be on.

## Copy remaining files from the drop-in pack

`artifacts/api-server/src/lib/intimacy*.ts`
`artifacts/api-server/src/lib/memoryTagging.ts`
`artifacts/anima-protocol/src/components/intimacy/*`
`artifacts/anima-protocol/src/lib/intimacyClient.js`
patched `chat.ts` / `promptBuilder.ts` / `Chat.jsx`
standalone `artifacts/pulse-companion/`
