# AGENTS.md

## Cursor Cloud specific instructions

### Product overview

**Anima Protocol** is a pnpm monorepo: React/Vite frontend (`artifacts/anima-protocol`), Express API (`artifacts/api-server`), shared Drizzle DB package (`lib/db`), and optional **Mockup Sandbox** (`artifacts/mockup-sandbox`) for isolated UI previews at `/__mockup`.

The frontend calls same-origin `/api/*` (see `animaApi.js`, `base44Client.js`). The current Vite dev server proxies `/api` to `http://localhost:8080` by default (`API_PROXY_TARGET` overrides it). nginx on port 3000 is also preconfigured in this VM when you want to mirror Replit-style routing through a single local origin.

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

### Required secrets (full stack)

| Variable | Used by |
|----------|---------|
| `DATABASE_URL` | API + `db push` |
| `OPENAI_API_KEY` | API (import-time check) |
| `PORT` | API `8080`, frontend `23660`, mockup `8081` |
| `BASE_PATH` | Frontend `/`, mockup `/__mockup` |
| `VITE_CLERK_PUBLISHABLE_KEY` | Frontend (build/dev) |
| `CLERK_PUBLISHABLE_KEY` | API `clerkMiddleware` |
| `CLERK_SECRET_KEY` | API session verification |
| `VITE_CLERK_PROXY_URL` | Frontend (empty string in dev) |
| `VITE_MIXPANEL_TOKEN` | Frontend analytics |

Without valid **Clerk** keys, API routes under `/api` return Clerk errors (middleware runs before handlers). The main app also fails to load Clerk JS until real keys are configured.

Optional: `ELEVENLABS_API_KEY` for TTS routes.

### Lint / test / build

No ESLint script at repo root. Validation workflows from `.replit`:

| Task | Command |
|------|---------|
| Typecheck (all packages) | `pnpm run typecheck` |
| Unit tests (no DB/API) | `pnpm --filter @workspace/anima-protocol run test` |
| Build API | `pnpm --filter @workspace/api-server run build` |
| Build frontend | `PORT=23660 BASE_PATH=/ VITE_CLERK_PUBLISHABLE_KEY=... pnpm --filter @workspace/anima-protocol run build` |
| Root `pnpm run build` | Also builds mockup-sandbox — needs `PORT` + `BASE_PATH` for that package |

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
| `message_sent` | User sends a message in a chat session (**value moment** — `is_crossover` flags multi-universe scenes) | `session_mode`, `character_count`, `is_crossover`, `is_continue`, `has_attachment` | `src/pages/Chat.jsx` |
| `character_created` | A new companion is created from an AI prompt | `creation_method`, `universe`, `category` | `src/pages/CompanionGenerator.jsx` |
| `crossover_session_started` | User starts a multi-universe group session | `character_count`, `universe_count` | `src/pages/Chat.jsx` |
| `subscription_upgrade_started` | User starts a premium checkout (intent, not completion) | `tier`, `purchase_type`, `from_tier` | `src/pages/PremiumPlans.jsx` |

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
