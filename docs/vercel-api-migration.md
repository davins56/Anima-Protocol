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
<<<<<<< HEAD
| `OPENAI_API_KEY` | Yes | For chat / AI features |
| `NODE_ENV` | Yes | Set to `production` on Vercel |
=======
| `OPENAI_API_KEY` | Recommended | Image edit/generate (Customise Anima → Generate Look). Also chat backup under `auto`. |
| `GEMINI_API_KEY` | Recommended | Preferred chat LLM under `auto` (native Google AI Studio, including `AQ.*` keys). |
| `KIMI_API_KEY` / `MOONSHOT_API_KEY` | Optional | Kimi / Moonshot backup. Base URL `https://api.moonshot.ai/v1`. |
| `XAI_API_KEY` | Optional | Grok (xAI) backup in the auto chain. |
| `AI_GATEWAY_API_KEY` | Recommended | Vercel AI Gateway last-resort unpaid path (also uses `VERCEL_OIDC_TOKEN` on Vercel). |
| `ANIMA_LLM_PROVIDER` | No | Unset / `auto`: **Gemini → Kimi → Grok → OpenAI → AI Gateway**. Or `gemini` / `kimi` / `xai` / `openai` / `gateway` / `anima`. **Never paste an API key here** — put Gemini keys in `GEMINI_API_KEY`. |
| `ANIMA_DISABLE_OPENAI` | No | Set `true` under `auto` to skip OpenAI entirely. |
| `ANIMA_DISABLE_XAI` | No | Set `true` under `auto` / `openai` to skip Grok when the xAI team has no credits. |
| `ANIMA_DISABLE_GATEWAY` | No | Set `true` under `auto` to skip AI Gateway. |
| `NODE_ENV` | Yes | Set to `production` on Vercel |
| `DATABASE_URL` | Yes | Also stores avatar uploads in `uploaded_images` (Vercel has no Replit object-storage sidecar) |

**Avatar upload on Vercel:** the app posts images to `POST /api/storage/uploads`, which saves them in Postgres and serves them at `/api/storage/objects/uploads/:id`. The old Replit GCS sidecar (`PRIVATE_OBJECT_DIR` + local signer) is optional and not required for avatars.

**If chat fails for every companion with “no credits” or `401 status code (no body)`:** Prefer a working **`GEMINI_API_KEY`**, keep `ANIMA_LLM_PROVIDER=auto`, ensure backups (`KIMI_API_KEY` / `XAI_API_KEY` / `OPENAI_API_KEY`) are funded, **or** set `AI_GATEWAY_API_KEY` so the unpaid AI Gateway last resort can cover. Also check that `ANIMA_LLM_PROVIDER` is a mode name (`auto` / `gemini` / …), not an API key. Image generation still needs a funded `OPENAI_API_KEY`.

**If `/api/healthz/llm` already shows `"keys": { …: true }` for every provider:** the env values are present — the failure is upstream rejection (quota/billing/revoked), not a missing Vercel variable. Open each provider console and fund/repair the account, or set `AI_GATEWAY_API_KEY`. Confirm with `?probe=1` (look for at least one `"ok": true`).

**Gemini setup (recommended):** Create a key at Google AI Studio, set `GEMINI_API_KEY` on Vercel **Production**, set `ANIMA_LLM_PROVIDER=auto` (or `gemini`), and move any `AQ.*` value out of `ANIMA_LLM_PROVIDER` into `GEMINI_API_KEY`. Redeploy. Verify at `https://www.anima-protocol.com/api/healthz/llm` — you want `"preferred":"gemini"` and a chain like `["gemini","kimi","xai","openai","gateway"]`. Live-test keys with `?probe=1`.

**Chat default is Gemini-first with failover:** Without any chat keys, chat fails with a clear setup error. With `ANIMA_LLM_PROVIDER=anima` / `ensemble` (or `ANIMA_LLM_ENSEMBLE=true`), available minds (**Kimi / Grok / ChatGPT**) draft in parallel, then a combined reply is streamed. Sticky provider failures are skipped on later turns; timed-out mind calls are aborted.

