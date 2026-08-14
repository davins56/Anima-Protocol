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
| `DATABASE_URL` | Yes | Postgres connection string (Replit DB still works remotely); also stores avatar uploads in `uploaded_images` (Vercel has no Replit object-storage sidecar) |
| `CLERK_SECRET_KEY` | Yes | Same value as Replit |
| `CLERK_PUBLISHABLE_KEY` | Yes | Same as `VITE_CLERK_PUBLISHABLE_KEY` on Vercel |
| `OPENAI_API_KEY` | Recommended | Image edit/generate only (Customise Anima → Generate Look). Never used for chat. |
| `ANIMA_LOCAL_LLM_BASE_URL` | Yes for chat (or OpenRouter) | Public HTTPS OpenAI-compatible URL for Ollama/vLLM (e.g. `https://llm.example.com/v1`). Preferred chat backend. |
| `ANIMA_LOCAL_LLM_BACKEND` | No | `ollama` (default) or `vllm`. |
| `ANIMA_OLLAMA_MODEL_STANDARD` | Yes for chat (Ollama) | Model tag served by your Ollama host, e.g. `anima-chat` or `anima-uncensored`. |
| `OPENROUTER_API_KEY` | Yes for chat (or local) | Free key at https://openrouter.ai/keys. Defaults to Venice Uncensored (open-weight). A $0 account auto-falls back to `openai/gpt-oss-20b:free` on HTTP 402. Set `ANIMA_OPENROUTER_FREE=true` to skip Venice. |
| `NODE_ENV` | Yes | Set to `production` on Vercel |
| `CURSOR_API_KEY` | No | Lets Serenity launch Cursor Cloud Agents that upgrade Protocol source. Copy from Cursor Dashboard → API Keys |

**Avatar upload on Vercel:** the app posts images to `POST /api/storage/uploads`, which saves them in Postgres and serves them at `/api/storage/objects/uploads/:id`. The old Replit GCS sidecar (`PRIVATE_OBJECT_DIR` + local signer) is optional and not required for avatars.

**If chat shows "Anima custom LLM is not configured" / "No chat LLM configured":**
Neither a self-hosted endpoint nor `OPENROUTER_API_KEY` is usable. Fastest unblock: set `OPENROUTER_API_KEY` (Venice Uncensored by default). Live status looks like:

```bash
curl -s https://www.anima-protocol.com/api/healthz/llm | jq '{status,preferred,localEndpoint,note}'
# "status":"error", "preferred":null, "localEndpoint.configured":false
```

Fix on **Vercel → Settings → Environment Variables → Production**, then **redeploy without build cache**:

```bash
ANIMA_LOCAL_LLM_BACKEND=ollama
ANIMA_LOCAL_LLM_BASE_URL=https://<your-public-ollama-or-vllm>/v1
ANIMA_OLLAMA_MODEL_STANDARD=anima-chat
```

Host Ollama with `pnpm llm:up` on a machine that Vercel can reach (HTTPS). See `docs/custom-llm.md` and `docs/llm-deploy.md` for a concrete no-infra-yet path.

Image generation prefers **Gemini Flash Image** (`gemini-2.5-flash-image`) via `GEMINI_API_KEY` (or `GOOGLE_API_KEY`). If Gemini is unset or fails, it falls back to OpenAI `gpt-image-1` when `OPENAI_API_KEY` is set. Disable the Gemini path with `IMAGE_FREE_FALLBACK=off`.

**If chat says "Too many requests. Please slow down" after one message:** that is the API's own rate limiter, not the LLM. Older deploys keyed the limiter by proxy IP (shared on Vercel), so background sync could exhaust the bucket. Current deploys trust the Vercel proxy, key by Clerk user id, and only throttle `POST /chat/messages`. Wait for the `Retry-After` window, then retry after redeploy.

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
   OAuth credentials (required for Production). Copy Clerk's **Authorized
   Redirect URI** (`https://clerk.anima-protocol.com/v1/oauth_callback`) into
   each provider's OAuth app (Google Cloud / GitHub / Apple). Do **not** put
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
