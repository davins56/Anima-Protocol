# Run the API on Vercel (no Replit republish)

Use this when Replit credits are exhausted or the account is delinquent. The
**database can keep running on Replit** — you only copy secrets into Vercel; you
do **not** need to republish the Replit app.

## 1. Merge and deploy

Merge the PR that adds `api/index.mjs` as the Vercel Serverless Function entry.
`vercel.json` rewrites `/api/*` to that function. Vercel will:

1. Build `artifacts/api-server` → `dist/vercel.mjs`, then copy it to `api/index.mjs`
2. Build the Vite frontend
3. Run the Express app as a Vercel Function for `/api/*`

Only `api/index.mjs` may appear under `functions` in `vercel.json`. A separate
`api/server.mjs` pattern causes deploy errors: *"The pattern doesn't match any
Serverless Functions inside the api directory."*

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

If `DATABASE_URL` or `CLERK_SECRET_KEY` is missing, `/api/*` returns **503**
(with a JSON body) instead of crashing the Vercel function.

Copy any other secrets your Replit deployment uses (e.g. object storage, ElevenLabs)
if those features are needed.

**You do not need to republish on Replit** to read these values.

## 3. Clerk OAuth (Google / Apple / GitHub)

The frontend proxies Clerk’s Frontend API through **`/api/__clerk`** on production
(same origin as the Vite app). That is required for GitHub and Apple sign-in on
`anima-protocol.com` when there is no `clerk.{domain}` DNS CNAME.

In the **Clerk Dashboard** for this application:

1. **Social connections** — enable Google, Apple, and GitHub (Apple needs a
   Services ID and return URLs configured in Clerk’s Apple setup guide).
2. **Domains → Proxy URL** — set to `https://www.anima-protocol.com/api/__clerk`
   (and the apex host if you use it without `www`).
3. **Redirect URLs** — allow:
   - `https://www.anima-protocol.com/sign-in/sso-callback`
   - `https://www.anima-protocol.com/sign-up/sso-callback`
   - Same paths for preview hosts you test on (e.g. `*.vercel.app`).

Until `/api/*` returns healthy responses (not `FUNCTION_INVOCATION_FAILED`),
OAuth will fail because the Clerk proxy route is on the same API function.

## 4. Verify

After deploy:

```bash
curl https://www.anima-protocol.com/api/healthz
```

Expect: `{"status":"ok"}`

Sign in on the site, open **Characters → Add From Series**, add a Marvel character.
It should save without "Session not recognized by the server".

## 5. If the database is unreachable

If Replit has suspended the **database** (not just compute), `DATABASE_URL` may
stop working. Options:

- Restore Replit billing long enough to export a dump, or
- Provision [Neon](https://neon.tech) / Vercel Postgres, run `pnpm --filter @workspace/db run push`, migrate data, update `DATABASE_URL` on Vercel only.

## 6. Replit after migration

Once Vercel serves `/api/*`, you can leave the Replit deployment stopped. Keep the
Replit database until you migrate to another host.
