# Recall ledger ("Why she said that")

Read-only view of which long-term memories a companion's recall step surfaced,
with the numbers that ranked them. Backend: `artifacts/api-server/src/lib/memoryCore/recallLedger.ts`
(re-exported from `memoryCore.ts`), route in `artifacts/api-server/src/routes/memoryCore.ts`.
Client: `artifacts/anima-protocol/src/hooks/useRecallLedger.ts` (zod schema, `fetchRecallLedger`, `useRecallLedger`).

## What the stored data can prove

Source table: `memory_recalls` (`supabase/migrations/20261022160200_memory_retrieval.sql:8-19`), append-only
(UPDATE/DELETE/TRUNCATE triggers `:26-33`). It is not in the Drizzle schema (`lib/db`); it is listed in
`lib/db/protected-tables.ts:12`.

| Column | Meaning |
| --- | --- |
| `event_id` | the recalled `memory_events` row |
| `user_id`, `character_id` | whose recall it was |
| `session_id` | the session id the caller passed to `recall_memories` |
| `score` | blended rank: `w_sim*COALESCE(similarity,0.35) + w_rec*recency + w_emo*emotional_weight`, times `(1 - 0.6*corruption severity)` (`20261022280000_continuity.sql:149-153`) |
| `similarity` | cosine similarity to the turn's query embedding; `NULL` when either embedding was missing |
| `recency` | decay term, floored at 0.12 (v3) |
| `event_age_s` | age of the memory when recalled |
| `recalled_at` | `DEFAULT now()` (transaction start) |

Rows are written only by SQL `recall_memories(...)` (`20261022280000_continuity.sql:156-163`, the `logged` CTE),
called via `recallMemories()` (`memoryCore.ts:165-187`) from:

- chat, legacy path: `buildMemoryCoreContext` (`lib/memoryCore/sessionContext.ts:72-78`, limit 8) from `routes/chat.ts:2867-2879`;
- chat, chat-mind path: `buildMindKnowledge` (`lib/mind/mindContext.ts:75-84`, limit `recallLimit`) from `routes/chat.ts:2847-2865`;
- voice session opening: `lib/voice/sessionConfig.ts:84-90` (`session_id` defaults to `voice-<characterId>`);
- client bootstrap: `POST /api/memory-core/:id/bootstrap` (`routes/memoryCore.ts`).

Known limits, from the code (nothing here is inferred beyond it):

1. **No turn or message id.** `memory_recalls` has no `turn_id`/`message_id` column, so a recall can't be tied to the
   reply it shaped. The ledger groups rows by `(session_id, recalled_at)`: one `recall_memories` call is one
   INSERT statement, so its rows share `recalled_at`. A batch is one recall call, not a proven turn. `turn_id` is
   always `null` and `meta.turn_linkage` is `"none"`.
2. **No source.** Chat, voice and bootstrap recalls look the same (only `session_id` hints at voice).
3. **Candidate, not proof of use.** The prompt builders can drop recalled memories (`sessionContext.ts:46` char budget,
   `mindContext.ts:87-94` re-rank and token pack), and both callers race a timeout (`sessionContext.ts:53-58`,
   `MIND_CONTEXT_TIMEOUT_MS` 900 ms) without cancelling the query, so a row can exist for a recall the prompt never used.
4. **Recalled for the hinted character.** Chat recalls run for `hintedCharId` (`routes/chat.ts:2811`) before the
   speaker is resolved. On `main` the recall can be logged under A for a turn B ended up speaking (the open
   speaker-context gap). The rows are still A's own memories, so nothing crosses characters in this ledger,
   but such a batch doesn't mean A spoke.
5. **Weights are not stored.** `emotional_weight` comes from the recalled `memory_events` row (immutable, so it equals
   the value at recall time). The similarity/recency/emotion weights in force at the time (env `ANIMA_RECALL_*`) are
   not stored and are not returned.

Smallest migration that would close 1–3 (not applied; needs its own approval):

```sql
ALTER TABLE public.memory_recalls ADD COLUMN IF NOT EXISTS turn_id text;      -- chat turn id (chat_turns.id) when known
ALTER TABLE public.memory_recalls ADD COLUMN IF NOT EXISTS source  text;      -- 'chat' | 'chat_mind' | 'voice' | 'bootstrap'
CREATE INDEX IF NOT EXISTS memory_recalls_turn_idx
  ON public.memory_recalls (user_id, character_id, turn_id) WHERE turn_id IS NOT NULL;
-- recall_memories gains trailing `p_turn_id text DEFAULT NULL, p_source text DEFAULT NULL` and writes them in `logged`.
-- Changing the argument list means DROP FUNCTION of the old signature and CREATE of the new one in the same migration.
```

Then `recallMemories()` takes `turnId`/`source`, and chat passes its `turnId` (an edit to `routes/chat.ts`).
"Reached the prompt" (limit 3) would need one more column, e.g. `used boolean`, which can't be set by
the current INSERT-at-recall design without an extra write after the prompt is packed.

## Route

`GET /api/memory-core/:characterId/recalls`

Auth: Clerk session (same as the other memory-core routes). Rate limit: the router's shared `rateLimit`.
Response header: `Cache-Control: no-store` on every status.

