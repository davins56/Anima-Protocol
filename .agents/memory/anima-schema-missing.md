---
name: Database schema missing or out of date blocks chat Init
description: Connectivity OK via /api/healthz/db but store returns schema-missing; ensure schema via POST /api/healthz/schema or store self-heal
---

# "Database schema is missing or out of date"

**Symptom:** Assemble Group / Characters show yellow
`Database schema is missing or out of date`. Bundled starters may still appear
(PR #75 fallback) but **Init** cannot create a `ChatSession`.

**Probe:**
```bash
curl -sS https://www.anima-protocol.com/api/healthz/db
curl -sS https://www.anima-protocol.com/api/healthz/schema
```
- `db: true` + `schema.ok: false` + `missingTables: [...]` → blank/partial Supabase
- `db: false` → connectivity (see anima-store-db-500.md)

**Fix (prefer in this order):**
1. `POST /api/healthz/schema` — public idempotent `CREATE IF NOT EXISTS` for all
   required tables (also runs automatically on first authenticated `/api/store/*`)
2. Or `pnpm --filter @workspace/db run push` against production `DATABASE_URL`
3. Or `POST /api/admin/ensure-schema` with `ADMIN_MIGRATION_SECRET`

**Code:** `lib/db/src/ensure-schema.ts`, store middleware in
`artifacts/api-server/src/routes/store.ts`, probes in `routes/health.ts`.
