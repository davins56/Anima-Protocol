# AGENTS.md

## Cursor Cloud specific instructions

### Product overview

**Anima Protocol** is a pnpm monorepo: React/Vite frontend (`artifacts/anima-protocol`), Express API (`artifacts/api-server`), shared Drizzle DB package (`lib/db`), and optional **Mockup Sandbox** (`artifacts/mockup-sandbox`) for isolated UI previews at `/__mockup`.

The frontend calls `/api/*` via `src/lib/apiOrigin.js` (see `animaApi.js`, `base44Client.js`). Default is same-origin; set `VITE_API_ORIGIN` at build time to point at an external API host. The Vite dev server proxies `/api` to `http://localhost:8080` by default (`API_PROXY_TARGET` overrides it). **Production:** Vercel runs the Express api-server as a single self-contained `api/index.mjs` bundle (copied from `dist/vercel.mjs` by the `api-server` build; rewrites `/api/*`) on the same deployment as the frontend — **no Replit republish required**. `api/index.mjs` must stay committed: Vercel validates `vercel.json` `functions` against the repo **before** `buildCommand` runs, and a missing file fails the deploy with `functions.api/index.mjs does not match any file`. Do not add `api/server.mjs` to `vercel.json` `functions` — only `api/index.mjs` is a valid Serverless Function entry. Do not gitignore `api/`. Copy `DATABASE_URL`, `CLERK_SECRET_KEY`, `OPENAI_API_KEY`, etc. from Replit Secrets into Vercel env vars (see `docs/vercel-api-migration.md`). Replit can stay delinquent as long as the Postgres instance accepts external connections.

### Node.js

Replit targets **Node 24** (`.replit` → `nodejs-24`). Cloud VMs may ship `/exec-daemon/node` (v22) ahead of nvm on `PATH`. **Always prepend** nvm Node 24 before `pnpm`/`node`:

```bash
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
export PATH="$NVM_DIR/versions/node/v24.16.0/bin:$PATH"
```

(`~/.bashrc` in this environment already sets this.)

### Package manager

Use **pnpm only** (root `preinstall` rejects npm/yarn): `pnpm install --frozen-lockfile`.

### PostgreSQL (local VM)

PostgreSQL 16 is installed with a dev database:

- `DATABASE_URL=postgresql://anima:anima_dev@localhost:5432/anima_dev`
- Apply schema: `pnpm --filter @workspace/db run push` (requires `DATABASE_URL`)

Start cluster if needed: `sudo pg_ctlcluster 16 main start`

### Environment file

Copy the template and fill in your keys:

```bash
cp .env.example .env
```

The repo root **`.env`** is gitignored. Both **`anima-protocol`** (Vite) and **`api-server`** load it on startup. Optional per-package overrides: `artifacts/anima-protocol/.env`, `artifacts/api-server/.env`.

| Variable | Used by |
|----------|---------|
| `DATABASE_URL` | API + `db push` |
| `OPENAI_API_KEY` | API (import-time check) |
| `PORT` | API `8080`, frontend `23660`, mockup `8081` |
| `BASE_PATH` | Frontend `/`, mockup `/__mockup` |
| `VITE_CLERK_PUBLISHABLE_KEY` | Frontend (build/dev) — must match `CLERK_PUBLISHABLE_KEY`; Vite build also reads `CLERK_PUBLISHABLE_KEY` if `VITE_` is unset |
| `CLERK_PUBLISHABLE_KEY` | API `clerkMiddleware` |
| `CLERK_SECRET_KEY` | API session verification |
| `VITE_CLERK_PROXY_URL` | Explicit proxy URL, or `none` / `false` / `off` to disable all proxying. When unset, `pk_live_` auto-proxies through `/api/__clerk` on `anima-protocol.com` **unless** the publishable key decodes to a Clerk **custom domain** (e.g. `clerk.anima-protocol.com`) — then the browser talks to that host directly |
| `VITE_MIXPANEL_TOKEN` | Frontend analytics |
| `VITE_ALGOLIA_SEARCH_API_KEY` | Frontend — Algolia **search-only** key for the Netlify crawler widget (`div#search`). Never use the Admin or crawler `ALGOLIA_API_KEY` here. Widget stays hidden when unset. |
| `VITE_ALGOLIA_BRANCH` | Frontend — optional override for which Algolia Netlify index to query. Defaults to Netlify `HEAD` or `main`. |
| `OPENROUTER_API_KEY` | API chat (Venice Uncensored; free-tier fallback on HTTP 402). Alias: `ANIMA_OPENROUTER_API_KEY` / `OPEN_ROUTER_API_KEY` |
| `ANIMA_OPENROUTER_FREE` | API — set `true` to skip Venice and use `google/gemma-4-31b-it:free` |
| `ANIMA_LOCAL_LLM_BASE_URL` | API — public HTTPS OpenAI-compatible `…/v1` URL (Fly: `https://anima-chat-llm.fly.dev/v1`). Never localhost on the Worker |
| `ANIMA_LOCAL_LLM_API_KEY` | API — bearer token; must match Fly `PROXY_AUTH_TOKEN` |
| `ANIMA_LOCAL_LLM_BACKEND` | API — `ollama` (default) or `vllm` |
| `ANIMA_OLLAMA_MODEL_STANDARD` | API — model tag the host serves (`anima-chat`) |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Web Push credentials for proactive character messages |
| `VAPID_SUBJECT` | Web Push contact URI; defaults to `mailto:support@anima-protocol.com` |
| `CRON_SECRET` | Authorizes the hourly Vercel proactive-message cron |

