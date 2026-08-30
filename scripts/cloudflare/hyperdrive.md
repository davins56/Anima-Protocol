# Hyperdrive for anima-protocol.com

The companion store (`/api/store`) on the Cloudflare Worker has credentials
(`DATABASE_URL` in Secrets Store, store `a31e40473ef34db896b5bc1e6c1c4b86`)
but **cannot open a raw TCP session** to hosted Postgres from a Worker isolate.
That surfaces as:

- "The companion store cannot reach the database."
- "Database connection reset. The API has credentials, but Postgres is unreachable from this host."

`node-postgres` (`pg` Pool) from the Worker to Supabase/Neon/RDS `:5432` is
the usual cause. The Secrets Store binding is correct and must stay — it is
not a Worker-safe path. Earlier deploys only made pool creation lazy so Worker
upload would not fail with 10021.

The Worker now uses **postgres.js** (Hyperdrive-safe) and prefers a bound
`HYPERDRIVE.connectionString` over the origin `DATABASE_URL`. Local Node and
Vercel keep `node-pg` against the same Secrets Store / env URL.

`wrangler.jsonc` on production:

- Worker `anima-protocol`, `main` = `artifacts/api-server/src/worker.ts`
- `nodejs_compat` + `nodejs_compat_populate_process_env`
- `vars` only `NODE_ENV`
- `DATABASE_URL` via `secrets_store_secrets` (binding + `store_id` + `secret_name` only)
- no Hyperdrive binding until the dashboard step below

## One dashboard step (Dàvīn)

Create Hyperdrive in the Cloudflare dashboard. Paste `DATABASE_URL` **into
that Hyperdrive form once**. Never put the URL in git, chat, or `wrangler`
`vars`.

1. Cloudflare Dashboard → **Storage & databases** → **Hyperdrive** → **Create configuration**.
2. Paste the existing `DATABASE_URL` secret into Hyperdrive (prefer the
   provider **pooler** host/port when one exists, e.g. Supabase `:6543` /
   `*.pooler.supabase.com`, not direct `:5432`).
3. Name it something like `anima-postgres`.
4. Copy only the Hyperdrive **id** (UUID). Bind Worker **`anima-protocol`** as
   **`HYPERDRIVE`** by adding this to root `wrangler.jsonc` (id / binding name
   only) and redeploy so git deploys do not drop a dashboard-only binding:

```jsonc
"hyperdrive": [
  { "binding": "HYPERDRIVE", "id": "<paste-hyperdrive-config-uuid>" }
]
```

Leave `secrets_store_secrets` `DATABASE_URL` in place. After deploy,
`GET /api/healthz/db` should report `"source": "hyperdrive"` and `"db": true`.
