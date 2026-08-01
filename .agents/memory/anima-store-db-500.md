---
name: Character library Internal server error is a DB outage
description: Authenticated /api/store/* returns 500 while unauthenticated returns 401; root cause is Postgres connectivity, not Clerk
---

# Character load "Internal server error" after Clerk fixes

**Symptom:** Characters page shows `Internal server error` / `0 ENTITIES INDEXED`.
Unauthenticated `GET /api/store/Character` returns **401** (Clerk OK). With a valid
session JWT, `/api/store/Character`, `/revision`, `/profile`, and any DB write all
return **500** in ~50ms. Empty `bulk-upsert` returns **200** because it returns
before touching Postgres.

**Not Clerk:** PRs #68/#69 fixed publishable-key 500s. Auth is healthy when you see
401 signed-out and authenticated requests still 500.

**Probe:** `GET /api/healthz/db` (public) runs `select 1` and returns sanitized
error + host hint (`target.host`, `sslmode`). Store DB failures now map to **503**
with `code` via `classifyDbError`.

**Common causes:**
1. Replit/Helium DB suspended or `DATABASE_URL` wrong on Vercel
2. `resolveDbConfig` used `URL.toString()` which re-encodes passwords (`=` → `%3D`)
3. SSL verify-full regression (see `anima-prod-ssl-outage.md`)

**Ops:** Ensure Vercel Production `DATABASE_URL` points at a reachable Postgres;
redeploy after fixing. Verify with `/api/healthz/db` → `{"status":"ok"}`.
