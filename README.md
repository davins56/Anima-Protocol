# Anima Protocol

### Your AI shouldn't forget who it is.

**Anima Protocol** is an open-source platform for creating persistent, evolving AI companions with memory, identity, personality, voice, multimodal generation, and multi-character crossover conversations.

**Live app:** https://anima-protocol.com

Traditional AI chats preserve context.

**Anima Protocol is designed to preserve identity.**

## Why Anima?

Anima Protocol explores what happens when an AI companion is treated as a persistent character rather than a disposable chat session. The platform is being built around durable memory, distinct personalities, user-controlled resonance settings, and multi-character experiences where each companion can retain an individual voice and history.

### Core capabilities

- 🧠 Persistent companion memory architecture
- 🎭 User-created AI identities and personalities
- 🌌 Multi-character crossover sessions
- 💬 Real-time conversational experiences
- 🎨 AI image generation and editing
- 🔊 Optional text-to-speech voices
- 🧬 Resonance controls for tone, intensity, memory depth, and boundaries
- 🏠 Self-hosted Anima LLM support through Ollama or vLLM
- 🔐 User-scoped persistence and authentication
- 📊 Consent-gated product analytics

> **Project status:** active alpha development. The application foundation is in place, while persistent memory, companion creation, crossover orchestration, and resonance systems remain active product work.

## Architecture

```mermaid
flowchart LR
  user[User] --> web[React + Vite app<br/>artifacts/anima-protocol]
  web --> api[Express API<br/>artifacts/api-server]
  web --> mixpanel[Mixpanel<br/>consent-gated analytics]
  web --> clerk[Clerk frontend auth]
  api --> clerk_api[Clerk session verification]
  api --> animaLlm[Anima LLM<br/>Ollama/vLLM open weights]
  api --> geminiImages[Gemini Flash Image<br/>preferred image generation/editing]
  api --> openaiImages[OpenAI gpt-image-1<br/>fallback image path]
  api --> eleven[ElevenLabs optional TTS]
  api --> db[(PostgreSQL<br/>Drizzle schema in lib/db)]
  mockup[Mockup sandbox<br/>artifacts/mockup-sandbox] --> web
```

## Tech Stack

| Layer | Technology |
| --- | --- |
| Frontend | React 19, Vite, Tailwind CSS, Radix UI, framer-motion, React Query, zod |
| Backend | Node 24, Express 5, Clerk middleware |
| Database | PostgreSQL, Drizzle ORM, drizzle-kit |
| Local AI | Ollama or vLLM with OpenAI-compatible endpoints |
| Image generation | Gemini Flash Image with OpenAI image fallback |
| Voice | ElevenLabs optional TTS |
| Analytics | Mixpanel through a consent-gated wrapper |
| Package manager | pnpm workspaces |

## Quick Start

### Prerequisites

- Node 24
- pnpm
- Docker, if using the bundled local Postgres + Anima LLM development stack

Clone and install:

```bash
git clone https://github.com/davins56/Anima-Protocol.git
cd Anima-Protocol
pnpm install --frozen-lockfile
```

Start the bundled development infrastructure:

```bash
pnpm dev:infra:up
```

Initialize the local database:

```bash
export DATABASE_URL=postgresql://anima:anima_dev@localhost:5432/anima_dev
pnpm --filter @workspace/db run push
```

Start the API:

```bash
export DATABASE_URL=postgresql://anima:anima_dev@localhost:5432/anima_dev
export PORT=8080
export NODE_ENV=development
pnpm --filter @workspace/api-server run dev
```

Start the frontend in a second terminal:

```bash
export PORT=23660
export BASE_PATH=/
pnpm --filter @workspace/anima-protocol run dev
```

For environment-specific authentication, analytics, AI-provider, and deployment configuration, read `AGENTS.md` and the documentation under `docs/` before changing runtime behavior.

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
|-- docs/                    # Architecture and deployment documentation
|-- scripts/                 # Utility scripts and local AI infrastructure
|-- AGENTS.md                # Detailed development and analytics instructions
|-- package.json             # Root workspace scripts
|-- pnpm-workspace.yaml      # Workspace packages, catalog, and overrides
`-- README.md
```

## Current Foundation

The repository already includes:

- React 19 + Vite frontend in `artifacts/anima-protocol`
- Express API in `artifacts/api-server`, mounted under `/api`
- Shared Drizzle/Postgres package in `lib/db`
- User-scoped entity persistence
- Conversation and message persistence foundations
- Clerk authentication for frontend and API routes
- Consent-gated Mixpanel analytics
- Local Anima LLM infrastructure through Ollama/vLLM
- Gemini and OpenAI image-generation paths
- Optional ElevenLabs TTS
- Isolated mockup sandbox for UI experimentation

The highest-value product loop is:

**create companion → start chat → retrieve memory → generate in-character response → persist the turn → deepen continuity**

## Validation

```bash
pnpm run typecheck
pnpm --filter @workspace/anima-protocol run test
pnpm --filter @workspace/api-server run build
PORT=23660 BASE_PATH=/ pnpm --filter @workspace/anima-protocol run build
```

The root `pnpm run build` is deployment-oriented. Use `pnpm run build:all` when you explicitly need the full workspace typecheck and package build sequence.

## Product Roadmap

1. **Persistent companion memory** — session-aware chat routes, companion-specific retrieval, durable message persistence, and memory controls.
2. **Companion creation** — prompt-to-companion generation with personality, universe, voice, avatar seed, and system prompt.
3. **Crossover sessions** — multi-character conversations with distinct voices, shared context, and per-character memory.
4. **Resonance settings** — user-controlled tone, intensity, memory depth, boundaries, and crossover preferences.
5. **Deployment hardening** — CI, rate limiting, observability, environment validation, and production reliability.

## Analytics

Mixpanel is the product analytics system in this repository. Feature code should import analytics through the shared consent-gated wrapper rather than directly from the browser SDK.

Important product events include:

- `sign_up_completed`
- `message_sent`
- `character_created`
- `crossover_session_started`
- `subscription_upgrade_started`
- `protocol_upgrade_started`

Consent gating and no-PII rules are mandatory. See `AGENTS.md` for the tracking plan.

## Deployment

The frontend can be deployed independently when configured with the required Vite environment variables. The API requires a reachable PostgreSQL database, authentication configuration, and access to the configured Anima LLM endpoint.

Production deployment documentation is available in `docs/`, including the Vercel API migration and custom LLM deployment guides.

## Contributing

Contributions are welcome. See [`CONTRIBUTING.md`](CONTRIBUTING.md) for setup expectations, pull request guidance, and suggested entry points for new contributors.

If you are looking for a place to begin, check issues labeled `good first issue`, `help wanted`, `documentation`, or `enhancement`.

## License

Anima Protocol is licensed under the [MIT License](LICENSE).
