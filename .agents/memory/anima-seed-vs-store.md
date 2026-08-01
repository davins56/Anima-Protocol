---
name: seedCharacters.js is not the live Character Library source
description: Package-root seedCharacters.js was a Supabase CLI; the UI loads src/lib/seedCharacters.js via Postgres /api/store
---

# Why Characters shows "Database unavailable" despite seedCharacters.js

**Symptom:** Character Library shows `Database unavailable` / `0 ENTITIES INDEXED`
even though `artifacts/anima-protocol/seedCharacters.js` has a full roster.

**Why:** Two different seed files existed:

1. **Package root** `seedCharacters.js` — old Node CLI that upserted into a
   **Supabase** `characters` table. The React app never reads that table.
2. **Live** `src/lib/seedCharacters.js` — `getStarterRoster()` upserted through
   `/api/store/Character` into **Postgres** (`DATABASE_URL` / `user_entities`).

The Characters page lists `/api/store`, not the seed file and not Supabase.

**Probe:** `GET /api/healthz/db`. Production returning
`{"error":"Database host unreachable","code":"ENOTFOUND"}` means Vercel
`DATABASE_URL` points at a host DNS cannot resolve (suspended Replit DB, stale
Supabase pooler URL, etc.). Fix the env var and redeploy — no amount of editing
the seed file will populate the UI while the store is down.

**Fallback:** Characters page shows the bundled `getStarterRoster()` when the
store returns a DB/503 error, with an offline banner. Edits still cannot persist
until Postgres is reachable.

**Edit starters in:** `artifacts/anima-protocol/src/lib/seedCharacters.js`
**CLI check:** `pnpm --filter @workspace/anima-protocol run seed:characters`