**If chat fails with a Grok “no team credits” error:** buy xAI credits, set `ANIMA_DISABLE_XAI=true` to skip Grok, or rely on Gemini / Kimi / OpenAI backups.

**If chat says “Too many requests. Please slow down” after one message:** that is the API’s own rate limiter, not the LLM. Older deploys keyed the limiter by proxy IP (shared on Vercel), so background sync could exhaust the bucket. Current deploys trust the Vercel proxy, key by Clerk user id, and only throttle `POST /chat/messages`. Wait for the `Retry-After` window, then retry after redeploy.

**`401 status code (no body)`** means the active LLM API key was rejected (empty auth error body). Paste keys without quotes, confirm they are active, redeploy.
>>>>>>> origin/main

If `DATABASE_URL` or `CLERK_SECRET_KEY` is missing, `/api/*` returns **503**
(with a JSON body) instead of crashing the Vercel function.

Copy any other secrets your Replit deployment uses (e.g. object storage, ElevenLabs)
if those features are needed.

**You do not need to republish on Replit** to read these values.

## 3. Clerk OAuth (Google / Apple / GitHub)

Clerk has **two separate instances**: **Development** (`pk_test_…`) and **Production** (`pk_live_…`). SSO connections you enable in the Development tab (as in the Clerk dashboard screenshot) apply only when the site is built with a `pk_test_` publishable key. If Vercel uses `pk_live_`, you must enable Apple/GitHub again under the **Production** instance → Configure → SSO connections (shared dev credentials do not carry over).

<<<<<<< HEAD
The frontend proxies Clerk’s Frontend API through **`/api/__clerk`** on production
(same origin as the Vite app). That is required for GitHub and Apple sign-in on
`anima-protocol.com` when there is no `clerk.{domain}` DNS CNAME. Do **not** use
the Clerk proxy with `pk_test_` on a custom domain — it causes Origin mismatch;
use `pk_live_` + proxy for production OAuth on `anima-protocol.com`.

In the **Clerk Dashboard** for the **same instance as your publishable key**:

1. **Social connections** — enable Google, Apple, and GitHub (Apple needs a
   Services ID and return URLs configured in Clerk’s Apple setup guide).
2. **Domains → Proxy URL** — set to `https://www.anima-protocol.com/api/__clerk`
   (and the apex host if you use it without `www`).
3. **Redirect URLs** — allow:
=======
Production uses a Clerk **custom domain** (`clerk.anima-protocol.com`). The
frontend talks to that host directly — leave `VITE_CLERK_PROXY_URL` empty.
`/api/__clerk` is only needed when there is no `clerk.{domain}` CNAME.

In the **Clerk Dashboard** for the **same instance as your publishable key**:

1. **Social connections** — enable Google, Apple, and GitHub with **custom**
   OAuth credentials (required for Production). Copy Clerk’s **Authorized
   Redirect URI** (`https://clerk.anima-protocol.com/v1/oauth_callback`) into
   each provider’s OAuth app (Google Cloud / GitHub / Apple). Do **not** put
   `/sign-in/sso-callback` in those provider apps — that is Clerk → Anima only.
2. **Redirect URLs** (Clerk → Paths) — allow:
>>>>>>> origin/main
   - `https://www.anima-protocol.com/sign-in/sso-callback`
   - `https://www.anima-protocol.com/sign-up/sso-callback`
   - Same paths for preview hosts you test on (e.g. `*.vercel.app`).

<<<<<<< HEAD
Until `/api/*` returns healthy responses (not `FUNCTION_INVOCATION_FAILED`),
OAuth will fail because the Clerk proxy route is on the same API function.
=======
See `docs/clerk-github-login.md` for the full Google/GitHub/Apple checklist.
Google `redirect_uri_mismatch` means the provider app is missing
`https://clerk.anima-protocol.com/v1/oauth_callback`.
>>>>>>> origin/main

## 4. Verify

After deploy:

```bash
curl https://www.anima-protocol.com/api/healthz
<<<<<<< HEAD
```

Expect: `{"status":"ok"}`
=======
curl https://clerk.anima-protocol.com/v1/environment
```

Expect healthz `{"status":"ok"}` and Clerk environment HTTP 200.
>>>>>>> origin/main

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