| Query | Type | Default | Notes |
| --- | --- | --- | --- |
| `limit` | int | 10 | batches per page; clamped to 1..25; non-numeric → 10 |
| `cursor` | string | none | `next_cursor` from the previous page (opaque) |
| `session_id` | string | none | only batches from this session; 1..200 chars |

Isolation rules the implementation follows:

- Owner check first: the id must be the caller's `user_entities` row with `entity_name` `Character` or `Anima`.
  Otherwise **404**, with the same body as a nonexistent id. This runs before cursor or limit parsing.
- Every query filters `user_id` and `character_id`: on `memory_recalls`, on the joined `memory_events`
  (`e.user_id = $user AND e.character_id = $char`), and on `memory_corruption_active`.
- A recall row whose event is missing, belongs to another user or character, or is a bookkeeping type is **never
  shown**. It's only counted in `withheld.unattributable`.
- A memory with a same-user retraction is never shown, only counted in `withheld.retracted`.
- A currently corrupted memory is shown only as the obscured fragment the prompt uses (`obscuredMemory`).
- Legacy `companion_memories` facts (F-01, not speaker-attributed) and `memory_embeddings` are never read.
- Read-only: no `recallMemories`, `ensureIdentitySnapshot`, `sessionStart`, embedding, or INSERT/UPDATE.
- Not returned: embeddings, payloads, dedupe keys, prompts, model output. `content_preview` is capped at 280 chars.

Order: batches newest first (`recalled_at DESC, session_id DESC`). Within a batch: `score DESC`. `rank` is the
position among the shown rows. At most 50 rows per batch, which is the `recall_memories` cap.

### Response 200

```json
{
  "character_id": "char_aeland_01",
  "batches": [
    {
      "batch_id": "eyJ2IjoxLCJ0IjoiMjAyNi0xMS0xMFQyMjoxNDowMy4xMjM0NTZaIiwicyI6InNlc3NfOWYyIn0",
      "recalled_at": "2026-11-10T22:14:03.123456Z",
      "session_id": "sess_9f2",
      "turn_id": null,
      "recalls": [
        {
          "recall_id": "6c1e4c2a-6f0e-4f53-9d3f-0b8f0c1d2e3f",
          "rank": 1,
          "score": 0.7132,
          "similarity": 0.8211,
          "recency": 0.12,
          "emotional_weight": 0.9,
          "memory_age_s": 19353600,
          "memory": {
            "event_id": "0d4b1a7e-2c4f-4b8e-9a51-3f7e2d9c8b10",
            "event_type": "turn",
            "content_preview": "User: I finally called my dad back.\nMe: I'm proud of you. You said it felt like carrying a stone.",
            "occurred_at": "2026-04-01T10:00:00.000000Z",
            "conversation_id": "sess_41a",
            "source_turn_id": "turn_41a_0007",
            "corrupted": false
          }
        }
      ],
      "withheld": { "retracted": 1, "unattributable": 0 }
    }
  ],
  "next_cursor": "eyJ2IjoxLCJ0IjoiMjAyNi0xMS0xMFQyMjoxNDowMy4xMjM0NTZaIiwicyI6InNlc3NfOWYyIn0",
  "meta": { "limit": 10, "max_limit": 25, "turn_linkage": "none", "grouping": "session_id+recalled_at" }
}
```

(This example is parsed verbatim by `useRecallLedger.test.ts`.)

Field notes:

- `recalled_at`, `occurred_at`: UTC with microseconds. The cursor relies on that precision.
- `similarity`: `null` when no query or memory embedding existed. The score then used 0.35 in its place.
- `memory.source_turn_id`: for `turn` memories, the chat turn the memory was **created from**
  (`payload.turn_id`, `routes/chat.ts:4271-4281`). It's not the turn the recall served.
- `memory.conversation_id`: the session the memory was created in.
- `turn_id`: always `null` until the migration above exists.
- `batch_id`: an opaque key for the batch. It's also a valid cursor for "batches older than this one".

### Errors

| Status | Body | When |
| --- | --- | --- |
| 401 | `{"error":"Unauthorized"}` | no Clerk user |
| 404 | `{"error":"Companion not found","code":"companion_not_found"}` | id not owned by caller, nonexistent, empty, or >120 chars |
| 400 | `{"error":"Invalid cursor","code":"invalid_cursor"}` | cursor not produced by this API |
| 400 | `{"error":"session_id must be a non-empty string (max 200 chars)","code":"invalid_session_id"}` | bad `session_id` |
| 503 | `{"error":"Memory core is not migrated yet.","code":"memory_schema_missing"}` | memory tables or view missing |
| 500 | `{"error":"Recall ledger request failed.","code":"server_error"}` | anything else (no DB detail is echoed) |

## Not changed

`GET /api/memory-core/:id/health` keeps its behavior (`private, max-age=30`, no ownership check, and SQL
`memory_health` joins `memory_events` on `id` only for `oldest_recent_recall`,
`20261022200000_immersive_sim.sql:244-251`). Tightening it needs a separate, approved change, and the SQL part
needs a migration.
