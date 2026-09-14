# Chat latency + identity-loop audit

**Date:** 2026-09-14 (updated: latency first)  
**Baseline:** `main` @ `f005e052`  
**Owner priority:** AI response speed — **TTFT**, then end-to-end chat latency. Identity loop and Worker timeout/CI stay in this document, below latency.

Findings only. No runtime code in this PR.

Complements `docs/upgrade-audit.md` (#389, LLM/security). Do **not** duplicate open [#450](https://github.com/davins56/Anima-Protocol/pull/450) (Worker ETIMEOUT ≠ DB).

---

## 0. Latency verdict (read this first)

Chat **does stream**. The UI is not waiting for a full reply before painting tokens (`streamChatReply` + SSE deltas). It **feels** slow because **first SSE byte is late**, then **prefill is huge**, then **generation is allowed to run to 4–8k tokens**.

User-perceived timeline for `POST /api/chat/messages` (production Chat.jsx):

```
[click send]
  client builds a large systemPrompt (character sheet + 14 msgs + lore + memory…)
  POST /chat/messages
    ensureSchemaOnce
    beginChatTurn + retry leftover turns          ← DB, before any SSE
    load characters, memories, embeddings
    supermemory HTTP (if enabled)
    world-knowledge HTTP (≤1.5s, fail-open)
    repository RAG (up to 400 files on Node)     ← every non-empty turn
    evolution / relationship / arc / intimacy
    composePrompt wraps ≤24k of client prompt
                                              ← still no SSE byte
    writeHead SSE + heartbeat                     ← first network byte
    open local Ollama stream (budget 35s, or 80s
      if chain includes OpenRouter :free)         ← cold load lives here
    first content delta                           ← TTFT the user feels
    …stream tokens…
    done → client persist                         ← E2E “can send again”
```

Telemetry (`ChatPipelineTelemetry`) records `context_load_ms` and `ttft_ms`, but **`ttft_ms` starts at `startGeneration()`** — after context load. Logs understate user-perceived TTFT. Look at `context_load_ms + repository_rag_ms + prompt_build_ms + ttft_ms`.

### Teammate hypotheses — verified

| Hypothesis | Verdict |
|------------|---------|
| Waiting on full replies instead of streaming | **Mostly false.** Main path streams. Exceptions: opt-in `ANIMA_LOCAL_LLM_ENSEMBLE` (off by default, waits for N full drafts); image gen after the reply; `max_tokens` 4–8k so E2E stays long even when TTFT is fine. |
| Oversize context / memory retrieval | **True, and worse than memory alone.** Client prompt (up to 24k chars) is wrapped *again* by `composePrompt`, which then adds character def, memories, resonance, CORE_BEHAVIOR. Prefill dominates small local models. |
| Worker ~20s wall | **Does not race `/api/chat`.** `isLongLivedApiPath` exempts `/api/openai` and `/api/chat`. The 20s wall is store/healthz. Cold Ollama still sits behind a **35s** (or **80s** if OpenRouter is on the chain) *stream-open* budget. [#450](https://github.com/davins56/Anima-Protocol/pull/450) caps **`/api/ai/chat`** at 18s — **Chat.jsx does not use that route.** |
| Cold Ollama | **True, ops + retries.** `ANIMA_LOCAL_LLM_MAX_RETRIES` defaults to **2**. Home-box first load can eat most of the open budget. `wrangler.jsonc` has `ANIMA_OPENROUTER_FALLBACK=true` + `ANIMA_OPENROUTER_FREE=true`, so `usesFreeTierOpenBudget()` is true whenever OpenRouter is on the chain → **80s** open wait on `/chat/messages` before abort. |

---

## P0 — chat speed (do these first)

### P0-L1 — First SSE byte before context load (TTFT)

**What’s wrong:** `chat.ts` `POST /messages` loads schema, turns, characters, memories, embeddings, optional supermemory, world weather, **repository RAG**, evolution/rel/arc, intimacy, then `composePrompt` — **then** `res.writeHead` SSE. The client shows typing with **zero tokens** for all of that.

**Where:** `artifacts/api-server/src/routes/chat.ts` (~1360–1676). Contrast: `preStreamPersist` is already after `writeHead` (good). Context load is not.

**Why it matters:** This is the only TTFT work entirely in app code. Cold Hyperdrive + RAG + weather can add seconds before Ollama is even called.

**Approach:** `writeHead` + heartbeat immediately after auth + session 404 check. Run context load while the client already has an open stream (`status: "loading"`). Do not wait on repository RAG or weather to *start* the LLM; inject them only if they finish before `createChatStreamWithFailover`, else skip.

**Effort:** S–M. Stay off `workerApiGuard.ts` / `dbErrors.ts` (#450).

### P0-L2 — Stop double-prefill (TTFT + E2E)

**What’s wrong:** Chat.jsx builds a full character sheet, 14×800-char history (`Story so far:`), lore, CharacterMemory, echo lore, behavior sliders. Server wraps that as `CLIENT_SCENE_CONTEXT` **sliced to 24,000 chars**, then adds `buildCharacterDefinition` (3k), memory block (2.4k), resonance, voice, CORE_BEHAVIOR again. `buildLlmChatMessages` skips store history when it sees `Story so far:` — so you still pay the client transcript *inside the system prompt*.

**Where:** `artifacts/anima-protocol/src/pages/Chat.jsx` (~1428–1821); `artifacts/api-server/src/lib/promptBuilder.ts` `composePrompt` (`slice(0, 24_000)`), `BUDGET`, `clientOwnsTranscript`.

**Why it matters:** Prefill time on Qwen/anima-chat 3B is the dominant TTFT once the stream is open. Duplicating identity + history is free latency.

**Approach:** Send a **thin** client payload (speaker id, hidden-sequences, length guide) and let `composePrompt` own identity + last-N store messages. Or: if client already sent a sheet, do not wrap 24k and do not add a second CHARACTER block. Cap client `system_prompt` hard (e.g. 4k). Drop repository RAG from the default chat path (`ANIMA_REPOSITORY_RAG` is already skippable; today it runs on every non-empty turn in `chat.ts`).

**Effort:** S for “don’t wrap 24k + skip repo RAG”; M to move Chat.jsx off the fat prompt.

### P0-L3 — Cap generation length; don’t use the 80s free-tier open budget on Chat.jsx (E2E + hung typing)

**What’s wrong:**

1. `routeModel` → `maxTokens` 4096 (light) / **8192** (standard/heavy). `classifyComplexity` treats **≥200 characters or ≥30 words as heavy**. Ordinary companion turns hit 8192 `max_tokens`. Length guide already asks for 2–4 sentences.
2. Production `wrangler.jsonc`: `ANIMA_OPENROUTER_FALLBACK=true` + `ANIMA_OPENROUTER_FREE=true`. Chat.jsx calls `llmOpenTimeoutMs({ freeTierCascade: usesFreeTierOpenBudget() })` → **80s** stream-open if local is cold, then OpenRouter :free. Browser abort is **130s** (`CHAT_STREAM_TIMEOUT_MS`). First-chunk wait is **50s** (`LLM_STREAM_FIRST_CHUNK_MS`) — sized for DeepSeek R1 think, not anima-chat.
3. Local SDK retries default **2** (`openaiClient.ts` `localLlmMaxRetries`).

**Where:** `modelRouter.ts` `MAX_TOKENS` / `isHighStakesMessage`; `chat.ts` `openStreamAbort`; `chatTimeouts.ts`; `animaApi.js` `CHAT_STREAM_TIMEOUT_MS=130_000`; `wrangler.jsonc` fallback/free vars.

**Why it matters:** Even a fast first token feels slow if the model is allowed 8k tokens. Cold local + 80s open is “chat is broken,” not “chat is generating.”

**Approach (avoid #450 file fights):** In `chat.ts` only: pass `freeTierCascade: false` so `/chat/messages` uses 35s (or a dedicated 12–18s local-open if you add a constant in chat.ts without rewriting `chatTimeouts.ts`). Cap `maxTokens` for this route (e.g. `Math.min(routed.maxTokens, 1024)`). Lower Chat.jsx length guide is already short — the server budget is what Ollama honors.

**#450 overlap:** that PR changes `chatTimeouts.ts` / `llmFailover.ts` for `/api/ai/chat`. Rebase after it merges; do not copy those edits here. Chat.jsx speed is `/api/chat/messages`.

**Ops (not a code PR):** keep Ollama loaded (`keep_alive`, a 1-token warmup cron against `llm.anima-protocol.com`). `ANIMA_LOCAL_LLM_MAX_RETRIES=0` on a single-slot box.

### P0-L4 — Memory retrieval is not the first TTFT knob (but don’t grow it)

`retrieveRelevantMemories` is in-process scoring (topK 12, last 24 turn crumbs). `attachStoredEmbeddings` is a DB read of JSON vectors. That is cheaper than the 24k client wrap + repo RAG. **Do not** “fix speed” by deleting companion memory. Finish P0-L1/L2 first. Identity-loop P1 below still matters for *quality* of recall, not the first-token budget.

---

## P1 — identity loop (after a faster chat)

Unchanged findings. Production Chat is client-persist; `companion_memories` is not what Chat.jsx prompts from.

```
create   POST /api/store/Character|Anima     no companion_memories row
session  POST /api/store/ChatSession
send     Chat.jsx fat systemPrompt
         POST /api/chat/messages persist:false persistence_owner:client
stream   composePrompt wraps it; SSE; chat_turns checkpoint
persist  user_entities ChatMessage, then commitTurn
memory   transcript crumbs in companion_memories
         next Chat.jsx turn still uses CharacterMemory (every 6 solo msgs)
```

| Gap | Where |
|-----|--------|
| `GET /chat/memories/:id` unused by SPA | `chat.ts`; Chat.jsx `loadCharacterMemories` → `characterMemory` invoke |
| Create does not seed memory | `createCompanion.js` |
| `commitTurn` skips typed `chat_messages` | `chat.ts` vs `persistLedgerTurn` — breaks `proactiveMessages` |
| Facts are turn dumps, not distilled identity | `upsertTurnMemory` vs `extractCharacterMemories` |
| `ChatExperienceNucleus` persist:true path unused | not mounted in ProtocolApp |

---

## P2 — crossover / resonance (after identity)

- Scene Mind heuristics already skip extra HTTP (Chat.jsx ~1650). Good for TTFT.
- `promptBuilder` **filters memories to the speaker** despite a comment that crossover shares the pool.
- Echo Keys: static lore blurb; synchro does **not** change Key radiation.
- `resonance_memories` not in `ensure-schema` (fail-soft).
- Hidden Sequences weather/jack-in live; no persisted dark-route field.

---

## Do not collide

| Item | Status |
|------|--------|
| [#450](https://github.com/davins56/Anima-Protocol/pull/450) Worker ETIMEOUT ≠ DB; `/api/ai/chat` 18s open | **Open.** Do not edit `dbErrors.ts`, `workerApiGuard.ts`, `chatTimeouts.ts`, `llmFailover.ts` until it lands. Chat speed PRs should live in `chat.ts` + Chat.jsx + `promptBuilder.ts`. |
| Rate-limit | Merged #125. User-keyed. Leave it. |
| `main` CI `api-tests` | `llmEnsemble.test.ts` vs OpenRouter in CI chain. Separate PR. |
| Dependabot #449 | Ignore. |

---

## Recommended next 1–2 PRs (latency)

### Slice 1 — TTFT: open the stream, shrink prefill (P0-L1 + P0-L2)

**Files:** `artifacts/api-server/src/routes/chat.ts`, `artifacts/api-server/src/lib/promptBuilder.ts` (optional cap), maybe `Chat.jsx` only if dropping fat history is in-scope.

1. `writeHead` SSE + heartbeat **before** context `Promise.all`.
2. Skip `retrieveRepositoryKnowledge` unless the turn is protocol/codespace (or default-off on Worker).
3. Cap `CLIENT_SCENE_CONTEXT` far below 24k, or stop duplicating CHARACTER / history when `clientOwnsTranscript`.

Do not touch #450 files. Tests: `chatLifecycle` still streams; add an assert that a status/heartbeat event can be written before mocked LLM open.

### Slice 2 — E2E: token cap + honest open budget on `/chat/messages` (P0-L3)

**Files:** `chat.ts` (only, until #450 merges).

1. `maxTokens: Math.min(routed.maxTokens, 1024)` on this route (length guide is already 2–4 sentences).
2. `llmOpenTimeoutMs({ freeTierCascade: false })` so Chat.jsx does not inherit the 80s :free cascade. Local still has 35s; after #450, consider aligning with 18s.

**After those:** identity Slice A (load `GET /chat/memories` on session open + seed on create). Speed first.

### Explicitly not the first PR

- Worker 20s healthz classification (#450).
- Ensemble / OpenRouter chain CI.
- Echo Key radiation, crossover pool recall, intimacy save-on-client-commit.
- Ollama keep_alive (runbook / host, not app).

---

## Evidence index

| Claim | Evidence |
|-------|----------|
| SSE after context load | `chat.ts` `telemetry.measure("context_load_ms", Promise.all(…))` then `composePrompt` then `writeHead` |
| Chat exempt from 20s wall | `workerApiGuard.ts` `isLongLivedApiPath` matches `/api/chat` |
| Client wraps ≤24k | `promptBuilder.ts` `suppliedContext.slice(0, 24_000)` |
| Chat.jsx streams deltas | `streamChatReply.js` `onDelta` per content event; `useChatStreaming` |
| Ensemble off by default | `localEnsemble.ts` `ANIMA_LOCAL_LLM_ENSEMBLE` |
| 80s open when OpenRouter on chain | `usesFreeTierOpenBudget` + wrangler `ANIMA_OPENROUTER_FALLBACK`/`FREE` + `chat.ts` `openStreamAbort` |
| `/api/ai/chat` ≠ Chat.jsx | Chat.jsx → `animaApi.chat.sendMessage` → `/chat/messages` |
| 8192 max_tokens on typical turns | `modelRouter.ts` `text.length >= 200` → heavy; `MAX_TOKENS.heavy = 8192` |
| Repo RAG every turn | `chat.ts` `retrieveRepositoryKnowledge(content)` when `content.trim()` |
| Telemetry TTFT excludes context | `chatTelemetry.ts` `ttft_ms` from `generationStartedAt` |
| Browser abort 130s | `animaApi.js` `CHAT_STREAM_TIMEOUT_MS = 130_000` |