**Production (Cloudflare — anima-protocol.com):** the apex host is Workers + Assets, not Vercel. Root `wrangler.jsonc` sets `main` to `artifacts/api-server/src/worker.ts` with `nodejs_compat`. Workers Builds already runs `pnpm build` (copies the SPA to `./dist`) then `npx wrangler deploy --assets=./dist --name anima-protocol`. `assets.run_worker_first` sends `/api` and `/api/*` to Express so `/api/healthz`, `/api/store`, and `/api/__clerk` are not swallowed by the SPA fallback, and `/assets` / `/assets/*` to the Worker so a missing hashed file returns 404 instead of `index.html`. Keep Clerk/DB/OpenRouter keys in Cloudflare **Secrets Store** (store `a31e40473ef34db896b5bc1e6c1c4b86`) and declare the bindings in `wrangler.jsonc` `secrets_store_secrets` (`CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `DATABASE_URL`, `OPENROUTER_API_KEY`). Do **not** add `ANIMA_LOCAL_LLM_BASE_URL` or `ANIMA_LOCAL_LLM_API_KEY` bindings until those `secret_name`s exist in the store — a binding for a missing entry fails `wrangler deploy` and blocks the Worker. Ordered follow-up: create the store entry, add the matching binding in the same commit, then deploy (see `deploy/ollama-fly/README.md`). Commit binding names and `store_id` only — never secret values. A git deploy that omits `secrets_store_secrets` unbinds dashboard secrets and `/api/healthz/env` goes all-false. The Worker never invents `http://localhost:11434/v1`; `/api/healthz/llm` reports `localEndpoint.configured: false` until a public HTTPS `…/v1` URL is bound. See `deploy/ollama-fly/README.md`. A deploy without `main` is assets-only and those `/api` paths 404. **Postgres from the Worker:** keep the Secrets Store `DATABASE_URL` binding; a raw `pg` TCP Pool against that secret from Workers still ECONNRESET. The Worker uses postgres.js and a `HYPERDRIVE` binding. One dashboard step: create Hyperdrive, paste `DATABASE_URL` **into that form once** (never into git), then put only `{ binding, id }` in `wrangler.jsonc` and redeploy — see `scripts/cloudflare/hyperdrive.md`.

**Production (recommended on Vercel):** set `VITE_CLERK_PUBLISHABLE_KEY` and `CLERK_PUBLISHABLE_KEY` to matching **`pk_live_` / `sk_live_`** from the **same** Clerk Production app (never put `sk_` in `VITE_CLERK_PUBLISHABLE_KEY`). This deployment uses Clerk **custom domain** (`clerk.anima-protocol.com` CNAME) — leave `VITE_CLERK_PROXY_URL` empty; the frontend detects the custom domain from the publishable key and **does not** route through `/api/__clerk` on `www.anima-protocol.com`. Verify `curl https://www.anima-protocol.com/api/healthz` and `curl https://clerk.anima-protocol.com/v1/environment` return 200 after deploy. Register OAuth redirect URLs (`…/sign-in/sso-callback`, `…/sign-up/sso-callback`) in Clerk → Paths. Redeploy **without build cache** after any env change. `/api/__clerk` proxy mode is only for hosts without a Clerk custom domain (e.g. some `*.vercel.app` previews if you enable Clerk proxy in the dashboard).

**Local dev with `pk_live_`:** run **api-server on 8080** and the Vite app on 23660 — the frontend auto-proxies Clerk through `http://localhost:23660/api/__clerk` so the dashboard proxy URL (`www.anima-protocol.com/api/__clerk`) matches. For simpler local auth, use **`pk_test_`** keys from the Clerk Development instance instead.

**Development keys on custom domain:** when Vercel uses **`pk_test_` / `sk_test_`**, the browser skips the Clerk proxy and mints **Development** session tokens. The API must verify with the same dev publishable key from `CLERK_PUBLISHABLE_KEY`. A mismatch surfaces as **401** on `/api/store` and “Session not recognized by the server” in the UI. Build-time `pk_test_` / `pk_live_` keys are used as-is (not rewritten via `publishableKeyFromHost`).

Without valid **Clerk** keys, API routes under `/api` return Clerk errors (middleware runs before handlers). The main app also fails to load Clerk JS until real keys are configured.

Sign-in shows custom Google / Apple / GitHub buttons above `<SignIn>` / `<SignUp>` (only providers Clerk reports as enabled; optional `VITE_CLERK_OAUTH_STRATEGIES` filter). OAuth uses Clerk v6 `signIn.sso()` with `/sign-in/sso-callback` and `/sign-up/sso-callback` (`HandleSSOCallback`). Enable each provider under Clerk Dashboard → Configure → SSO connections for the **same instance** as your publishable key (`pk_test_` = Development tab; `pk_live_` = Production tab). Creating the GitHub repo or signing into Clerk with GitHub does **not** enable GitHub for app users — add **GitHub** under SSO connections explicitly. Verify setup:

```bash
pnpm --filter @workspace/scripts run verify:clerk-oauth -- --fix-redirects
```

`VITE_CLERK_PUBLISHABLE_KEY` must be set at **build** time on Vercel (not only `CLERK_PUBLISHABLE_KEY` for the API).

Optional: `ELEVENLABS_API_KEY` for TTS routes.

Optional: `CURSOR_API_KEY` (alias `CURSOR_CLOUD_API_KEY`) lets Serenity launch Cursor Cloud Agents that upgrade Anima Protocol source when the steward asks for an interface or system weave. Default repo is `https://github.com/davins56/Anima-Protocol`. Restrict stewards with `PROTOCOL_UPGRADE_ADMIN_EMAILS` (defaults to `davins56@gmail.com,davins56@hotmail.com`).

### Account data migration (ops)

Characters and all progress are scoped by **Clerk `user_id`** in Postgres (`user_entities`), not email. To copy data between two accounts (e.g. `davins56@hotmail.com` → `davins56@gmail.com`):

```bash
export DATABASE_URL=... CLERK_SECRET_KEY=...
pnpm --filter @workspace/scripts run migrate:account -- \
  --from davins56@hotmail.com --to davins56@gmail.com --dry-run
# remove --dry-run to apply
```

Or after deploy, set `ADMIN_MIGRATION_SECRET` on Vercel and POST to `/api/admin/migrate-user-data` with `Authorization: Bearer <secret>`.

User-driven alternative: sign in as source → Settings → Export → sign in as target → Restore (merge).

### Lint / test / build

No ESLint script at repo root. Validation workflows from `.replit`:

| Task | Command |
|------|---------|
| Typecheck (all packages) | `pnpm run typecheck` |
| Unit tests (no DB/API) | `pnpm --filter @workspace/anima-protocol run test` |
| Build API | `pnpm --filter @workspace/api-server run build` |
| Build frontend | `PORT=23660 BASE_PATH=/ VITE_CLERK_PUBLISHABLE_KEY=... pnpm --filter @workspace/anima-protocol run build` |
| Root `pnpm run build` | Deployment build: API bundle + frontend |
| Full workspace build | `pnpm run build:all` (typecheck + every package build; needs `PORT` + `BASE_PATH` for mockup-sandbox) |

### Running services (tmux)

Use descriptive tmux session names (`anima-api`, `anima-web`, `mockup-sandbox`). Example API:

```bash
export DATABASE_URL=postgresql://anima:anima_dev@localhost:5432/anima_dev
export OPENAI_API_KEY=sk-...
export CLERK_PUBLISHABLE_KEY=pk_test_...
export CLERK_SECRET_KEY=sk_test_...
export PORT=8080 NODE_ENV=development
pnpm --filter @workspace/api-server run dev
```

Frontend:

```bash
export PORT=23660 BASE_PATH=/
export VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
export VITE_CLERK_PROXY_URL=
pnpm --filter @workspace/anima-protocol run dev
```

Mockup sandbox (no Clerk):

```bash
export PORT=8081 BASE_PATH=/__mockup
pnpm --filter @workspace/mockup-sandbox run dev
```

### Local reverse proxy (nginx)

To mirror Replit routing (`/` → frontend, `/api` → API), nginx listens on **3000** with config at `/etc/nginx/sites-available/anima-dev`. Open the app at `http://127.0.0.1:3000/` after both servers are up.

Reload: `sudo nginx -s reload`

### Gotchas

- `replit.md` is partly stale (guest auth / localStorage-only entities). Runtime uses **Clerk + `/api/store` + Postgres**.
- Vite configs for frontend and mockup **require** `PORT` and `BASE_PATH` at config load time.
- API `dev` script rebuilds on each start (`build` then `start`).
- pnpm may warn about ignored build scripts for `@clerk/shared`; add to `onlyBuiltDependencies` in `pnpm-workspace.yaml` if Clerk misbehaves after install.
- Cloudflare Worker `anima-protocol` must deploy from root `wrangler.jsonc` (`main` = `artifacts/api-server/src/worker.ts`). An assets-only deploy (`--assets=./dist` with no `main`) makes `/api/*` 404 on anima-protocol.com.
- Companion store "Postgres is unreachable from this host" on anima-protocol.com means the Worker has `DATABASE_URL` but no Hyperdrive path to Postgres. Create/bind Hyperdrive (`scripts/cloudflare/hyperdrive.md`); do not put the URL in `wrangler.jsonc` vars. Hyperdrive origin must be real Postgres, not Prisma Accelerate (`db.prisma.io`).
- www 301 to `https://anima-protocol.com/` (path dropped) is zone Redirect Rule **"Redirect www to root"** (`scripts/cloudflare/www-redirect.md`), not `vercel.json`. Fix the replacement to `https://anima-protocol.com/${1}`. Apex `/api/*` must still return JSON when the isolate throws.

## Analytics Tracking — Mixpanel

This project uses **Mixpanel** for all product analytics. Mixpanel is the single source of truth for event tracking, user identification, and behavioral data. Do not introduce any other analytics tools, SDKs, or tracking libraries without explicit instruction from a user.

---

## Before You Add or Modify Any Tracking

⛔ **Do not write Mixpanel tracking code without reading this file first.**

Wrong assumptions about platform, identity, or consent will produce broken Mixpanel data that requires manual cleanup or data deletion requests.

### Mandatory checklist before writing any Mixpanel code

- [ ] Use the shared wrapper in `artifacts/anima-protocol/src/lib/analytics.js` — never import `mixpanel-browser` directly in feature files
- [ ] This project does **not** route through a CDP — track via the wrapper (which uses the Mixpanel browser SDK)
- [ ] Consent gating **is required** (EU/UK/CA users). Tracking is opted-out by default; events only flow after the user accepts in `ConsentBanner`. The wrapper already enforces this — do not bypass it
- [ ] Review the existing tracking plan below before adding new events

---

## Tech Stack

| Detail | Value |
|---|---|
| **Platform** | React 19 + Vite (web), `artifacts/anima-protocol` |
| **Mixpanel SDK** | `mixpanel-browser` |
| **Tracking method** | client-side |
| **CDP (if any)** | none |
| **Consent required** | yes (EU/UK/CA — opt-out by default, opt-in on accept) |
| **Mixpanel project token location** | env var `VITE_MIXPANEL_TOKEN` (read via `import.meta.env`) |

---

## Mixpanel Initialization

**File:** `artifacts/anima-protocol/src/lib/analytics.js` (called once from `src/main.jsx`)

- Initialized with `opt_out_tracking_by_default: true` — nothing is sent until the user grants consent.
- Every wrapper function is a no-op if the token is missing or consent hasn't been granted, so feature code can call `track()` unconditionally.

**Do not:**
- Initialize Mixpanel in multiple places or create extra instances
- Import `mixpanel-browser` in feature files — always go through `analytics.js`

---

## Consent (GDPR / CCPA)

**File:** `artifacts/anima-protocol/src/components/ConsentBanner.jsx`

- The banner shows only when no decision has been recorded (`needsConsentDecision()`).
- Accept → `grantConsent()` (`mixpanel.opt_in_tracking()`); Decline → `revokeConsent()` (`mixpanel.opt_out_tracking()`).
- Mixpanel persists the decision, so the banner does not reappear on return visits.

---

## Mixpanel Identity

Identity is managed in `artifacts/anima-protocol/src/lib/AuthContext.jsx`.

| Action | When | Wrapper call |
|---|---|---|
| `identifyUser(clerkUser.id)` | After the profile loads on sign-in / session restore | `analytics.js → identifyUser` |
| `resetUser()` | On logout (before Clerk `signOut`) | `analytics.js → resetUser` |

**Rules:**
- `distinct_id` is the **Clerk user id** (stable) — never an email.
- Profile attributes (`$name`, `$email`) are set via `setProfile()` **after** `identifyUser()`, never via `track()`.
- `resetUser()` runs on every logout so the next user on the device isn't merged with the previous one.

---

## Mixpanel Tracking Plan

All new events must follow these conventions.

### Naming conventions

- Event names: `snake_case`, past tense (e.g., `message_sent`, `character_created`)
- Property names: `snake_case`
- Boolean properties: `is_` prefix (e.g., `is_crossover`)
- No PII in event properties (no emails, names, payment details)

### Current events

| Event | Trigger | Key properties | File |
|---|---|---|---|
| `sign_up_completed` | First profile load for a brand-new account | `sign_up_method`, `platform` | `src/lib/AuthContext.jsx` |
| `message_sent` | User sends a message in a chat session (**value moment** — `is_crossover` flags multi-universe scenes) | `session_mode`, `character_count`, `is_crossover`, `is_continue`, `has_attachment`, `is_therapy` | `src/pages/Chat.jsx` |
| `character_created` | A new companion is created from an AI prompt | `creation_method`, `universe`, `category` | `src/pages/CompanionGenerator.jsx` |
| `crossover_session_started` | User starts a multi-universe group session | `character_count`, `universe_count` | `src/pages/Chat.jsx` |
| `subscription_upgrade_started` | User starts a premium checkout (intent, not completion) | `tier`, `purchase_type`, `from_tier` | `src/pages/PremiumPlans.jsx` |
| `net_battle_started` | User jacks into a NetBattle match | `control_mode`, `primary_expression`, `is_blend` | `src/pages/NetBattle.jsx` |
| `net_battle_completed` | A NetBattle match ends (win or loss) | `result`, `control_mode`, `primary_expression`, `is_blend`, `chips_used`, `echo_keys_used` | `src/pages/NetBattle.jsx` |
| `echo_folder_saved` | User saves their Echo Key Folder to the profile | `folder_size`, `star_count`, `mega_count` | `src/hooks/useEchoLibrary.js` |
| `presence_stage_opened` | User opens the full-body living presence stage in chat | `session_mode`, `character_count`, `is_crossover` | `src/pages/Chat.jsx` |
| `protocol_upgrade_started` | Serenity launches a Cursor cloud agent to upgrade Protocol source | `scope`, `surface` | `src/lib/serenityProtocolUpgrade.js`, `src/components/chat/ProtocolUpgradeConsole.jsx` |
| `image_generated` | Companion (onboard Serenity or a user-created Anima) creates an image in chat | `source` (`tag` / `request` / `modal`), `is_anima`, `session_mode` | `src/pages/Chat.jsx` |
| `therapy_session_started` | User begins a therapy-mode chat with their Anima | `source` (`therapy_page` / `chat_new_session`), `is_anima`, `has_multiple_animas`, `has_topic` | `src/pages/Therapy.jsx`, `src/pages/Chat.jsx` |
| `device_scan_completed` | Anima finishes a permission-gated scan of this device for leftover / junk data | `flag_count`, `has_folder_grant`, `is_anima` | `src/lib/animaDeviceScan.js`, `src/components/anima/DeviceScanPanel.jsx` |
| `echo_key_discovered` | Operator finds, synthesises, or evolves an Echo Key in story mode | `source` (`virtual` / `field` / `synthesis` / `evolution`), `site`, `tier`, `is_outdoor` | `src/components/echoKeys/EchoStoryMode.jsx`, `src/pages/NetBattle.jsx` |

> **Value moment:** the core action is a *crossover interaction* — engaging multiple characters from different universes in one session. `message_sent` with `is_crossover: true` captures it.

---

## How to Add a New Mixpanel Event

1. **Check the plan above** — reuse an existing event if it fits; don't duplicate.
2. **Name it** with the conventions above.
3. **Only include properties available at fire time** — don't fetch extra data just for tracking.
4. **Fire after the action succeeds** (after the DB write / API response), not on button click, and after `identifyUser()` for logged-in actions.
5. **Import `track` from `@/lib/analytics`** — never the SDK directly.
6. **Update this file** with the new event.
7. **Verify in Mixpanel Live View** before considering it done.

```js
import { track } from "@/lib/analytics";

track("event_name", {
  property_name: value,
});
```

---

## What Not to Do

- **Do not introduce other analytics tools.** All tracking goes through Mixpanel via `analytics.js`.
- **Do not track on page load** unless explicitly measuring page views — events represent user actions.
- **Do not track PII** as event properties.
- **Do not fire events inside loops.**
- **Do not hardcode the project token** — it lives in `VITE_MIXPANEL_TOKEN`.
- **Do not skip `resetUser()` on logout.**
- **Do not call `identifyUser()` before the user is authenticated.**
