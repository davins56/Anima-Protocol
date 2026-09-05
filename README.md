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

### One-command dev infra (Postgres + Anima LLM)

`docker-compose.dev.yml` bundles the two infra pieces that aren't already a `pnpm dev` process — Postgres and the self-hosted Anima LLM (Ollama, branded `anima-chat` from open Qwen2.5 weights) — so both come up together instead of running `pnpm llm:up` separately:

```bash
pnpm dev:infra:up            # starts postgres + ollama, then bootstraps anima-chat
pnpm dev:infra:logs          # watch the anima-llm-bootstrap step pull weights
export DATABASE_URL=postgresql://anima:anima_dev@localhost:5432/anima_dev
pnpm --filter @workspace/db run push
```

Then start the api-server / frontend as usual (below) — they connect to this stack via `DATABASE_URL` and `ANIMA_LOCAL_LLM_BASE_URL=http://localhost:11434/v1` (the `.env.example` defaults already point here). `pnpm dev:infra:down` tears it down. GPU vLLM serving is a separate opt-in file: `scripts/llm/docker-compose.vllm.yml` (see `docs/custom-llm.md`). Deploying this to production with a public HTTPS endpoint: `docs/llm-deploy.md`.

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
| `GEMINI_API_KEY` | API | Preferred image generate/edit via Gemini Flash Image (`gemini-2.5-flash-image`). `GOOGLE_API_KEY` also accepted. Never used for chat. |
| `OPENAI_API_KEY` | API | Secondary image generate/edit (`gpt-image-1`) if Gemini is unset or fails. Never used for chat. |
| `IMAGE_FREE_FALLBACK` | API | Enable Gemini image path (default on; set `off` to disable) |
| `ANIMA_LOCAL_LLM_BASE_URL` | API | Public HTTPS OpenAI-compatible endpoint for the self-hosted Anima LLM (Ollama/vLLM). This is chat's only backend. Verify via `/api/healthz/llm` |
| `MINIMAX_API_KEY` / `ANIMA_MINIMAX_API_KEY` | API | MiniMax Global chat key. MiniMax is preferred over OpenRouter when configured; defaults to `MiniMax-M2.5` at `https://api.minimax.io/v1` |
| `ANIMA_MINIMAX_MODEL` | API | Optional MiniMax model override |
| `ANIMA_MINIMAX_BASE_URL` | API | Optional MiniMax-compatible endpoint override |
| `ANIMA_LOCAL_LLM_BACKEND` | API | `ollama` (default) or `vllm` |
| `ANIMA_OLLAMA_MODEL_LIGHT` / `_STANDARD` / `_HEAVY` | API | Ollama model tags per tier (default `anima-chat`). If the endpoint doesn't serve the tag, chat discovers a working model via `/v1/models` instead of failing — see [docs/custom-llm.md](docs/custom-llm.md) |
| `ANIMA_VLLM_MODEL_LIGHT` / `_STANDARD` / `_HEAVY` | API | vLLM model ids per tier |
| `ANIMA_OPENROUTER_MODEL_FAMILY` | API | Optional free OpenRouter family selector: `llama`, `qwen`, `mistral`, `gemma`, or `deepseek`. Exact `ANIMA_OPENROUTER_MODEL_*` overrides still win |
| `ANIMA_LOCAL_LLM_MAX_RETRIES` | API | Transport retries against the LLM host (default `2`). Covers tunnel drops and cold-start 502s; `0` disables |
| `PORT` | API, frontend, mockup | API `8080`, frontend `23660`, mockup `8081` |
| `BASE_PATH` | Frontend, mockup | `/` for main app, `/__mockup` for sandbox |
| `CLERK_PUBLISHABLE_KEY` | API | Fallback publishable key for Clerk middleware |
| `CLERK_SECRET_KEY` | API | Server-side Clerk session verification |
| `VITE_CLERK_PUBLISHABLE_KEY` | Frontend | Vite-exposed Clerk publishable key |
| `VITE_CLERK_PROXY_URL` | Frontend | Empty string in local development unless proxying Clerk |
| `VITE_MIXPANEL_TOKEN` | Frontend | Mixpanel project token |
| `API_PROXY_TARGET` | Frontend dev server | Optional override for local `/api` proxy target |
| `ELEVENLABS_API_KEY` | API | Optional TTS routes |
| `CURSOR_API_KEY` | API | Optional. Lets Serenity launch Cursor Cloud Agents that upgrade Anima Protocol source when the steward asks. Alias: `CURSOR_CLOUD_API_KEY` |
| `CURSOR_CLOUD_REPO_URL` | API | Optional. Defaults to `https://github.com/davins56/Anima-Protocol` |
| `PROTOCOL_UPGRADE_ADMIN_EMAILS` | API | Optional comma-separated steward emails. Defaults to `davins56@gmail.com,davins56@hotmail.com` |

Sign-in offers Google, Apple, and GitHub via Clerk OAuth (`oauth_google`, `oauth_apple`, `oauth_github`). Enable each social connection in the Clerk Dashboard. Provider apps must allowlist `https://clerk.anima-protocol.com/v1/oauth_callback`; Clerk → Paths uses `/sign-in/sso-callback` and `/sign-up/sso-callback`.

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
