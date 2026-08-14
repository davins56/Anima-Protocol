---
name: Anima prod DB SSL outage (pg-connection-string verify-full)
description: Why production /api/store/* all 500'd while dev was healthy, and the SSL fix in lib/db client
---

# Production-only DB outage: sslmode=require now means verify-full

**Symptom:** Deployed site showed the "Your saved data hasn't synced to your account yet" banner with "0 entities indexed". Prod logs: EVERY `/api/store/*` → 500, drizzle `Failed query: select ... from user_entities / user_profiles`. Dev fully healthy. The only prod-log anomaly was a `pg`/`pg-connection-string` SECURITY WARNING that `sslmode` `prefer/require/verify-ca` are treated as aliases for `verify-full`.

**Root cause:** A dependency bump (pg@8.20.0 / pg-connection-string@2.12.0) changed SSL semantics: `sslmode=require` now does full CA verification (`verify-full`). Replit's managed Postgres cert is not in the system CA store, so verify-full fails → every connection/query fails. Production `DATABASE_URL` uses `sslmode=require`; **development uses `sslmode=disable`** (no SSL), which is exactly why dev was unaffected and emitted no SSL warning.

**Why diagnosis was tricky:** drizzle wraps the real pg error as "Failed query: <sql>" without the connection-level cause, so logs never showed a cert error directly. `executeSql({environment:'production'})` also failed even on `select 1` (read-replica unreachable) — a red herring that looked like the whole prod DB was down; the real issue was the app's pg SSL config.

**Fix (lib/db/src/client.ts):** Read `sslmode` from `DATABASE_URL`, STRIP it from the connection string, and set `pg.Pool` `ssl` explicitly: `false` when `sslmode=disable`, else `{ rejectUnauthorized: false }` (encrypted, no CA verification — the long-standing meaning of `sslmode=require` here). Stripping `sslmode` prevents the parser from re-applying verify-full and silences the warning.

**Why:** Replit-managed Postgres uses a private CA, so CA verification can't succeed; `rejectUnauthorized:false` keeps the connection encrypted while restoring prior working behavior.

**How to apply:** Any future pg/pg-connection-string-style SSL regression where prod (sslmode=require) breaks but dev (sslmode=disable) is fine → set ssl explicitly on the Pool; do NOT rely on the connection-string sslmode alone. Code fix only takes effect in production after a **redeploy/publish** — restarting dev workflows is not enough.
