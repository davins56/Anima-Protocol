<<<<<<< HEAD
# Anima Protocol

An emotionally intelligent AI companion app with persistent memory, sci-fantasy worldbuilding, and 40+ interconnected entities.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080, proxied to /api)
- `pnpm --filter @workspace/anima-protocol run dev` — run the frontend (proxied to /)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string (auto-provisioned)
- Required env: `OPENAI_API_KEY` — OpenAI API key (stored as secret)
=======
>>>>>>> 0b3b5d864406894277048e73490f474d3e169079
# [Project name]

_Replace the heading above with the project's name, and this line with one sentence describing what this app does for users._

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
<<<<<<< HEAD
- Frontend: React + Vite + Tailwind CSS, react-router-dom (proxied to `/`)
- API: Express 5 (proxied to `/api`)
- DB: PostgreSQL + Drizzle ORM (`conversations` and `messages` tables)
- AI: OpenAI via `OPENAI_API_KEY` secret (gpt-4o for chat, gpt-4o for functions)
- Entity storage: localStorage via `base44Client.js` (40+ entity types, no DB needed)

## Where things live

- `artifacts/anima-protocol/src/` — React frontend (177 source files, 40+ pages)
- `artifacts/anima-protocol/src/api/base44Client.js` — localStorage-backed entity store + auth stub
- `artifacts/anima-protocol/src/api/animaApi.js` — API client for OpenAI conversation routes
- `artifacts/anima-protocol/src/lib/AuthContext.jsx` — Auth stub (always logged in as guest user)
- `artifacts/api-server/src/routes/openai/index.ts` — Conversation CRUD + streaming SSE chat
- `artifacts/api-server/src/routes/openai/functions.ts` — 40+ AI function handlers (invoke/:fnName)
- `artifacts/api-server/src/routes/index.ts` — Router + placeholder image endpoint
- `lib/db/src/schema/index.ts` — Drizzle schema for conversations + messages tables

## Architecture decisions

- Entity data (characters, quests, memories, etc.) lives in localStorage — no DB migration needed for 40+ entity types
- AI chat uses real OpenAI streaming via SSE; all other AI functions route through `/api/openai/invoke/:fnName`
- Auth is a guest stub — always logged in as a guest user, no login flow required
- `Landing.jsx` was renamed to `Landing.tsx` because it contains TypeScript generics; all other pages are plain JSX
=======
>>>>>>> 0b3b5d864406894277048e73490f474d3e169079
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

_Populate as you build — non-obvious choices a reader couldn't infer from the code (3-5 bullets)._

## Product

_Describe the high-level user-facing capabilities of this app once they exist._

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

<<<<<<< HEAD
- The AI disclosure modal shows on first visit only (stored in localStorage). Clicking "I Understand & Accept" dismisses it permanently.
- `src/main.tsx` is an empty stub — the real entry is `src/main.jsx` loaded from `index.html`
- Placeholder images served at `/api/placeholder/:w/:h` as SVG
=======
>>>>>>> 0b3b5d864406894277048e73490f474d3e169079
_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
