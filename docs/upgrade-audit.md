# Anima Protocol — upgrade & fix audit

**Date:** 2026-09-07  
**Baseline:** `4574e0e` on `main` (`fix(llm): drop MiniMax-only provider pin so local can enter the chain` / #388)  
**Production:** `https://anima-protocol.com` (Cloudflare Worker `anima-protocol`)  
**Method:** repo read of routing, Worker config, store/schema, Codespace, TTS, auth; `gh` CI/PR history; live `curl` of `/api/healthz*`; `pnpm audit`.

This is a plan, not a rewrite. **P0-1 through P0-4 are implemented** in the follow-up PR (fail-closed local chat, gated `POST /api/healthz/schema`, Codespace terminal opt-in + steward, durable `ANIMA_LOCAL_LLM_*` Secrets Store bindings). Remaining P1/P2 items stay open.

---

## Executive summary — top 5 actions

1. **Make the home-tunnel LLM durable and fail-closed.** Production already chats via `llm.anima-protocol.com` (`preferred: "local"`, `chain: ["local"]`). That URL is **not** in `wrangler.jsonc` `secrets_store_secrets`. The next `wrangler deploy` can drop a dashboard-only secret and silently put OpenRouter back on the chain. Create store entries, add bindings in the same commit, set `ANIMA_LLM_PROVIDER=custom`.
2. **Lock chat to self-hosted Anima only in code.** `getProviderChain()` still implements MiniMax / Deepshi / OpenRouter. Owner intent is Ollama/vLLM via `ANIMA_LOCAL_LLM_*` only. Gate the cloud hops; stop recommending them in errors and docs.
3. **Close two unauthenticated / over-privileged API surfaces.** `POST /api/healthz/schema` runs DDL with no auth. `POST /api/repo-codespace/terminal` runs arbitrary shell for any signed-in user on hosts with a repo filesystem.
4. **Restore operator docs that the code still cites.** `docs/llm-build.md`, `docs/llm-deploy.md`, and `docs/vercel-api-migration.md` were deleted in `772ef67` (2026-08-22) and are now 404s from `docs/custom-llm.md`, `lib/llm/README.md`, and `llmFailover.ts`.
5. **Fix the 20s Worker wall on LLM health probes** so `?probe=1` stops reporting a fake “Database connection timed out” when the home Ollama box is just slow.

---

## Product constraints (verified)

| Constraint | Status |
|------------|--------|
| Self-hosted Anima LLM only for chat (Ollama/vLLM) | **Intent, not code.** Live prod uses the named Cloudflare Tunnel. Code + `wrangler.jsonc` still keep OpenRouter as the unbound-local fallback. |
| No Fly.io GPU budget; home machine + Cloudflare Tunnel | **Live.** `/api/healthz/llm` reports `host=llm.anima-protocol.com`. `scripts/llm/public-v1/` is the matching runbook. `deploy/ollama-fly/` is optional always-on, not required. |
| Stay on Cloudflare Workers + React | **Correct.** No Next.js-only blocker found. Incremental upgrades on Express + `worker.ts` + Vite. |
| Steward collectibles (#374) and Sacred Space voice (#386) | **Shipped.** Do not re-open as product work. Remaining notes are integrity holes / ops, not “build the feature.” |

---

## Live production snapshot (2026-09-07)

| Endpoint | Result |
|----------|--------|
| `GET /api/healthz` | `{ status: "ok" }` |
| `GET /api/healthz/env` | Clerk secret + publishable + `DATABASE_URL` present |
| `GET /api/healthz/llm` | `preferred: "local"`, `host: llm.anima-protocol.com`, `hasV1Path: true`, `isHttps: true`, `isCloudFlagship: false`, `chain: ["local"]`, `customOnly: false`, OpenRouter configured (`minimax/minimax-m2.7:free`, `keyTail` present), MiniMax/Deepshi **not** configured |
| `GET /api/healthz/db` | Hyperdrive, schema ok, all required tables present, `hasPgTrgm: true` |
| `GET /api/healthz/schema` | Same schema inspect, public |
| `GET /api/healthz/llm?probe=1` | HTTP 503 after ~20s: `{ error: "Database connection timed out", code: "ETIMEOUT" }` — **misclassified Worker wall**, not a down database (plain `/healthz/db` is ok) |
| `GET https://www.anima-protocol.com/api/healthz` | 301 → `https://anima-protocol.com/api/healthz` (**path kept**; `scripts/cloudflare/www-redirect.md` is stale) |

Affirmations / Hyperdrive / schema inspect (PR #303 era): **healthy on this snapshot.** `user_entities` is present; no missing-table list.

---

## Recent hypotheses — confirm or discard

| Theme | Verdict |
|-------|---------|
| LLM routing / healthz / local-only | **Partly fixed.** #388 dropped `ANIMA_LLM_PROVIDER=minimax`, so a bound local URL now wins. **Not** local-only: `customOnly: false`, OpenRouter still bound, cloud hops still in `llmFailover.ts`. |
| Affirmations Add / DB / Hyperdrive schema | **Discard as open outage.** Prod schema is complete. Remaining: public `POST /healthz/schema`, 8s store list vs `ensureSchemaOnce` on cold start. |
| Codespace upload/pull/repo editing | **Not dead UI.** Worker has no repo FS by design (`filesystem_unavailable` + Pull CTA). Real hole: authenticated `POST /terminal` `exec()` on Node/Replit hosts. |
| Secrets Store / wrangler bindings surviving deploys | **Confirmed residual risk.** Clerk/DB/OpenRouter are declared. `ANIMA_LOCAL_LLM_BASE_URL` / `ANIMA_LOCAL_LLM_API_KEY` are **not**. Dashboard-only secrets are dropped on the next git deploy (`wrangler.jsonc` comments + `wranglerConfig.test.ts`). |
| Sacred Space TTS (#386) | **Shipped.** Session voice uses `POST /api/tts` + Web Speech fallback. Do not re-propose. Separate leftover: `VoiceCloneManager` still posts to ElevenLabs with a placeholder key. |

---

## P0 — broken / insecure / data-loss (fix now)

### P0-1 — Next Worker deploy can unbind the live Anima LLM

**What’s wrong:** Production chat depends on `ANIMA_LOCAL_LLM_BASE_URL=https://llm.anima-protocol.com/v1`, but that name is intentionally **absent** from `wrangler.jsonc` `secrets_store_secrets`. Comments and tests treat the Fly/tunnel URL as “add later.” It is already live. A deploy that omits the binding unbinds dashboard secrets; `/api/healthz/llm` would show `localEndpoint.configured: false` and `getProviderChain()` would put OpenRouter first (`OPENROUTER_API_KEY` is bound; `ANIMA_OPENROUTER_FREE=true`).

**Where:** `wrangler.jsonc` (vars + `secrets_store_secrets`); `artifacts/api-server/test/wranglerConfig.test.ts` (asserts local URL **must not** be bound); `artifacts/api-server/src/lib/llmFailover.ts` `getProviderChain()`; `deploy/ollama-fly/README.md` ordered runbook.

**Why it matters:** One git push can move every chat turn from the home Anima LLM to OpenRouter `:free` without a code change. That violates local-only intent and burns a quota the owner does not want as the brain.

**Approach:**

1. Confirm store `a31e40473ef34db896b5bc1e6c1c4b86` already has `ANIMA_LOCAL_LLM_BASE_URL` and `ANIMA_LOCAL_LLM_API_KEY`. If not, **create the secret_name first** (a binding for a missing name fails `wrangler deploy` and takes the site down).
2. Same commit: add the two `{ binding, store_id, secret_name }` objects; set `"ANIMA_LLM_PROVIDER": "custom"` in `vars`; drop or ignore `ANIMA_OPENROUTER_FREE` for chat.
3. Update `wranglerConfig.test.ts` to expect the new bindings and `custom` pin.
4. Verify: `curl -sS 'https://anima-protocol.com/api/healthz/llm?probe=1'` → `preferred=local`, `chain=["local"]`, `customOnly=true`.

**Effort:** S (ops + config) once store entries exist.

### P0-2 — Cloud chat hops are still a live code path

**What’s wrong:** Docs and `TODO.llm.md` claim the cloud failover chain was deleted. It was not. `createChatStreamWithFailover` / `createChatCompletionWithFailover` still try `local` → `minimax` → `deepshi` → `openrouter`. `ANIMA_LLM_PROVIDER=minimax|deepshi` still pins away from local. `preferCustomLlmOnly()` exists but is **unset** in production (`customOnly: false`).

**Where:** `artifacts/api-server/src/lib/llmFailover.ts` (`getProviderChain`, `shouldTryNextProvider`, `noProviderConfiguredError`); `artifacts/api-server/src/lib/openaiClient.ts` (`getMinimaxClient`, `getDeepshiClient`, OpenRouter cascade); call sites in `routes/chat.ts`, `evolutionEngine.ts`, `animaJournal.ts`, `proactiveMessages.ts`, `repoCodespace.ts`. Deepshi wired in #383. AnimaLLM class in `lib/llm/src/client.ts` is **not** on this path (CLI-only).

**Why it matters:** Any missing local URL, or a future `ANIMA_OPENROUTER_FALLBACK=true`, sends companion chat to a third-party API. Error strings still tell operators to set `MINIMAX_API_KEY` / `OPENROUTER_API_KEY`.

**Approach:** Treat `ANIMA_LLM_PROVIDER=custom|local|anima|local-only` (or a new `ANIMA_CHAT_LOCAL_ONLY=true`) as fail-closed: chain is `["local"]` or `[]`. Do not call MiniMax/Deepshi/OpenRouter from chat. Keep `OPENAI_API_KEY` / Gemini for **image** routes only. Rewrite `noProviderConfiguredError()` to name the tunnel runbook, not cloud keys.

**Effort:** M (routing + tests that currently encode cloud fallback as correct).

### P0-3 — Unauthenticated `POST /api/healthz/schema` runs DDL

**What’s wrong:** Health router is mounted **before** Clerk. `POST /healthz/schema` calls `ensureSchemaOnce()` (`CREATE IF NOT EXISTS`). Tests require this to stay public (`artifacts/api-server/test/appHealth.test.ts`).

**Where:** `artifacts/api-server/src/app.ts` (health before `safeClerkMiddleware`); `artifacts/api-server/src/routes/health.ts` (`POST /healthz/schema`); `lib/db/src/ensure-schema.ts`.

**Why it matters:** Anyone on the internet can trigger schema ensure against production Hyperdrive (DoS, lock contention, surprise DDL). Comment claims “safe because IF NOT EXISTS” — that is still unauthenticated admin capability.

**Approach:** Keep `GET /healthz` and `GET /healthz/schema` public. Require `Authorization: Bearer` matching `ADMIN_MIGRATION_SECRET` or `CRON_SECRET` on POST. Update `appHealth.test.ts`.

**Effort:** S.

### P0-4 — Authenticated Codespace terminal is arbitrary shell on Node hosts

**What’s wrong:** `POST /api/repo-codespace/terminal` `exec(command, { cwd: getRepoRoot() })` for any Clerk user. `/files` checks `probeRepoRoot()`; **terminal / write-file / delete-file / read-file do not**. Path guards on file APIs do not apply to the shell.

**Where:** `artifacts/api-server/src/routes/repoCodespace.ts` (router `requireUser`, then `POST /terminal`); mounted from `routes/index.ts` on the Worker too.

**Why it matters:** On Replit / local Node / any host with `REPO_ROOT` or a `pnpm-workspace.yaml` walk, a signed-in user gets RCE as the API process. Cloudflare Workers likely fail closed (no real FS / `exec`), so apex risk is lower — still ship the guard so a future Node deploy is not a foot-gun.

**Approach:** Disable `/terminal` when `ANIMA_RUNTIME=worker` or `probeRepoRoot()` is false. Steward-only (or remove the route). Add the same FS probe to write/delete. Do not implement a “safe command allowlist” that still shells out.

**Effort:** M.

---

## P1 — high-value upgrades (reliability, self-host LLM, UX)

### P1-1 — Home-tunnel SLA and honest health probes

**What’s wrong:** The Worker 20s wall applies to `/api/healthz*` (`shouldTimeoutApiPath`). A live `?probe=1` against CPU Ollama on a tunnel exceeds that. `WorkerApiTimeoutError.code = "ETIMEOUT"` is then classified as a **database** timeout in `dbErrors.ts`, so operators see “Database connection timed out” while `/healthz/db` is fine.

**Where:** `artifacts/api-server/src/lib/workerApiGuard.ts`; `artifacts/api-server/src/lib/dbErrors.ts` (`code === "ETIMEOUT"`); `health.ts` `GET /healthz/llm`.

**Why it matters:** The free path is a home box + `cloudflared`. When the box sleeps or the first load is slow, diagnostics lie. Chat itself is exempt from the 20s wall (`isLongLivedApiPath`), so the probe is worse than the real turn.

**Approach:** Exempt `/api/healthz/llm` from the 20s race when `probe=1`, or stop classifying `WorkerApiTimeoutError` as DB. Document that the tunnel dies if the origin / `cloudflared` stops (`scripts/llm/public-v1/README.md` already says this). Do **not** recommend paying for Fly GPU.

**Effort:** S.

### P1-2 — Reconcile docs with local-only reality

**What’s wrong:** `docs/custom-llm.md` contradicts itself (MiniMax/OpenRouter “preferred” vs “there is only one backend”). It links to three deleted files (`docs/llm-build.md`, `docs/llm-deploy.md`, `docs/vercel-api-migration.md` — deleted in `772ef67`). `TODO.llm.md` Step 21 claims the cloud chain was deleted and then tells operators to set `ANIMA_LLM_PROVIDER=openai`. `lib/llm/src/registry.ts` comments say `ANIMA_LLM_PROVIDER` is never read. `AGENTS.md` still describes Vercel as the production API host; apex is Workers.

**Where:** `docs/custom-llm.md`; `TODO.llm.md`; `lib/llm/README.md`; `lib/llm/src/registry.ts`; `AGENTS.md` (Vercel vs Worker); `scripts/cloudflare/www-redirect.md` (zone rule now keeps `${1}` — live 301 preserves `/api/healthz`).

**Why it matters:** Operators (and future agents) will re-enable OpenRouter/MiniMax or chase 404 docs.

**Approach:** One story: chat = `ANIMA_LOCAL_LLM_BASE_URL` only; images may still use Gemini/OpenAI; restore or redirect the deleted deploy/fine-tune docs from git history; fix www-redirect.md to match the live rule.

**Effort:** M (restore + edit). Restoring the three deleted files from `772ef67^` is S if they are still accurate.

### P1-3 — Tests currently lock in the wrong production policy

**What’s wrong:** `llmRoutingServerless.test.ts` expects Worker + OpenRouter key + no local URL → `chain: ["openrouter"]`. `wranglerConfig.test.ts` forbids binding the live local URL and requires `ANIMA_OPENROUTER_FREE=true`. `llmFailover.test.ts` treats MiniMax/OpenRouter failover as success.

**Where:** `artifacts/api-server/test/wranglerConfig.test.ts`; `llmFailover.test.ts`; `llmRoutingServerless.test.ts`.

**Why it matters:** A correct local-only PR will “fail CI” until these expectations flip.

**Approach:** Split “legacy cloud-chain unit tests” (keep as documentation of the old path, or delete with the hops) from “production policy”: Worker + custom pin + bound local URL → `["local"]`; missing local → empty chain + setup error, never OpenRouter.

**Effort:** M.

### P1-4 — CORS reflects any origin with credentials

**What’s wrong:** `app.use(cors({ credentials: true, origin: true }))`.

**Where:** `artifacts/api-server/src/app.ts`.

**Why it matters:** Browser clients send `Authorization: Bearer` (not cookies) today, which limits classic CSRF. If Clerk cookies are ever sent cross-site, this is an open redirector for credentialed API reads.

**Approach:** Allowlist `https://anima-protocol.com`, `http://localhost:23660`, `http://127.0.0.1:3000`, optional Vercel preview hosts.

**Effort:** S.

### P1-5 — Public healthz leaks operator fingerprints

**What’s wrong:** `/api/healthz/llm` returns OpenRouter `keyTail`. `/api/healthz/clerk` returns Clerk key tails + JWKS kids. `/api/healthz/db` and `/schema` return Hyperdrive host / database id.

**Where:** `llmFailover.ts` `getLlmRoutingStatus`; `clerkDiagnostics.ts`; `dbErrors.ts` `databaseTargetHint`; `health.ts`.

**Why it matters:** Useful for the steward; useful for an attacker comparing dashboard values. Not full secrets.

**Approach:** Keep `GET /healthz` and `GET /healthz/env` (booleans) public. Gate `/healthz/clerk`, `/healthz/db`, `/healthz/llm?probe=1` behind the same ops bearer as schema POST, **or** strip `keyTail` / `target.host` from unauthenticated responses.

**Effort:** M.

### P1-6 — Steward collectibles are client-enforced only

**What’s wrong:** #374 is done and should not be re-proposed as a feature. Remaining hole: `PUT /api/store/profile` writes arbitrary JSON. Client `normalizeEchoLibrary` / fragment / crystal helpers honor `granted_full_library` / `granted_all_types` without re-checking steward on the server. Inventory grant is the same pattern.

**Where:** `artifacts/api-server/src/routes/store.ts` `PUT /profile`; `artifacts/anima-protocol/src/lib/echoKeys/rules.js`; `energyFragments/library.js`; `memoryCrystals/library.js`; `useStewardInventoryGrant.js`.

**Why it matters:** Any signed-in user can persist grant flags and unlock the full Codex. Not cross-tenant data loss; it is a privilege bypass on a steward-only promise.

**Approach:** Server-side steward check (email/user id from Clerk claims). Strip grant flags on profile write for non-stewards. Do not expand the collectible set.

**Effort:** L.

### P1-7 — Store export/import still on the 8s budget

**What’s wrong:** Companion create got 20s (#371–373). `exportData` / `bulkImport` / `restoreData` still use `STORE_FETCH_TIMEOUT_MS` (8s) in `base44Client.js`. First authenticated store hit also runs `ensureSchemaOnce()` under that budget.

**Where:** `artifacts/anima-protocol/src/lib/storeTimeouts.js`; `artifacts/anima-protocol/src/api/base44Client.js`; `artifacts/api-server/src/routes/store.ts` (`ensureSchemaMiddleware`).

**Why it matters:** Large accounts fail backup/restore while creates succeed. Cold-start list can still abort.

**Approach:** Dedicated 60–120s timeout for `/export`, `/import`, `/restore`. Optional warmup `POST /healthz/schema` (once gated) so the first user list is not the DDL burst.

**Effort:** S.

### P1-8 — Voice clone UI is a broken ElevenLabs client

**What’s wrong:** `VoiceCloneManager` `fetch`es `https://api.elevenlabs.io/v1/text-to-speech/...` with `"xi-api-key": "YOUR_ELEVENLABS_API_KEY"`. Mounted from Characters / Anima voice panel. Sacred Space itself is fine (`useSacredSpaceVoice` → `/api/tts`).

**Where:** `artifacts/anima-protocol/src/components/characters/VoiceCloneManager.jsx`.

**Why it matters:** Dead control that looks like a leaked key. Preview should go through `POST /api/tts` like `speakToAnima.js`, or hide until a clone API exists.

**Effort:** S–M.

### P1-9 — SSRF surface on operator LLM URL

**What’s wrong:** `ANIMA_LOCAL_LLM_BASE_URL` is env-only (good). Loopback and flagship hosts (`api.openai.com`, `openrouter.ai`, `api.minimax.io`, …) are blocked on the Worker. RFC1918, link-local, and `169.254.169.254` are not. HTTPS is not required if someone binds an HTTP internal URL.

**Where:** `artifacts/api-server/src/lib/openaiClient.ts` (`localLlmBaseUrl`, `CLOUD_FLAGSHIP_LLM_HOSTS`).

**Why it matters:** Compromised deploy env or a typo can make the isolate fetch an internal IP with the tunnel bearer.

**Approach:** After parse (and ideally after DNS), deny private/metadata ranges; require HTTPS when `ANIMA_RUNTIME=worker`; optional `ANIMA_LOCAL_LLM_HOST_ALLOWLIST=llm.anima-protocol.com`.

**Effort:** M.

### P1-10 — Cron + subscription stubs

**Cron:** `GET /api/proactive/run` with `Authorization: Bearer ${CRON_SECRET}` (`notifications.ts`). GET + non-timing-safe compare. Switch to POST + `crypto.timingSafeEqual`. Effort: S.

**Checkout:** `createCheckoutSession` returns `{ url: null, error: "Payments not configured..." }`; client looks for `checkout_url` and `functions.invoke` can return `null` silently (`openai/functions.ts`, `SubscriptionPlans.jsx`). Hide Premium checkout or implement Stripe — do not leave a fake pay wall. Effort: S to hide, L to charge.

### P1-11 — Intimacy engine silent failures

**What’s wrong:** Pulse is wired (#377–378) behind adult setting + per-character `intimacyEnabled` (default false) + not therapy. `intimacyClient` save/patch failures are `console.error` / `null` (dock looks broken). `docs/intimacy-engine.md` still reads like a merge checklist (“copy remaining files from the drop-in pack”).

**Where:** `artifacts/api-server/src/lib/intimacyEngine.ts`; `intimacyStore.ts`; `chat.ts`; `artifacts/anima-protocol/src/lib/intimacyClient.js`; `docs/intimacy-engine.md`.

**Approach:** Toast on PATCH failure; use `apiUrl()` + `authHeaders()`; update the doc to “shipped, gated.” Align crossover `adultAllowed: false` on the server.

**Effort:** M.

---

## P2 — polish / debt

| ID | What’s wrong | Where | Approach | Effort |
|----|--------------|-------|----------|--------|
| P2-1 | `AnimaLLM` client unused by api-server; defaults to localhost + `OPENAI_API_KEY` | `lib/llm/src/client.ts` | Mark CLI-only or delete | S |
| P2-2 | `llmEnsemble.ts` dead; still calls OpenAI chat | `artifacts/api-server/src/lib/llmEnsemble.ts` | Delete; `localEnsemble.ts` is the live multi-draft path | S |
| P2-3 | `useSeedCharacters.ts` calls nonexistent `/api/seed-characters` | `artifacts/anima-protocol/src/hooks/useSeedCharacters.ts` | Delete | S |
| P2-4 | Root `pnpm lint` is `echo 'No lint errors'` | `package.json`, `.github/workflows/ci.yml` | Wire ESLint or drop the job | S |
| P2-5 | CI does not run `@workspace/llm` tests | `.github/workflows/ci.yml` | Add `pnpm --filter @workspace/llm run test` | S |
| P2-6 | Unused / heavy frontend deps: `moment`, `leaflet`/`react-leaflet`, `react-markdown` (no imports), `lodash` | `artifacts/anima-protocol/package.json` | Remove if bundle analysis confirms | S |
| P2-7 | `pnpm audit`: 6 high / 2 moderate, all **transitive `fast-uri` via ajv** (`@hookform/resolvers`, `vite-plugin-pwa` / workbox). Not in the chat request path | lockfile | Bump ajv/workbox when convenient; not a P0 | S |
| P2-8 | Three.js / R3F on battle + vessel orbs — large Worker Assets payload | `NetBattleScene3D.jsx`, `AnimaVessel*.jsx`, `AnimaOrb.tsx` | Route-level `lazy()` if not already; no rewrite | M |
| P2-9 | Chat is text + italic split, not markdown. `react-markdown` unused. XSS surface is low today | `renderItalicText.jsx` | Keep text-only; if markdown ships, DOMPurify | S |
| P2-10 | `GET /api/storage/objects/uploads/:id` has no auth (POST does) | `routes/storage.ts` | Intentional for `<img src>` avatars; use signed URLs if uploads become private | M |
| P2-11 | Default steward emails hardcoded | `protocolUpgrade.ts`, `echoKeys/steward.js` | Env-only allowlist in prod | S |
| P2-12 | ElevenLabs upstream error text forwarded (300 chars) | `routes/elevenlabs.ts` | Generic client message | S |
| P2-13 | Codespace live writes only `console.error` | `pages/Codespace.jsx` `persistNow` | Toast on sustained failure | S |
| P2-14 | Affirmation Add can show local-only rows before store seed | `affirmationStore.js` | Badge local IDs; disable Add until profile load | S |
| P2-15 | `TODO.md` leftover “verify typecheck”; app source has almost no `TODO`/`FIXME` | `TODO.md` | Close or delete | S |
| P2-16 | `ELEVENLABS_API_KEY` / `SUPERMEMORY_API_KEY` / `CRON_SECRET` / `VAPID_*` not in `secrets_store_secrets` | `wrangler.jsonc` | Add only after store entries exist (same ordered runbook) | ops S |
| P2-17 | Recent main CI: #383/#382/#377 failed typecheck (`memoryEmbeddings.ts` `string` vs `MemoryType`); fixed in #384. No open GitHub issues | `gh run list` | Keep typecheck in CI; optional pre-commit | — |
| P2-18 | Manual LLM ops still open (curate Serenity logs, QLoRA, DPO, quantize) | `TODO.llm.md` | Keep as GPU/data work, not app P0 | L (human + GPU) |

---

## Do not do

- **Do not** adopt ChatGPT, Claude, Gemini, Groq, MiniMax, Deepshi, or OpenRouter as the chat backend — including “BYOK” or “just for failover.” Image generate/edit may keep Gemini/OpenAI.
- **Do not** set `ANIMA_OPENROUTER_FALLBACK=true` to paper over a down tunnel. Fail the turn; wake the home box.
- **Do not** put `ANIMA_LOCAL_LLM_BASE_URL` in `wrangler.jsonc` `vars` (committed URL, or a stale Fly host, would skip/break routing). Bind via Secrets Store only.
- **Do not** add a `secrets_store_secrets` row for a `secret_name` that does not exist yet — `wrangler deploy` fails and the Worker (the whole site) goes down.
- **Do not** point `ANIMA_LOCAL_LLM_BASE_URL` at `api.openai.com` / OpenRouter / MiniMax. The client already flags those as `isCloudFlagship`.
- **Do not** rewrite the app in Next.js / Vercel-only / Anthropic Agents. No blocker was found that only Next solves. Apex is already Workers + Assets + Express.
- **Do not** fund or require Fly.io GPU for chat. Document the home + named tunnel path; keep `deploy/ollama-fly/` as an optional always-on CPU host if someone later wants it.
- **Do not** re-open steward collectibles (#374) or Sacred Space natural voice (#386) as greenfield features. Only fix remaining holes (client-side grants, VoiceCloneManager).
- **Do not** create a dedicated Affirmations SQL table. Rows are `user_entities` (`entity_name: "Affirmation"`); schema inspect is already green.
- **Do not** treat `lib/llm` `AnimaLLM` as the production chat client until it is wired through `llmFailover` (it is not).
- **Do not** “fix” www path-dropping by adding a Worker route — live zone Redirect Rule already keeps `/api/healthz`. Update the markdown only.

---

## Suggested follow-up PR order

1. **Config/ops (S):** Secrets Store entries + `wrangler.jsonc` bindings + `ANIMA_LLM_PROVIDER=custom` + test expectation flip. Verify healthz after deploy.
2. **Auth surfaces (S–M):** Gate `POST /healthz/schema`; disable Codespace `/terminal` on Worker / missing FS; CORS allowlist; cron POST + timing-safe compare.
3. **Local-only code (M):** Fail-closed `getProviderChain()`; strip cloud hints from chat errors; flip serverless routing tests.
4. **Docs (M):** Restore deleted LLM deploy/build pages; rewrite `docs/custom-llm.md` to one backend; fix `TODO.llm.md` / `AGENTS.md` Worker-vs-Vercel drift; mark intimacy doc as shipped.
5. **UX reliability (S–M):** Store export timeouts; VoiceCloneManager → `/api/tts`; intimacy toasts; healthz probe timeout classification.
6. **Integrity (L):** Server-side steward grants — only if collectible cheating shows up in the wild.

---

## What this audit did **not** change

No application code in this PR. P0 items above need their own reviews and tests (`pnpm --filter @workspace/api-server run test` / `typecheck` for API; frontend suite if VoiceCloneManager or store timeouts move).

CI on `main` at baseline is green (`4574e0e`, run `34139454106`). Earlier same-day failures (#383, #382, #377) were the embeddings typecheck, already fixed by #384.

---

## Evidence index

| Claim | Evidence |
|-------|----------|
| Prod chat is local tunnel | Live `/api/healthz/llm`: `preferred=local`, `host=llm.anima-protocol.com`, `chain=["local"]` |
| Not fail-closed | Same payload: `customOnly: false`, `openrouter.configured: true` |
| MiniMax pin removed | `wrangler.jsonc` has no `ANIMA_LLM_PROVIDER`; #388; `wranglerConfig.test.ts` asserts the comment |
| Local URL not durable | `secrets_store_secrets` = Clerk ×2 + `DATABASE_URL` + `OPENROUTER_API_KEY` only |
| Cloud hops live | `getProviderChain()` in `llmFailover.ts` |
| Schema POST public | `health.ts` + `app.ts` mount order + `appHealth.test.ts` |
| Terminal `exec` | `repoCodespace.ts` `POST /terminal` |
| Deleted docs | `git log --diff-filter=D` → `772ef67` |
| Probe lie | Live `?probe=1` → `ETIMEOUT` / “Database connection timed out”; `/healthz/db` 200 |
| www path | Live `www` 301 Location includes `/api/healthz` |
| No open issues | `gh issue list` empty; recent work is PRs #369–#388 |
| XSS in chat | `renderItalicText.jsx` text nodes only; no `ReactMarkdown` imports |
| Audit noise | `pnpm audit` → transitive `fast-uri` via ajv, not chat |
