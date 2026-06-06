# Anima Protocol

Sovereign AI companions with persistent memory, multi-character crossover sessions, and psychologically rich resonance controls.

Anima Protocol is a pnpm monorepo for a full-stack AI companion platform. The current foundation includes a React/Vite frontend, an Express API, Clerk authentication, Drizzle/Postgres persistence, Mixpanel analytics with consent gating, and a mockup sandbox for isolated UI work. The next product layer is persistent companion memory, distinct character impersonation, group chat, and Serenity-style resonance experiences.

## Architecture

```mermaid
flowchart LR
  user[User] --> web[React + Vite app<br/>artifacts/anima-protocol]
  web --> api[Express API<br/>artifacts/api-server]
  web --> mixpanel[Mixpanel<br/>consent-gated analytics]
  web --> clerk[Clerk frontend auth]
  api --> clerk_api[Clerk session verification]
  api --> openai[OpenAI]
  api --> eleven[ElevenLabs optional TTS]
  api --> db[(PostgreSQL<br/>Drizzle schema in lib/db)]
  mockup[Mockup sandbox<br/>artifacts/mockup-sandbox] --> web
```

## Current Status

The repo already has the core application scaffold:

- React 19 + Vite frontend in `artifacts/anima-protocol`
- Express API in `artifacts/api-server`, mounted under `/api`
- Shared Drizzle/Postgres package in `lib/db`
- Generic user-scoped entity persistence via `user_entities`
- Legacy/simple conversation and message tables for `/api/openai/conversations`
- Clerk auth foundation for frontend and API routes
- Mixpanel analytics through `artifacts/anima-protocol/src/lib/analytics.js`
- Consent banner enforcing opt-in analytics behavior
- Optional mockup sandbox at `artifacts/mockup-sandbox`

Active product work should focus on the core loop: create companion, start chat, retrieve memory, generate in-character response, persist the turn, and track crossover value moments.

## Project Structure

```text
Anima-Protocol/
|-- artifacts/
|   |-- anima-protocol/      # Main React + Vite app
|   |-- api-server/          # Express API for /api/*
|   `-- mockup-sandbox/      # Isolated UI previews at /__mockup
|-- lib/
|   |-- db/                  # Drizzle schema and database helpers
|   |-- api-client-react/    # Shared API client package
|   `-- api-spec/            # Shared API specification package
|-- scripts/                 # Utility scripts
|-- AGENTS.md                # Detailed development and analytics instructions
|-- package.json             # Root workspace scripts
|-- pnpm-workspace.yaml      # Workspace packages, catalog, overrides
`-- README.md
```

## Tech Stack

| Layer | Technology |
| --- | --- |
| Frontend | React 19, Vite, Tailwind CSS, Radix UI, framer-motion, React Query, zod |
| Backend | Node 24, Express 5, Clerk middleware, OpenAI SDK |
| Database | PostgreSQL, Drizzle ORM, drizzle-kit |
| Auth | Clerk |
| Analytics | Mixpanel browser SDK through the shared consent-gated wrapper |
| Package manager | pnpm workspaces |
| Optional services | ElevenLabs TTS, object storage |

## Quick Start

Read `AGENTS.md` before changing runtime setup, analytics, or auth behavior. It contains the environment-specific instructions and Mixpanel tracking rules.

Use Node 24 before running workspace commands:

```bash
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
export PATH="$NVM_DIR/versions/node/v24.16.0/bin:$PATH"
```

Install dependencies with pnpm only:

```bash
pnpm install --frozen-lockfile
```

For local Postgres development:

```bash
export DATABASE_URL=postgresql://anima:anima_dev@localhost:5432/anima_dev
pnpm --filter @workspace/db run push
```

## Running Services

Start the API:

```bash
export DATABASE_URL=postgresql://anima:anima_dev@localhost:5432/anima_dev
export OPENAI_API_KEY=sk-...
export CLERK_PUBLISHABLE_KEY=pk_test_...
export CLERK_SECRET_KEY=sk_test_...
export PORT=8080
export NODE_ENV=development
pnpm --filter @workspace/api-server run dev
```

Start the frontend:

```bash
export PORT=23660
export BASE_PATH=/
export VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
export VITE_CLERK_PROXY_URL=
export VITE_MIXPANEL_TOKEN=...
pnpm --filter @workspace/anima-protocol run dev
```

The current Vite config proxies local `/api` calls to `http://localhost:8080` by default. Set `API_PROXY_TARGET` if the API runs elsewhere. If you use the local nginx reverse proxy, open `http://127.0.0.1:3000/` after the API and frontend are both running.

