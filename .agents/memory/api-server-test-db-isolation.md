---
name: api-server test DB isolation
description: How api-server vitest tests avoid touching the dev `public` schema (disposable per-run schema via search_path).
---

api-server integration tests run the REAL store router against the REAL Postgres,
but isolated in a disposable per-run schema so they never write to the developer's
working data in `public`.

**How:** a Vitest `setupFiles` entry (`test/setup-db.ts`) runs before the test
file imports `@workspace/db`. It creates `test_run_<ts>_<rand>`, clones the live
tables with `CREATE TABLE ... (LIKE public.x INCLUDING ALL)`, then sets
`process.env.PGOPTIONS="-c search_path=<schema>"`. The shared pool in
`lib/db/src/index.ts` is constructed with only `connectionString`, so it picks up
`PGOPTIONS` at construction → all unqualified queries land in the test schema.
`afterAll` drops the schema CASCADE.

**Why these specifics (don't "simplify" away):**
- `PGOPTIONS` must be set in the setup file (per-worker), NOT `globalSetup` — env
  set in globalSetup doesn't propagate to vitest workers. Relies on
  `fileParallelism:false` + single test file = single worker.
- pg reads `PGOPTIONS` at Pool/Client construction (verified empirically), so
  ordering only requires setupFiles to finish before the `@workspace/db` import.
- search_path is the test schema ONLY (no `,public` fallback) so a missing table
  errors loudly instead of silently writing to public.
- `LIKE ... INCLUDING ALL` keeps the test schema auto-in-sync with schema changes
  (columns/indexes/constraints) — no duplicated DDL. But it copies the serial id
  default verbatim (still points at public's sequence), so we re-point
  `user_entities.id` to a schema-local sequence — otherwise inserts advance
  public's sequence.
- admin Client for create/drop is pinned to `-c search_path=public` so it's
  unaffected by the test search_path.
- `pg` + `@types/pg` are direct devDeps of api-server (the setup file imports pg).
