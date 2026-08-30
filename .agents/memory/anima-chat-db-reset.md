---
name: Chat start Database connection reset
description: Stale pg Pool sockets on Workers cause 503 "Database connection reset" when starting a chat.
---

# Chat init fails with "Database connection reset"

**Symptom:** New session / first message returns 503 `Database connection reset`
and the chat never opens. Other pages may still look fine.

**Why:** Cloudflare Workers (and Vercel Fluid) reuse a process-level `pg.Pool`
(`max: 1`). Origin poolers (Supavisor, Neon, Hyperdrive, PgBouncer) close idle
TCP; the next `ChatSession.create` / `ensureSchemaOnce` reuses the dead client
and node-postgres throws `ECONNRESET` / "Connection terminated unexpectedly".
`classifyDbError` maps that to the user-visible reset message. There used to be
no retry and no pool recycle.

**Fix:**
- `lib/db/src/client.ts` — `isTransientDbError`, `resetPool`,
  `withTransientDbRetry`; recreate the pool when `DATABASE_URL` / Hyperdrive
  changes; `pool.on("error")` *detaches* (does not `end()`) so in-flight
  queries are not raced into "Cannot use a pool after calling end"; shorter
  idle timeout (2s) + `maxLifetimeSeconds`.
- Store/chat/health wrap first-touch queries in `withTransientDbRetry`.
- Client `storeFetch` retries once on 503 `reason: reset`.

**Do not** retry auth or missing-schema errors. Do not retry the entire
`POST /api/chat/messages` handler (that would duplicate LLM work) — only the
DB reads/writes around it.
