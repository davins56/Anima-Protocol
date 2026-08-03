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
| `OPENAI_API_KEY` | Recommended | ChatGPT backend + image edit/generate (Customise Anima → Generate Look). Valid key from https://platform.openai.com/account/api-keys. Optional for chat if you force Grok/Gemini/Kimi or use `anima` with other keys. |
| `GEMINI_API_KEY` | Optional | Gemini (Google AI Studio). Also accepts `GOOGLE_API_KEY`. Default when set (Gemini-only). Supports `AQ.*` auth keys via the native Generative Language API. |
| `KIMI_API_KEY` / `MOONSHOT_API_KEY` | Recommended when unpaid | Kimi / Kiwi (Moonshot). Default when Gemini is unset. Force with `ANIMA_LLM_PROVIDER=kimi`. Base URL `https://api.moonshot.ai/v1`. |
| `XAI_API_KEY` | Optional | Grok (xAI). Used under `ANIMA_LLM_PROVIDER=auto` / `anima` or as primary via `xai`. Not used when mode is `gemini` / `kimi`. |
| `ANIMA_LLM_PROVIDER` | No | Unset: Kimi-only if `KIMI_API_KEY` (even when Gemini is also set), else Gemini-only if `GEMINI_API_KEY`, else `auto`. Prefer **`anima`** (aliases `custom` / `ensemble`) for the custom multi-model LLM: light→Kimi, standard→Gemini, heavy→Grok, with failover across ChatGPT too. Or `kimi` / `moonshot` / `gemini` / `auto` / `xai` / `grok` / `openai`. |
| `ANIMA_DISABLE_OPENAI` | No | Set `true` under `auto` / `anima` to skip OpenAI entirely. |
| `ANIMA_DISABLE_XAI` | No | Set `true` under `auto` / `openai` / `anima` to skip Grok when the xAI team has no credits. |
| `NODE_ENV` | Yes | Set to `production` on Vercel |
| `DATABASE_URL` | Yes | Also stores avatar uploads in `uploaded_images` (Vercel has no Replit object-storage sidecar) |

**Avatar upload on Vercel:** the app posts images to `POST /api/storage/uploads`, which saves them in Postgres and serves them at `/api/storage/objects/uploads/:id`. The old Replit GCS sidecar (`PRIVATE_OBJECT_DIR` + local signer) is optional and not required for avatars.

**If chat fails for every companion with “no credits” or `401 status code (no body)`:** OpenAI/xAI credits are empty or the key is revoked. Prefer a **`KIMI_API_KEY`** (Moonshot) with `ANIMA_LLM_PROVIDER=kimi`, or a working **`GEMINI_API_KEY`**, then redeploy. Image generation still needs a funded `OPENAI_API_KEY`.

**Kimi setup (lowest-cost option):** Create a key at https://platform.kimi.ai, set `KIMI_API_KEY` (or `MOONSHOT_API_KEY`) on Vercel Production, redeploy. When a Kimi key is present it is preferred automatically over Gemini. Optional: set `ANIMA_LLM_PROVIDER=kimi` to force Kimi-only, or remove `GEMINI_API_KEY` if you no longer want it. Moonshot may require a small platform balance before the key can call models — check the console if auth/quota errors persist.

**Custom Anima LLM (Kimi + Gemini + Grok + ChatGPT):** Set `ANIMA_LLM_PROVIDER=anima` (or `custom`) and configure as many of `KIMI_API_KEY`, `GEMINI_API_KEY`, `XAI_API_KEY`, and `OPENAI_API_KEY` as you have. Chat routes by message tier — light turns prefer Kimi, standard prefer Gemini, heavy prefer Grok — then fail over across the rest. The chat chip shows **Anima**; the tooltip names which backend served the turn.

**If chat fails with a Grok “no team credits” error after trying Gemini:** you are on `ANIMA_LLM_PROVIDER=auto` (or an older deploy). Fix Gemini first (check `GEMINI_API_KEY` / Google AI Studio quota), set `ANIMA_DISABLE_XAI=true`, or buy xAI credits. With the current default (`gemini` mode when `GEMINI_API_KEY` is set), Grok is not used as a backup — failures surface as Gemini quota/key errors instead.

**If the key is valid but companions return an empty reply / no visible text:** Gemini 2.5 thinking tokens can consume `maxOutputTokens` and leave no room for the answer. Current deploys disable thinking on Flash by default (`thinkingBudget: 0`). Override with `ANIMA_GEMINI_THINKING_BUDGET` if needed, then redeploy.

**If chat says “Too many requests. Please slow down” after one message:** that is the API’s own rate limiter, not Gemini. Older deploys keyed the limiter by proxy IP (shared on Vercel), so background sync could exhaust the bucket. Current deploys trust the Vercel proxy, key by Clerk user id, and only throttle `POST /chat/messages`. Wait for the `Retry-After` window, then retry after redeploy.

**`401 status code (no body)`** means the active LLM API key was rejected (empty auth error body). Paste keys without quotes, confirm they are active, redeploy.

If `DATABASE_URL` or `CLERK_SECRET_KEY` is missing, `/api/*` returns **503**
(with a JSON body) instead of crashing the Vercel function.

Copy any other secrets your Replit deployment uses (e.g. object storage, ElevenLabs)
if those features are needed.

**You do not need to republish on Replit** to read these values.

## 3. Clerk OAuth (Google / Apple / GitHub)

Clerk has **two separate instances**: **Development** (`pk_test_…`) and **Production** (`pk_live_…`). SSO connections you enable in the Development tab (as in the Clerk dashboard screenshot) apply only when the site is built with a `pk_test_` publishable key. If Vercel uses `pk_live_`, you must enable Apple/GitHub again under the **Production** instance → Configure → SSO connections (shared dev credentials do not carry over).

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
   - `https://www.anima-protocol.com/sign-in/sso-callback`
   - `https://www.anima-protocol.com/sign-up/sso-callback`
   - Same paths for preview hosts you test on (e.g. `*.vercel.app`).

See `docs/clerk-github-login.md` for the full Google/GitHub/Apple checklist.
Google `redirect_uri_mismatch` means the provider app is missing
`https://clerk.anima-protocol.com/v1/oauth_callback`.

## 4. Verify

After deploy:

```bash
curl https://www.anima-protocol.com/api/healthz
curl https://clerk.anima-protocol.com/v1/environment
```

Expect healthz `{"status":"ok"}` and Clerk environment HTTP 200.

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
