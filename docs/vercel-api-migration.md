# Run the API on Vercel (no Replit republish)

Use this when Replit credits are exhausted or the account is delinquent. The
**database can keep running on Replit** — you only copy secrets into Vercel; you
do **not** need to republish the Replit app.

## 1. Merge and deploy

Merge the PR that adds `server.mjs` at the repo root (zero-config Express
detection — do **not** list it under `vercel.json` `functions`, which only
accepts paths under `api/`). Vercel will:

1. Build `artifacts/api-server` → `dist/vercel.mjs`
2. Build the Vite frontend
3. Run the Express app as a Vercel Function for `/api/*`

Trigger a **Production** redeploy on Vercel after merge.

## 2. Copy environment variables (Replit → Vercel)

In the **Replit** workspace, open **Secrets** / **Environment** and copy values
into **Vercel → Project → Settings → Environment Variables** (Production):

| Variable | Required | Notes |
|----------|----------|--------|
| `DATABASE_URL` | Yes | Postgres connection string (Replit DB still works remotely) |
| `CLERK_SECRET_KEY` | Yes | Same value as Replit |
| `CLERK_PUBLISHABLE_KEY` | Yes | Same as `VITE_CLERK_PUBLISHABLE_KEY` on Vercel |
| `OPENAI_API_KEY` | Yes | For chat / AI features |
| `NODE_ENV` | Yes | Set to `production` on Vercel |

Copy any other secrets your Replit deployment uses (e.g. object storage, ElevenLabs)
if those features are needed.

**You do not need to republish on Replit** to read these values.

## 3. Verify

After deploy:

```bash
curl https://www.anima-protocol.com/api/healthz
```

Expect: `{"status":"ok"}`

Sign in on the site, open **Characters → Add From Series**, add a Marvel character.
It should save without "Session not recognized by the server".

## 4. If the database is unreachable

If Replit has suspended the **database** (not just compute), `DATABASE_URL` may
stop working. Options:

- Restore Replit billing long enough to export a dump, or
- Provision [Neon](https://neon.tech) / Vercel Postgres, run `pnpm --filter @workspace/db run push`, migrate data, update `DATABASE_URL` on Vercel only.

## 5. Replit after migration

Once Vercel serves `/api/*`, you can leave the Replit deployment stopped. Keep the
Replit database until you migrate to another host.
