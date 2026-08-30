# Threat Model

## Project Overview

Anima Protocol is a public React + Vite web application backed by an Express API and PostgreSQL. It provides an AI companion/chat experience, user-scoped entity storage, streaming chat completions, and optional AI helper functions such as image editing and context processing. The production deployment is public (`https://anima-protocol.com`), TLS is platform-managed, `NODE_ENV` is assumed to be `production`, and `artifacts/mockup-sandbox` is treated as dev-only unless production reachability is shown.

## Assets

- **User chat content and companion history** — conversation titles, prompts, messages, and generated replies can contain sensitive personal reflections and private worldbuilding.
- **User-scoped app state** — characters, quests, memories, profile data, and backups stored through `/api/store` represent the user’s persistent account data.
- **Provider-backed capabilities** — OpenAI and ElevenLabs API access are financially sensitive assets because unauthenticated use can consume quota, money, or service availability.
- **Application secrets** — API keys and Clerk secrets would enable impersonation of the app to upstream providers if exposed.

## Trust Boundaries

- **Browser ↔ API (`artifacts/anima-protocol` → `artifacts/api-server`)** — all client input is untrusted and must be authenticated and authorized server-side.
- **API ↔ PostgreSQL (`@workspace/db`)** — route handlers can read and mutate persisted chat and store data; missing auth or query scoping exposes all tenants.
- **API ↔ third-party AI providers** — `artifacts/api-server/src/routes/openai/*`, `elevenlabs.ts`, and `characterImage.ts` cross from public requests into paid or external services.
- **Public ↔ authenticated surfaces** — `/api/healthz`, placeholder assets, and any explicitly public lookup endpoints are low-trust; chat persistence, user context, image edit, and store sync must be authenticated.
- **Dev-only ↔ production** — `artifacts/mockup-sandbox` is not production-reachable by default and should usually be ignored in scans.

## Scan Anchors

- **Primary production API entrypoint:** `artifacts/api-server/src/app.ts` and `artifacts/api-server/src/routes/index.ts`
- **Highest-risk areas:** `artifacts/api-server/src/routes/openai/index.ts`, `artifacts/api-server/src/routes/openai/functions.ts`, `artifacts/api-server/src/routes/store.ts`
- **Authenticated surface:** `/api/store/*`, `/api/openai/image-edit`, and user-context functions that derive `userId` from Clerk
- **Public or mixed surface needing repeated review:** `/api/openai/*`, `/api/character-image`, `/api/tts`, `/api/voices`
- **Usually out of scope:** `artifacts/mockup-sandbox/**`, test-only code, generated/dist output unless it proves production drift

## Threat Categories

### Spoofing

Clerk is the identity boundary for the production app. Any endpoint that returns or mutates user data, or that spends paid provider quota on a user’s behalf, must derive identity from the verified Clerk session on the server. UI-only protection is insufficient because the deployment is publicly reachable.

### Tampering

The client submits arbitrary JSON for chat, entity state, backup restore, and helper-function inputs. The server must enforce ownership on every mutation and must never let an unauthenticated caller create, replace, or delete chat or store records that belong to another user or to a global shared namespace.

### Information Disclosure

The most sensitive disclosure risk is chat and memory data returned from API routes without user scoping. API responses and logs must avoid exposing chat transcripts, profile data, or upstream provider errors in ways that leak account data or secrets. Public helper endpoints must not become alternate paths to retrieve private user context.

### Denial of Service

Publicly reachable endpoints that trigger OpenAI or other expensive upstream work are a denial-of-wallet and availability risk even when basic IP rate limiting exists. Expensive AI routes need authentication, narrow allowlists, and rate limiting that survives multi-instance deployments and botnet-style source rotation.

### Elevation of Privilege

The highest-risk privilege failures here are broken access control on chat APIs and any route that reaches the database or paid providers without a validated session. All persisted chat queries must be scoped per user, and all AI function endpoints that invoke OpenAI with attacker-controlled input must require authenticated callers or another strong authorization boundary.
