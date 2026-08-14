---
name: Helium DB credential recovery after override
description: How to recover when DATABASE_URL/PG* get overwritten (e.g. by a Supabase migration) and auth fails.
---

# Recovering a managed (Helium) Postgres after credentials were overwritten

**Symptom:** App can't read/seed; `password authentication failed` against either a
foreign host (Supabase pooler) or the managed host `helium`. `createDatabase()`
returns `alreadyExisted: true` and does NOT regenerate credentials.

**Why:** A migration/skill (or the user) overwrote the connection vars. Two classes
of var behave differently:
- `PGHOST` / `PGUSER` / `PGDATABASE` / `PGPORT` are stored as **env vars** → agent's
  `deleteEnvVars` removes them, and the platform's runtime-managed defaults resurface
  (`helium` / `postgres` / `heliumdb` / `5432`).
- `DATABASE_URL` and `PGPASSWORD` are stored as **Secrets** → the agent **cannot**
  delete or modify secrets (`environment-secrets` skill: "Cannot set or modify
  secrets directly"). `deleteEnvVars` silently no-ops on them, so they keep serving
  the bad value and shadow the good managed value.

**How to apply (recovery steps):**
1. `deleteEnvVars` the four PG* env vars to let managed host/user/db/port resurface.
2. The user must delete the `DATABASE_URL` **and** `PGPASSWORD` **Secrets** in the
   Secrets tab (agent can't). After deletion the managed values resurface
   automatically — same mechanism as the PG* vars.
3. Verify: bash reads live secret values (NOT stale) — `new pg.Client({connectionString:
   process.env.DATABASE_URL})` and query `information_schema.tables`.
4. Restart workflows (api-server especially) so they pick up the corrected env.

**Note:** `executeSql` tool uses PG* vars (not DATABASE_URL); the app/lib/db uses
DATABASE_URL. They can be in different states — check both. The original Helium DB
and its data survive an override (here: 363 user_entities, 11 user_profiles intact),
so prefer restoring it over creating a fresh DB.
