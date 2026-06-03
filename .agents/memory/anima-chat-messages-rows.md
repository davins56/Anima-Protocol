---
name: Anima chat messages as rows
description: ChatSession.messages blob -> ChatMessage rows; lazy migration, shared backfill, advisory locking.
---

Messages are ChatMessage rows w/ per-session seq; pg_advisory_xact_lock in the migration serializes migrate+append; edit/delete via replace shim.

## Shared migration source of truth
The chat-message storage model (entity names CHAT_MESSAGE/CHAT_SESSION, the `data ->> 'session_id'` predicate, id/object helpers, and the lazy blob->rows migration) lives in `@workspace/db` (`lib/db/src/chat-messages.ts`), NOT in the api-server route file. `artifacts/api-server/src/routes/store.ts` imports `migrateSessionMessages`, `makeId`, `asObject`, `sessionIdEq`, `CHAT_MESSAGE`, `CHAT_SESSION`, `MsgData` from there and calls `migrateSessionMessages(tx, userId, sessionId)` on first access (messages read/append/counts/by-sessions).

**Why:** the one-time backfill must apply byte-identical migration semantics to every user's data; duplicating the logic risked drift. Lazy on-read migration alone never touched users who never reopened old chats, so metadata-only lists kept shipping the full blob.

**How to apply:** any change to migration behavior goes in `lib/db/src/chat-messages.ts` so both the routes and the backfill stay in lockstep. `lib/db/src/client.ts` holds `db`/`pool` (split out to break a circular import); `index.ts` re-exports schema/client/chat-messages.

## Backfill
`backfillChatMessages(db, {batchSize})` does an id-cursor batched scan over not-migrated ChatSession rows, running `migrateSessionMessages` per session in its own transaction. Idempotent (messages_migrated flag short-circuits). Runner: `scripts/src/backfill-chat-messages.ts` (`pnpm --filter @workspace/scripts run backfill:messages`), wired into `scripts/post-merge.sh` after `pnpm --filter db push`. Post-merge timeout raised to 180000ms via setPostMergeConfig.

**Note:** counts are DERIVED via `POST /messages/counts` (no stored `message_count` snapshot). Any task premise about backfilling a count snapshot is stale — counts are correct post-migration via the derive path.
