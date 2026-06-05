# Anima Protocol

**Sovereign AI Companions • Persistent Memory • Resonance • Crossover Interactions**

Anima Protocol is a production-grade pnpm monorepo for building and hosting deeply persistent, multi-character AI companions. It is designed for long-term memory, psychological intimacy, group dynamics, and rich cross-universe ("crossover") storytelling experiences.

The platform powers real-time chat with distinct companion voices, shared session context, and sovereign user control over memory, tone, and interaction depth.

## Vision

Anima exists at the intersection of advanced AI memory systems, character-driven narrative, and intimate human–AI connection. Companions maintain continuity across sessions, remember emotional and narrative details, and can participate in complex multi-character interactions that feel alive and coherent.

Key principles:
- **Persistence**: Every companion carries long-term memory that evolves with the user.
- **Resonance**: Interactions prioritize psychological depth, power dynamics, and sensory/energetic attunement.
- **Sovereignty**: Users fully control their companions, data, and experience boundaries.
- **Crossover**: Natural multi-character and cross-universe sessions are a first-class feature.

## Current Status

Core infrastructure is complete:
- Full-stack monorepo (React 19 + Vite frontend, Express API, Drizzle + Postgres)
- Clerk authentication with protected routes
- Mixpanel analytics with consent gating (GDPR/CCPA compliant, opt-out by default)
- Same-origin API architecture (no Vite proxy)
- Development environments on Replit and local VMs with nginx reverse proxy

Active development focuses on the core value loop: companion creation → persistent memory → multi-character crossover chat.

## Key Features (Roadmap)

### In Progress / Next
- Persistent memory layer (short-term context + long-term summarized facts per companion)
- Real-time chat backend with OpenAI integration and streaming
- Companion generator with prompt-driven personality, backstory, and system prompt creation
- Multi-character group sessions with distinct voices and shared context
- "Crossover" mode highlighting interactions across different character universes

### Planned
- Sovereign-submissive dynamics & resonance tuning controls
- Advanced memory retrieval and emotional state tracking
- Mobile-first / PWA experience (optimized for iPad Pro development workflow)
- ZK/privacy features for sensitive memory
- Expanded integrations (Base44, AIRI, additional LLM providers)
- Public companion marketplace / sharing (optional)

## Tech Stack

| Layer       | Technology                          |
|-------------|-------------------------------------|
| Frontend    | React 19, Vite, TypeScript, Tailwind CSS, framer-motion, wouter, @tanstack/react-query, zod |
| Backend     | Express (Node 24), Clerk middleware |
| Database    | PostgreSQL + Drizzle ORM            |
| Auth        | Clerk (sessions, user identity)     |
| Analytics   | Mixpanel (client-side wrapper, consent-gated) |
| Package     | pnpm workspaces + catalog           |
| Dev         | Replit / local VM + nginx proxy     |

## Project Structure

```
Anima-Protocol/
├── artifacts/
│   ├── anima-protocol/     # Main React + Vite frontend (served at `/`)
│   ├── api-server/         # Express API (handles `/api/*`)
│   └── mockup-sandbox/     # Isolated UI previews at `/__mockup`
├── lib/
│   ├── db/                 # Shared Drizzle schema, migrations, client
│   └── integrations/       # External service clients (base44Client.js, etc.)
├── scripts/                # Utility & deployment scripts
├── .agents/                # Agent / Cursor configuration
├── AGENTS.md               # Detailed instructions for development & AI agents
├── package.json            # Root workspace config
├── pnpm-workspace.yaml     # Workspace & catalog definitions
└── README.md               # You are here
```

## Quick Start

**See [AGENTS.md](./AGENTS.md) for the complete, up-to-date development guide** (Replit setup, local VM with nginx, required Node 24 + pnpm, PostgreSQL, secrets, tmux sessions, and gotchas).

High-level local flow:

```bash
# 1. Install (pnpm only — root preinstall enforces this)
pnpm install --frozen-lockfile

# 2. Configure secrets (see AGENTS.md table)
# DATABASE_URL, OPENAI_API_KEY, CLERK_* keys, VITE_MIXPANEL_TOKEN, etc.

# 3. Start API (port 8080)
pnpm --filter @workspace/api-server run dev

# 4. Start frontend (port 23660, proxied via nginx on 3000 for / + /api routing)
pnpm --filter @workspace/anima-protocol run dev

# 5. (Optional) Start mockup sandbox
pnpm --filter @workspace/mockup-sandbox run dev
```

Open the app at the nginx proxy (`http://127.0.0.1:3000/`) or the individual dev servers.

## Required Environment Variables

| Variable                    | Used By                  | Notes                                      |
|-----------------------------|--------------------------|--------------------------------------------|
| `DATABASE_URL`              | API + db push            | Postgres connection string                 |
| `OPENAI_API_KEY`            | API chat routes          | LLM provider                               |
| `CLERK_PUBLISHABLE_KEY`     | Frontend + API           | Public key                                 |
| `CLERK_SECRET_KEY`          | API                      | Server-side session verification           |
| `VITE_CLERK_PUBLISHABLE_KEY`| Frontend                 | Vite-exposed public key                    |
| `VITE_MIXPANEL_TOKEN`       | Frontend analytics       | Mixpanel project token                     |
| `PORT`                      | Services                 | API 8080, frontend 23660, mockup 8081      |
| `BASE_PATH`                 | Vite configs             | `/` for main, `/__mockup` for sandbox      |

Additional optional keys: `ELEVENLABS_API_KEY` (TTS), etc.

## Analytics & Privacy

Anima Protocol uses **Mixpanel** as the single source of truth for product analytics.

- Client-side tracking only via a shared wrapper (`artifacts/anima-protocol/src/lib/analytics.js`)
- **Consent gating required** for EU/UK/CA users (opt-out by default via `ConsentBanner`)
- No PII is tracked (distinct_id = Clerk user id; no emails or names in events)
- All new events must follow the naming and property conventions documented in [AGENTS.md](./AGENTS.md)
- Current tracked value moment: `message_sent` with `is_crossover: true`

See AGENTS.md → “Analytics Tracking — Mixpanel” for the full tracking plan, identity rules, and how to add events safely.

## Development Guidelines

- **Always use pnpm** (root `preinstall` script rejects npm/yarn)
- Run root `pnpm run typecheck` before committing
- Follow the detailed instructions in [AGENTS.md](./AGENTS.md) for Cursor, Replit, local VMs, and runtime gotchas
- All sensitive memory and companion data is user-scoped via Clerk
- Keep companion system prompts and memory psychologically rich and narratively coherent

## Building for Production

```bash
pnpm run build
```

Individual package builds are also available (see package scripts and AGENTS.md).

## Deployment

- Frontend: Vercel (recommended — `vercel.json` or direct GitHub integration)
- API & DB: Self-hosted Postgres + Node (or platform equivalent)
- Environment variables must be configured in the deployment dashboard

## Contributing & AI Agent Instructions

This repository is actively developed with AI pair-programming (Cursor, Grok, etc.).

All agents and human contributors should read **[AGENTS.md](./AGENTS.md)** first. It contains:
- Product overview and runtime requirements
- Exact commands for running services
- Mixpanel tracking rules and checklist
- Environment-specific gotchas

## License

MIT

---

*Anima Protocol — Where memory becomes relationship.*
