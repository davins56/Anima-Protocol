# Hyperdrive for anima-protocol.com

The companion store (`/api/store`) on the Cloudflare Worker has credentials
(`DATABASE_URL` in Secrets Store) but **cannot open a raw TCP session** to
hosted Postgres from a Worker isolate. That surfaces as:

- "The companion store cannot reach the database."
- "Database connection reset. The API has credentials, but Postgres is unreachable from this host."

`node-postgres` (`pg` Pool) from the Worker to Supabase/Neon/RDS `:5432` is
the usual cause. Earlier deploys only made pool creation lazy so Worker upload
would not fail with 10021 — they did not make Postgres reachable.

The Worker now uses **postgres.js** (Hyperdrive-safe) and prefers a bound
`HYPERDRIVE.connectionString` over the origin `DATABASE_URL`. Local Node and
Vercel keep `node-pg`.

## One dashboard step (Dàvīn)

Create a Hyperdrive configuration in the Cloudflare dashboard and bind it to
Worker `anima-protocol` as `HYPERDRIVE`.

1. Cloudflare Dashboard → **Storage & databases** → **Hyperdrive** → **Create configuration**.
2. Point it at the **same Postgres already stored as the `DATABASE_URL` secret**.
   Prefer the provider **pooler** host/port when one exists (for example
   Supabase transaction pooler on `:6543` / `*.pooler.supabase.com`, not the
   direct session port `:5432`).
3. Name it something like `anima-postgres`. Bind it to Worker **`anima-protocol`**
   with binding name **`HYPERDRIVE`**.
4. Copy only the Hyperdrive **id** (a UUID). Do not put the connection string,
   password, or `DATABASE_URL` in `wrangler.jsonc` `vars`.
5. Uncomment / add this block in root `wrangler.jsonc` (id only) and redeploy
   so git deploys do not drop a dashboard-only binding:

```jsonc
"hyperdrive": [
  { "binding": "HYPERDRIVE", "id": "<paste-hyperdrive-config-uuid>" }
]
```

Do not paste the connection string into chat or the repo. After deploy,
`GET /api/healthz/db` should report `"source": "hyperdrive"` and `"db": true`.

Leaving Hyperdrive unbound still uses `DATABASE_URL` through postgres.js. That
is better than a long-lived `pg` Pool, but hosted Postgres will often keep
resetting Worker TCP until Hyperdrive (or the pooler port in the secret) is in
place.
