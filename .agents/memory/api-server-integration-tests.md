---
name: api-server integration tests
description: How to integration-test the /api/store router against the real Postgres without a live Clerk session
---

# Testing the store router (per-account isolation, import gate, upsert)

The `/api/store` router derives the user id from `getAuth(req)` (Clerk). To
integration-test the REAL router + REAL Postgres without a live Clerk session,
`vi.mock("@clerk/express", ...)` so `getAuth` reads the user id from a test-only
header (`x-test-user`). Everything else (the drizzle queries in store.ts) stays
unmocked — that's the whole point: it verifies isolation/import-gate/upsert logic
against an actual DB.

**Why a real DB instead of a mocked drizzle:** faithfully faking
`select().from().where().limit()` + `insert().onConflictDoUpdate()` +
`delete().where()` would re-implement store.ts's logic, weakening the test. The
repl's `DATABASE_URL` (dev Postgres) is available in tests, so use it.

**How to apply:**
- Mount the router on a bare `express()` (skip app.ts — it needs Clerk keys),
  `app.listen(0)`, hit it with global `fetch`. No supertest dependency needed.
- Give every test user a unique-per-run prefix (`itest_<ts>_<rand>_`). Clean up
  in `afterAll` with `db.delete(...).where(like(userId, prefix + '%'))` on BOTH
  `userEntities` and `userProfiles`. This keeps the dev DB clean and lets
  concurrent runs coexist.
- Keep `fileParallelism: false` in vitest.config so DB cleanup can't race.
- vitest is a devDependency of api-server; `test` script runs
  `vitest run --config vitest.config.ts`. The `test` validation runs both
  anima-protocol and api-server (`pnpm --filter A --filter B run test`).

**Layering note:** server tests cover what the SERVER guarantees (per-account
isolation, import-only-when-empty gate, upsert idempotency under concurrency).
Client-only guarantees (the global one-time MIGRATION_KEY that prevents
re-importing the browser's local data into a *second* account, and the
StrictMode seed/bootstrap promise locks) are tested in anima-protocol vitest
(`syncBootstrap.test.js`, `seedCharacters.test.js`) — they don't exist on the
server and can't be tested there.