Start the mockup sandbox:

```bash
export PORT=8081
export BASE_PATH=/__mockup
pnpm --filter @workspace/mockup-sandbox run dev
```

## Environment Variables

| Variable | Used by | Notes |
| --- | --- | --- |
| `DATABASE_URL` | API, Drizzle push | PostgreSQL connection string |
| `OPENAI_API_KEY` | API | Required at API import time for OpenAI routes |
| `PORT` | API, frontend, mockup | API `8080`, frontend `23660`, mockup `8081` |
| `BASE_PATH` | Frontend, mockup | `/` for main app, `/__mockup` for sandbox |
| `CLERK_PUBLISHABLE_KEY` | API | Fallback publishable key for Clerk middleware |
| `CLERK_SECRET_KEY` | API | Server-side Clerk session verification |
| `VITE_CLERK_PUBLISHABLE_KEY` | Frontend | Vite-exposed Clerk publishable key |
| `VITE_CLERK_PROXY_URL` | Frontend | Empty string in local development unless proxying Clerk |
| `VITE_MIXPANEL_TOKEN` | Frontend | Mixpanel project token |
| `API_PROXY_TARGET` | Frontend dev server | Optional override for local `/api` proxy target |
| `ELEVENLABS_API_KEY` | API | Optional TTS routes |

Apple and GitHub login buttons use Clerk OAuth strategies (`oauth_apple` and `oauth_github`). Enable both social connections in the Clerk Dashboard for the active Clerk application; no additional frontend environment variables are required.

## Validation

```bash
pnpm run typecheck
pnpm --filter @workspace/anima-protocol run test
pnpm --filter @workspace/api-server run build
PORT=23660 BASE_PATH=/ VITE_CLERK_PUBLISHABLE_KEY=pk_test_... pnpm --filter @workspace/anima-protocol run build
```

The root build runs typecheck and every package build. Because the mockup sandbox Vite config requires `PORT` and `BASE_PATH`, export those variables before using `pnpm run build`.

## Analytics

Mixpanel is the only product analytics system in this repo. Feature code must import from `@/lib/analytics`, never from `mixpanel-browser` directly.

Current tracked events include:

- `sign_up_completed`
- `message_sent`
- `character_created`
- `crossover_session_started`
- `subscription_upgrade_started`

The core value moment is `message_sent` with `is_crossover: true`, which represents a multi-character or cross-universe interaction. New analytics events should be added only after checking the tracking plan in `AGENTS.md`; consent gating and no-PII rules are mandatory.

## Product Roadmap

Highest-value next work:

1. Core chat and memory backend: session-aware chat routes, companion-specific memory retrieval, response streaming, and durable message persistence.
2. Companion creation surfaces: prompt-to-companion generation with user-scoped storage, personality, universe, voice, avatar seed, and system prompt.
3. Crossover session management: multi-character sessions, distinct voices, shared context, per-character memory, and group interaction tracking.
4. Resonance settings: tone, intensity, memory depth, boundaries, and crossover preferences.
5. Deployment polish: frontend deployment config, CI for typecheck/build, package-level `.env.example` files, and rate-limit hardening for chat.

## Deployment Notes

The frontend can be deployed independently when configured with the required Vite environment variables. The API needs Clerk keys, `OPENAI_API_KEY`, and a reachable Postgres database. Same-origin `/api/*` routing can be handled by the hosting platform, a reverse proxy, or the Vite dev proxy during local development.

**Production (Vercel):** the frontend and Express api-server deploy together — root `server.mjs` serves `/api/*` on Vercel Fluid compute. Copy `DATABASE_URL`, `CLERK_SECRET_KEY`, and `OPENAI_API_KEY` from Replit Secrets into Vercel environment variables (no Replit republish required). See [docs/vercel-api-migration.md](docs/vercel-api-migration.md).

**Netlify (GitHub merge checks only):** If you deploy on **Vercel**, you do not need Netlify hosting — but the **Netlify GitHub App** may still post checks on PRs. Root `netlify.toml` plus `artifacts/anima-protocol/netlify.toml` cover both repo-root and package-base Netlify sites. To stop Netlify from blocking merges: GitHub **Settings → Integrations → Netlify** → configure linked sites, or remove Netlify from **branch protection** required checks. **Continuous AI** checks are from Continue.dev; remove them from required checks if the agent errors. Required checks that matter for this repo: **CI** (`checks`) and **Vercel**.

## License

MIT
