# Health endpoints: who can see what

Security audit 2026-11-14, finding M1. The health routes mount before Clerk,
so they use the operator bearer from `lib/opsAuth.ts` (the same
`ADMIN_MIGRATION_SECRET` or `CRON_SECRET` as `/api/admin/ensure-schema`,
compared in constant time). With neither secret set, the ops-only routes
answer `503 ops_secret_unconfigured`.

| Route | Public (no bearer) | With the ops bearer |
|---|---|---|
| `GET /api/healthz` | `{ status: "ok" }` (liveness; Cloud Run and platform probes use this) | same |
| `GET /api/health` | `{ status, timestamp }` | same |
| `GET /api/healthz/llm` | `{ status, chain }` only. The client's local-only guard reads `chain`. | full routing report (hosts, models, gateway, quota state) |
| `GET /api/healthz/llm?probe=1` | 401 | live probe of every configured provider |
| `GET /api/healthz/clerk` | `{ status }` only | key report (presence, kind, hosts, pairing, notes) |
| `GET /api/healthz/clerk?probe=1` | 401 | JWKS / domains probe against Clerk's Backend API |
| `GET /api/healthz/env` | 401 | presence booleans |
| `GET /api/healthz/db` | 401 | connectivity + **inspect-only** schema check (no DDL) |
| `GET /api/healthz/schema` | 401 | schema inspect |
| `POST /api/healthz/schema` | 401 | idempotent `ensureSchemaOnce()` |

No response includes a key tail any more (the Clerk secret/publishable and
OpenRouter tails were removed from the reports).

```bash
curl -s -H "Authorization: Bearer $ADMIN_MIGRATION_SECRET" \
  'https://anima-protocol.com/api/healthz/llm?probe=1' | jq '{probeOk, probes}'
```
