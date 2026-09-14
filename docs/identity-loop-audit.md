# Chat latency + identity-loop audit

**Date:** 2026-09-14 (updated: Codex review of merged #451 folded in)  
**Baseline:** `main` @ `f4a7010a` (`fix(worker): do not classify Worker ETIMEOUT as a database timeout` / #450)  
**Owner priority:** AI response speed — **TTFT**, then end-to-end chat latency. Identity loop and Worker timeout/CI stay in this document, below latency.

Findings only. No runtime code in this PR.

Complements `docs/upgrade-audit.md` (#389, LLM/security). **[#450](https://github.com/davins56/Anima-Protocol/pull/450) merged** (Worker ETIMEOUT ≠ DB; `/api/ai/chat` 18s open; **12s local hop inside shared `createChatStreamWithFailover`**). Chat.jsx still uses `/api/chat/messages`. Slice 2 must not re-apply that hop.

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
    open local Ollama stream (12s hop if OpenRouter
      is next; outer abort 35s, or 80s :free)     ← leftover 80s is cascade
    first content delta                           ← TTFT the user feels
    …stream tokens…
    done → client persist                         ← E2E “can send again”
```

Telemetry (`ChatPipelineTelemetry`) records `context_load_ms` and `ttft_ms`, but **`ttft_ms` starts at `startGeneration()`** — after context load. Logs understate user-perceived TTFT. Perceived wait ≈ `context_load_ms + prompt_build_ms + ttft_ms` (`repository_rag_ms` is already nested inside `context_load_ms`; do not add it again).

### Teammate hypotheses — verified

| Hypothesis | Verdict |
|------------|---------|
| Waiting on full replies instead of streaming | **Mostly false.** Main path streams. Exceptions: opt-in `ANIMA_LOCAL_LLM_ENSEMBLE` (off by default, waits for N full drafts); image gen after the reply; `max_tokens` 4–8k so E2E stays long even when TTFT is fine. |
| Oversize context / memory retrieval | **True, and worse than memory alone.** Client prompt (up to 24k chars) is wrapped *again* by `composePrompt`, which then adds character def, memories, resonance, CORE_BEHAVIOR. Prefill dominates small local models. |
| Worker ~20s wall | **Does not race `/api/chat`.** `isLongLivedApiPath` exempts `/api/openai` and `/api/chat`. The 20s wall is store/healthz. **#450 merged:** Worker `ETIMEOUT` is no longer classified as a DB timeout; live `?probe=1` uses a **45s** bound; **`POST /api/ai/chat`** opens in **18s**. **Chat.jsx still uses `/api/chat/messages`**, which is long-lived and still has a **35s** (or **80s** if OpenRouter is on the chain) **outer** stream-open budget. |
| Cold Ollama | **True for ops/retries; 12s hop already shipped.** `ANIMA_LOCAL_LLM_MAX_RETRIES` defaults to **2**. `localAttemptSignal` in `createChatStreamWithFailover` already combines the caller abort with `LLM_LOCAL_FAILOVER_ATTEMPT_MS` (**12s**) whenever a next provider exists — `/chat/messages` passes `signal: open.signal` into that function. Remaining hang after a cold local fail is the **OpenRouter :free cascade** sharing the **80s** `usesFreeTierOpenBudget()` outer abort, not a missing 12s hop. |

---

## P0 — chat speed (do these first)

### P0-L1 — First SSE byte before context load (TTFT)

**What’s wrong:** `chat.ts` `POST /messages` loads schema, turns, characters, memories, embeddings, optional supermemory, world weather, **repository RAG**, evolution/rel/arc, intimacy, then `composePrompt` — **then** `res.writeHead` SSE. The client shows typing with **zero tokens** for all of that.

**Where:** `artifacts/api-server/src/routes/chat.ts` (~1360–1676). Contrast: `preStreamPersist` is already after `writeHead` (good). Context load is not.

**Why it matters:** This is the only TTFT work entirely in app code. Cold Hyperdrive + RAG + weather can add seconds before Ollama is even called.

**Approach:** Keep `beginChatTurn` (and the existing replay / 409 JSON path) **before** `writeHead`. Opening SSE right after auth would skip that ledger and present duplicate `turn_id`s as a live stream. After the turn is created, heartbeat immediately and run the expensive context `Promise.all` while the client already has an open stream (`status: "loading"`). Do not wait on repository RAG or weather to *start* the LLM; inject them only if they finish before `createChatStreamWithFailover`, else skip.

**Effort:** S–M. #450 already owns `workerApiGuard.ts` / `dbErrors.ts` — don’t reopen classification. This slice is `chat.ts` writeHead ordering.

### P0-L2 — Stop double-prefill (TTFT + E2E)

**What’s wrong:** Chat.jsx builds a full character sheet, 14×800-char history (`Story so far:`), lore, CharacterMemory, echo lore, behavior sliders. Server wraps that as `CLIENT_SCENE_CONTEXT` **sliced to 24,000 chars**, then adds `buildCharacterDefinition` (3k), memory block (2.4k), resonance, voice, CORE_BEHAVIOR again. `buildLlmChatMessages` skips store history when it sees `Story so far:` — so you still pay the client transcript *inside the system prompt*.

**Where:** `artifacts/anima-protocol/src/pages/Chat.jsx` (~1428–1821); `artifacts/api-server/src/lib/promptBuilder.ts` `composePrompt` (`slice(0, 24_000)`), `BUDGET`, `clientOwnsTranscript`.

**Why it matters:** Prefill time on Qwen/anima-chat 3B is the dominant TTFT once the stream is open. Duplicating identity + history is free latency.

**Approach:** Send a **thin** client payload (speaker id, hidden-sequences, length guide) and let `composePrompt` own identity + last-N store messages. Or: if client already sent a sheet, do not wrap 24k and do not add a second CHARACTER block. Cap client `system_prompt` hard (e.g. 4k). Drop repository RAG from the default chat path (`ANIMA_REPOSITORY_RAG` is already skippable; today it runs on every non-empty turn in `chat.ts`).

**Effort:** S for “don’t wrap 24k + skip repo RAG”; M to move Chat.jsx off the fat prompt.

### P0-L3 — Cap generation length; don’t use the 80s free-tier open budget on Chat.jsx (E2E + hung typing)

**What’s wrong:**

1. `routeModel` → `maxTokens` 4096 (light) / **8192** (standard/heavy). `classifyComplexity` treats **≥200 characters or ≥30 words as heavy**. Ordinary companion turns hit 8192 `max_tokens`. Length guide already asks for 2–4 sentences.
2. A `chat.ts`-only `maxTokens: Math.min(routed.maxTokens, 1024)` **does not cap Ollama**. `createChatStreamWithFailover` local branch sends `max_tokens: m.maxTokens` (registry 4–8k) and **ignores `req.maxTokens`**. OpenRouter takes `Math.min(req.maxTokens, m.maxTokens)`. Slice 2 must change the **local** branch in `llmFailover.ts` (~2008 stream, ~2132 non-stream).
3. Production `wrangler.jsonc`: `ANIMA_OPENROUTER_FALLBACK=true` + `ANIMA_OPENROUTER_FREE=true`. `/chat/messages` uses `llmOpenTimeoutMs({ freeTierCascade: usesFreeTierOpenBudget() })` → **80s outer** abort. That leftover budget is the **OpenRouter cascade**, not cold local: #450 already applied the **12s** `localAttemptSignal` hop inside `createChatStreamWithFailover`. Browser abort is **130s** (`CHAT_STREAM_TIMEOUT_MS`). First-chunk wait is **50s** (`LLM_STREAM_FIRST_CHUNK_MS`) — sized for DeepSeek R1 think, not anima-chat.
4. Local SDK retries default **2** (`openaiClient.ts` `localLlmMaxRetries`).

**Where:** `modelRouter.ts` `MAX_TOKENS`; `llmFailover.ts` local `max_tokens: m.maxTokens` + `localAttemptSignal`; `chat.ts` `openStreamAbort` / `createChatStreamWithFailover({ signal: open.signal })`; `chatTimeouts.ts`; `animaApi.js` `CHAT_STREAM_TIMEOUT_MS=130_000`; `wrangler.jsonc` fallback/free vars.

**Why it matters:** Even a fast first token feels slow if the model is allowed 8k tokens. After local hops in 12s, an 80s OpenRouter cascade still looks like “chat is broken.”

**Approach:** Honor the caller cap on the **local** Ollama request (`max_tokens: Math.min(req.maxTokens ?? m.maxTokens, m.maxTokens)` in `llmFailover.ts`), then pass `Math.min(routed.maxTokens, 1024)` from `/chat/messages`. Do **not** re-apply `LLM_LOCAL_FAILOVER_ATTEMPT_MS` on this route — it already runs whenever OpenRouter is next. Remaining budget work: `freeTierCascade: false` so the outer abort is 35s instead of 80s of :free hops hanging the typing UI; optionally lower `LLM_STREAM_FIRST_CHUNK_MS` for anima-chat (50s is R1 `<think>`).

Do not re-litigate Worker ETIMEOUT classification or the healthz probe bound — those shipped in #450.

**Ops (not a code PR):** keep Ollama loaded (`keep_alive`, a 1-token warmup cron against `llm.anima-protocol.com`). `ANIMA_LOCAL_LLM_MAX_RETRIES=0` on a single-slot box.

### P0-L4 — Memory retrieval is not the first TTFT knob (but don’t grow it)

`retrieveRelevantMemories` is in-process scoring (topK 12, last 24 turn crumbs). `attachStoredEmbeddings` is a DB read of JSON vectors. That is cheaper than the 24k client wrap + repo RAG. **Do not** “fix speed” by deleting companion memory. Finish P0-L1/L2 first. Identity-loop P1 below still matters for *quality* of recall, not the first-token budget.

---

## P1 — identity loop (after a faster chat)

Production Chat is client-persist. Server **already** injects `companion_memories` every turn (`loadMemories` → `composePrompt`). Chat.jsx also stuffs `CharacterMemory` into `system_prompt` via `buildMemoryContext`. Two stores, one already on the hot path.

```
create   POST /api/store/Character|Anima     no companion_memories row
session  POST /api/store/ChatSession
send     Chat.jsx fat systemPrompt (includes CharacterMemory)
         POST /api/chat/messages persist:false persistence_owner:client
stream   loadMemories + composePrompt (server memory block); SSE; chat_turns
persist  user_entities ChatMessage, then commitTurn
memory   upsertTurnMemory / recordTurnContinuity → companion_memories
         next Chat.jsx turn still loads CharacterMemory (every 6 solo msgs)
```

| Gap | Where | Do not |
|-----|--------|--------|
| Create does not seed `companion_memories` | `createCompanion.js` | — |
| Client still prompts from `CharacterMemory` | Chat.jsx `loadCharacterMemories` → `characterMemory` invoke; `buildMemoryContext` | **Do not** wire `GET /chat/memories/:id` into that `system_prompt`. Server already `loadMemories` → `composePrompt`. Dual-injecting those rows **grows** P0-L2 double-prefill. Drop client memory from the prompt (trust server) or change ownership — don’t add a second fetch. |
| `GET /chat/memories/:id` unused by SPA | `chat.ts`; dashboard still uses `characterMemory` | Fine as a debug/dashboard API. Not a Chat.jsx prompt source. |
| `commitTurn` skips typed `chat_messages` | `chat.ts` vs `persistLedgerTurn` — breaks `proactiveMessages` | — |
| Facts are turn dumps, not distilled identity | `upsertTurnMemory` vs `extractCharacterMemories` | — |
| `ChatExperienceNucleus` persist:true path unused | not mounted in ProtocolApp | — |

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
| [#450](https://github.com/davins56/Anima-Protocol/pull/450) Worker ETIMEOUT ≠ DB; `/api/ai/chat` 18s; **12s `localAttemptSignal` in shared failover**; probe 45s | **Merged** `f4a7010a` (2026-09-14). Do not re-open classification. Do **not** recommend another 12s hop on `/chat/messages` — it already shares `createChatStreamWithFailover`. Remaining Chat.jsx work: pre-SSE context load, 24k wrap, local `max_tokens` ignoring `req.maxTokens`, 80s OpenRouter outer abort. |
| Rate-limit | Merged #125. User-keyed. Leave it. |
| `main` CI `api-tests` | `llmEnsemble.test.ts` vs OpenRouter in CI chain. Separate PR. |
| Dependabot #449 | Ignore. |

---

## Recommended next 1–2 PRs (latency)

### Slice 1 — TTFT: open the stream, shrink prefill (P0-L1 + P0-L2)

**Files:** `artifacts/api-server/src/routes/chat.ts`, `artifacts/api-server/src/lib/promptBuilder.ts` (optional cap), maybe `Chat.jsx` only if dropping fat history is in-scope.

1. `writeHead` SSE + heartbeat **after** `beginChatTurn` + duplicate 409/replay, **before** the expensive context `Promise.all`. Do not open SSE at auth-only.
2. Skip `retrieveRepositoryKnowledge` unless the turn is protocol/codespace (or default-off on Worker).
3. Cap `CLIENT_SCENE_CONTEXT` far below 24k, or stop duplicating CHARACTER / history when `clientOwnsTranscript`.

Tests: `chatLifecycle` still streams; add an assert that a status/heartbeat event can be written before mocked LLM open.

### Slice 2 — E2E: honor token cap on local Ollama; stop 80s OpenRouter cascade (P0-L3)

**Files:** `artifacts/api-server/src/lib/llmFailover.ts` (**required** for the cap to reach anima-chat), then `artifacts/api-server/src/routes/chat.ts`. Do not invent a fourth timeout constant.

1. Local stream/complete in `createChatStreamWithFailover`: send `max_tokens: Math.min(req.maxTokens ?? m.maxTokens, m.maxTokens)` instead of `m.maxTokens`. Today OpenRouter honors the caller cap; local does not.
2. Then `maxTokens: Math.min(routed.maxTokens, 1024)` on `/chat/messages` (length guide is already 2–4 sentences). `chat.ts` alone is a no-op on production Ollama.
3. Do **not** re-apply `LLM_LOCAL_FAILOVER_ATTEMPT_MS` here — #450 already did that in `localAttemptSignal` when a next provider exists. Remaining: `freeTierCascade: false` so the outer abort is 35s, not 80s of :free hops after local already failed over.

**After those:** identity Slice A — seed `companion_memories` on create, and **stop** stuffing `CharacterMemory` into Chat.jsx `system_prompt` (server `loadMemories` already runs). Do **not** add `GET /chat/memories` to that prompt. Speed first.

### Explicitly not the first PR

- Worker ETIMEOUT / healthz probe classification (**done in #450**).
- Another 12s local hop on `/chat/messages` (**already in #450** via `localAttemptSignal`).
- Wiring `GET /chat/memories` into Chat.jsx `system_prompt` (would worsen double-prefill).
- Ensemble / OpenRouter chain CI (`llmEnsemble.test.ts` still red on `main`).
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
| 80s outer abort when OpenRouter on chain | `usesFreeTierOpenBudget` + wrangler `ANIMA_OPENROUTER_FALLBACK`/`FREE` + `chat.ts` `openStreamAbort`; leftover after local hop is :free cascade |
| 12s local hop already on `/chat/messages` | `llmFailover.ts` `localAttemptSignal` + `LLM_LOCAL_FAILOVER_ATTEMPT_MS`; `chat.ts` passes `signal: open.signal` into `createChatStreamWithFailover` |
| Local Ollama ignores `req.maxTokens` | `llmFailover.ts` local branch `max_tokens: m.maxTokens` (~2008 stream, ~2132); OpenRouter uses `Math.min(req.maxTokens, m.maxTokens)` |
| `/api/ai/chat` ≠ Chat.jsx | Chat.jsx → `animaApi.chat.sendMessage` → `/chat/messages`; #450 18s cap is `llmAiChatOpenTimeoutMs()` on `/api/ai/chat` only |
| #450 merged | `origin/main` `f4a7010a`; `chat.ts` still `llmOpenTimeoutMs({ freeTierCascade: usesFreeTierOpenBudget() })` |
| 8192 max_tokens on typical turns | `modelRouter.ts` `text.length >= 200` → heavy; `MAX_TOKENS.heavy = 8192` |
| Server memories already in prompt | `chat.ts` `loadMemories` → `composePrompt` `formatMemoriesForPrompt`; Chat.jsx also `buildMemoryContext(characterMemories)` |
| Repo RAG every turn | `chat.ts` `retrieveRepositoryKnowledge(content)` when `content.trim()` |
| Telemetry | `ttft_ms` from `generationStartedAt`; `repository_rag_ms` is nested in `context_load_ms` (`chat.ts` + `chatTelemetry.ts`) |
| Browser abort 130s | `animaApi.js` `CHAT_STREAM_TIMEOUT_MS = 130_000` |
