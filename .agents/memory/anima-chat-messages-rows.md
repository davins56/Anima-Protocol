---
name: Anima chat messages as rows
description: Chat messages are individual ChatMessage rows (not a JSONB blob); how append/migrate/seq stays correct and why edit/delete go through a replace shim.
---

# Chat messages stored as ChatMessage rows

Chat messages live as their own `user_entities` rows (entityName `ChatMessage`), one per
message, keyed by `data.session_id` and ordered by a per-session integer `data.seq`.
They used to be one big JSONB `messages` array on each ChatSession, so every append
rewrote the whole history.

## Append / seq correctness (the non-obvious part)
- `seq` is assigned server-side as `max(seq)+1` inside a transaction. That read-modify-write
  is NOT atomic on its own.
- **Per-session serialization is enforced by `pg_advisory_xact_lock(hashtext(userId), hashtext(sessionId))`** taken at the TOP of `ensureSessionMigrated`. Because append/replace/by-sessions/GET all call `ensureSessionMigrated` first inside their transaction, that one lock serializes BOTH migration and seq assignment per session.
- **Why a lock, not a unique index on seq:** a unique constraint would surface concurrent
  appends (multi-tab / cross-device sync) as client-visible insert failures requiring retry
  logic. The advisory lock just orders them; no failure, no retry. One pair locked per tx → no
  deadlock; auto-released at tx end.

## Migration
- Lazy + transparent: first time a session's messages are touched, the blob is split into
  rows (seq = array index), then the session blob is cleared to `[]` and `messages_migrated:true`
  is set, in the same transaction. Idempotent via the flag + an existing-rows guard, and now
  also race-safe via the advisory lock.

## Edit / delete / rewind — kept on a REPLACE shim (deliberate drift)
- The original plan called for per-row PUT/DELETE/delete-from endpoints + converting the
  handlers. Instead those handlers were left UNCHANGED: they still call
  `ChatSession.update({messages})`, which the client routes to `POST /messages/replace`.
- `replace` diff-reconciles by message id: an edit updates ONE row, a rewind/delete removes
  only the trimmed tail, seq is reassigned by array position. Undo restores by id.
- **Why:** the task's perf criterion is about APPEND (now O(1)); replace makes edit/delete
  efficient enough while not touching working handlers (risk reduction). Hydrated messages
  carry id+seq so the diff is cheap.

## Client shape (base44Client.js)
- `base44.messages` = {list, append, replace, bySessions}. Append is the hot path.
- ChatSession store is wrapped: `get()`/`list()` HYDRATE `.messages` from rows by default;
  pass `{ withMessages: false }` to `list`/`filter` for metadata-only lists (sidebars) to avoid
  fetching every session's full history. `update({messages})` → replace shim + persists the
  remaining metadata via a separate session update.

## Per-session message counts (for metadata-only totals)
- Counts are **DERIVED**, never stored. `POST /messages/counts { ids }` (client:
  `base44.messages.counts` → `messageCountsBySessions`) first runs
  `ensureSessionMigrated` per id (same as `/messages/by-sessions`) so a legacy-blob
  session is split into rows, then returns one `count(*)::int` GROUP BY over ChatMessage
  rows (inArray on ids, scoped to userId + entity 'ChatMessage'), index-accelerated by
  `user_entities_session_seq_idx`. So it DOES migrate as a side effect — a previously
  unmigrated session is `messages_migrated:true` afterwards and reports an accurate count.
- **Why derived, not a stored snapshot:** a stored `data.message_count` was tried and
  rejected in review. (1) Already-migrated sessions (`messages_migrated:true`,
  `messages:[]`, no counter) would read as 0 because the `withMessages:false` list path
  never triggers backfill. (2) Maintaining it on append added a per-append session
  UPDATE, regressing the documented O(1) single-row append hot path. Deriving avoids
  both: append stays a pure insert, and old data is always correct.
- A side-effect-free variant of this endpoint (count rows only, no migrate; client uses
  blob length for unmigrated) was implemented in parallel but dropped at rebase in favor
  of the migrating endpoint above, which the Y/n Stories Library already depends on. Do
  not reintroduce a non-migrating `/messages/counts` without updating both call sites.
- **Client (`sessionMessageCount(session, counts)` in anima `lib/utils.js`):** prefers a
  non-empty legacy `messages` blob length, else the server-counted `counts[id]` (0 if
  absent). Harmless given the migrating endpoint (post-migration the blob is empty so it
  uses `counts[id]`); the fallback just keeps totals correct for both old and new data.
  Lore Archives lists sessions `{ withMessages:false }`, fetches counts once, and crystal
  generation hydrates message bodies on demand only for eligible sessions.

## Known accepted limitation
- A single chat turn appends multiple rows one-by-one (user msg, then AI reply); a mid-loop
  failure can leave a partial turn persisted. The pre-existing single-array write was also
  not transactional end-to-end, so this is accepted (no batch-append endpoint built).
