# Anima Protocol

An emotionally intelligent AI companion app with persistent memory, sci-fantasy worldbuilding, and multi-character crossover sessions.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080, proxied to `/api`)
- `pnpm --filter @workspace/anima-protocol run dev` — run the frontend (port 23660, proxied to `/`)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — deployment build (API bundle + frontend)
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string
- Required env: `ANIMA_LOCAL_LLM_BASE_URL` — public HTTPS OpenAI-compatible chat endpoint (Ollama/vLLM)
- Optional env: `OPENAI_API_KEY` — image generate/edit only (not chat)
- Required env: `CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` — Clerk auth (see `AGENTS.md`)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React 19 + Vite + Tailwind CSS, react-router-dom
- API: Express 5 (mounted under `/api`)
- DB: PostgreSQL + Drizzle ORM (`user_entities` for characters and progress)
- Auth: Clerk (Google + GitHub required; Apple optional)
- Analytics: Mixpanel via consent-gated wrapper (`src/lib/analytics.js`)
- Chat LLM: self-hosted Anima LLM (Ollama/vLLM) — no cloud chat fallback
- Production: Vercel serves frontend + `api/index.mjs` for `/api/*`

## Where things live

- `artifacts/anima-protocol/src/` — React frontend
- `artifacts/anima-protocol/src/lib/AuthContext.jsx` — Clerk session + Mixpanel identity
- `artifacts/anima-protocol/src/lib/analytics.js` — Mixpanel wrapper (consent-gated)
- `artifacts/api-server/src/` — Express API routes
- `lib/db/src/schema/` — Drizzle schema (`user_entities`, conversations, messages)
- `scripts/src/verify-clerk-oauth.ts` — Clerk OAuth + redirect URL verification

## Architecture decisions

- Entity data (characters, quests, memories, etc.) is scoped by Clerk `user_id` in Postgres via `/api/store` — not localStorage
- Chat uses the self-hosted Anima LLM (`ANIMA_LOCAL_LLM_BASE_URL`); `OPENAI_API_KEY` is for image features only
- Production Clerk uses a custom domain (`clerk.anima-protocol.com`) — no `/api/__clerk` proxy on `www.anima-protocol.com`
- Vercel runs the Express API as a single Serverless Function at `api/index.mjs`

## Gotchas

- `replit.md` was historically stale about guest auth / localStorage — runtime uses **Clerk + `/api/store` + Postgres**
- Vite configs require `PORT` and `BASE_PATH` at config load time
- `VITE_CLERK_PUBLISHABLE_KEY` must be set at **build** time on Vercel
- See `AGENTS.md` for full environment, OAuth, and Mixpanel tracking rules

## Pointers

- `AGENTS.md` — authoritative dev setup, Clerk OAuth, Mixpanel plan
- `docs/vercel-api-migration.md` — Replit → Vercel API migration
- `docs/clerk-github-login.md` — Google/GitHub/Apple OAuth checklist
- `docs/custom-llm.md` — self-hosted Anima LLM configuration
