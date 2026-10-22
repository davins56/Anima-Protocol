# Persistent memory architecture

Goal: Serenity, Linda, Aeland, Scarlet and user-created companions should never lose
identity or history across redeploys, schema pushes or client bugs.

## Layers (`supabase/migrations/`)
| Layer | Migration | Objects |
|---|---|---|
| 1. Identity core | `20261022160000_memory_identity_core.sql` | `character_identity_core` (versioned, immutable rows), view `character_identity_current`, fn `append_identity_version(...)`, trigger fn `anima_forbid_mutation()` |
| 2. Event stream | `20261022160100_memory_events.sql` | `memory_event_types` (lookup), `memory_events` (append-only), trigger `memory_events_guard()`, photo link trigger `generated_images_log_memory` → `image_generated` event |
| 3. Retrieval | `20261022160200_memory_retrieval.sql` | HNSW index on `memory_events.embedding` (`vector(768)`), `memory_recalls` (append-only), fns `recall_memories(...)`, `memory_health(...)`, `bootstrap_session_context(...)` |

### Immutability rules
* `character_identity_core`, `memory_events`, `memory_recalls`: BEFORE UPDATE/DELETE row triggers and
  BEFORE TRUNCATE statement triggers raise. They apply to **every** role, service role and owner included.
* The one allowed write on an existing row: `memory_events.embedding` going from NULL to a vector, with every
  other column unchanged (the embed backfill).
* Forgetting is an append: a `retraction` event with `payload.target_event_id`. `recall_memories` skips retracted events.
* Changing identity appends version N+1 (`append_identity_version`, serialised by an advisory lock). Each event
  records the `identity_version` that was current.
* Event types are rows in `memory_event_types`, not an ENUM. New types are an `INSERT ... ON CONFLICT DO NOTHING`.
  drizzle-kit drops unknown enums and sequences, which is why recall ids are uuid and no `bigserial` is used.

### RLS
The app authenticates with **Clerk**. The api-server reaches Postgres through `DATABASE_URL`/Hyperdrive as the
table owner, so RLS does not apply to it; the triggers do. For the Supabase PostgREST surface, RLS is enabled with:
`authenticated` gets SELECT (and INSERT on `memory_events`) on rows where `user_id = auth.jwt()->>'sub'`. That
needs Supabase third-party auth with Clerk. `anon` gets nothing, and UPDATE/DELETE/TRUNCATE are revoked.
No UPDATE or DELETE policies exist. The frontend has no live Supabase client: `src/lib/memory.ts` is dead code,
excluded from tsconfig and imported nowhere. All reads go through `/api/memory-core/*`.

## Retrieval score
`score = 0.6·cosine_similarity + 0.25·exp(-ln2·age/half_life[30d]) + 0.15·emotional_weight`.
Candidates come from the HNSW index (8× limit), then get re-ranked. When there's no query embedding, similarity
defaults to 0.35, so recency and weight decide. Every returned memory is logged to `memory_recalls` with its age.
That is what the chat header's "recalled a 7-month-old memory" indicator reads.

## Embeddings (768-d)
`artifacts/api-server/src/lib/memoryCore/embedder.ts`. Providers, in order:
1. **local**: the self-hosted Ollama/vLLM host `/v1/embeddings` with `nomic-embed-text` (`ANIMA_MEMORY_EMBED_MODEL`).
2. **workersai**: the Cloudflare `AI` binding `@cf/baai/bge-base-en-v1.5`.

Memory text is never sent to a third-party API, which matches the fail-closed chat policy. If neither provider
is reachable, events are stored without an embedding. The hourly Worker cron (`worker.ts` → `scheduled`) backfills them.
Switch: `ANIMA_MEMORY_EMBED_PROVIDER=auto|local|workersai|off`.

## Server integration (Cloudflare Worker / Express; the repo has no Supabase Edge Functions)
* `lib/memoryCore/memoryCore.ts`: append events, recall, identity versions, health, retractions, backfill.
* `lib/memoryCore/sessionContext.ts`: `buildMemoryCoreContext` snapshots identity v1 from the character record the
  first time it's needed, then recalls memories for the turn. It runs in parallel with the other context loads in
  `routes/chat.ts` (`optionalChatContext`, 1.5 s ceiling) and is injected as `memoryCoreContext` into
  `composeCompanionChatMessages`, where it joins the memory section.
* `routes/chat.ts` post-persist: appends one `turn` event per committed turn (`dedupe_key = turn:<turnId>`).
* `routes/memoryCore.ts`: `GET /api/memory-core/:id/health`, `POST .../bootstrap|events|identity|retract`.
  There is deliberately no DELETE or PUT.
* Kill switch: `ANIMA_MEMORY_CORE=off`.

## Deploy safety (audit, 2026-10-22)
| Finding | Action |
|---|---|
| `scripts/post-merge.sh` (Replit postMerge) runs `drizzle-kit push` against the real `DATABASE_URL` on every merge. With SQL-owned tables that aren't in the Drizzle schema, push tries to drop them. With `--force` it would actually drop them | `lib/db/drizzle.config.ts` `tablesFilter` excludes `lib/db/protected-tables.ts`. Verified locally: `push` and `push --force` both leave the memory tables intact |
| `lib/db` `push-force` (`--force` auto-accepts data loss) | Now runs `scripts/guard-force-push.mjs` first, which refuses any non-local host unless `ALLOW_FORCE_PUSH=1` |
| CI `api-tests` runs `db push` | Only against the disposable Postgres service. OK |
| `supabase db reset`, TRUNCATE or DROP in workflows/scripts | None found |
| Legacy `memory_embeddings`/`chat_messages` deletes in `discardReplacedReply.ts`, `memoryPolicy.ts`, `companionMemoryReview.ts` | Intentional rewind/review behaviour on the legacy layer. Left as is. The new layer is append-only and unaffected |
| `.env.example` contains a real-looking `CLERK_SECRET_KEY=sk_live_…` | **Rotate it in Clerk and replace it with a placeholder** (see report) |

`scripts/ci/check-migration-safety.mjs` (`pnpm run check:migrations`, added to the CI `lint` job) fails when:
* any migration has DROP TABLE, TRUNCATE, DELETE FROM, ALTER … DROP, or DISABLE TRIGGER/RLS on a protected table;
* an existing `supabase/migrations` file is modified or deleted (append-only, compared with the base ref);
* scripts or workflows run `supabase db reset`, `drizzle-kit drop`, or push `--force`;
* the drizzle `tablesFilter` or the force-push guard is removed.

## Applying
Supabase CLI: `supabase db push` (applies new files in order; never `db reset` on a real project).
Without the CLI: `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/<file>.sql` in timestamp order.
Each file is idempotent.

GDPR erasure of a user (the only legitimate delete) takes a superuser session:
`ALTER TABLE ... DISABLE TRIGGER ...` inside a reviewed one-off transaction. It is deliberately not scripted.
