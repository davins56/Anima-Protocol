# Chat latency + identity-loop audit

**Date:** 2026-09-14 (updated: Slice 1 TTFT shipped in #453)  
**Baseline:** `main` @ `651670a6` (`fix(chat): send first SSE byte before context load` / #453) + `66c825b7` (audit #452)  
**Owner priority:** AI response speed — **TTFT**, then end-to-end chat latency. Identity loop and Worker timeout/CI stay in this document, below latency.

Findings only. No runtime code in this PR.

Complements `docs/upgrade-audit.md` (#389, LLM/security). **[#453](https://github.com/davins56/Anima-Protocol/pull/453) merged** Slice 1 (SSE after `beginChatTurn`, gated repo RAG, 2k client wrap). **[#450](https://github.com/davins56/Anima-Protocol/pull/450)** still owns Worker ETIMEOUT classification and the 12s `localAttemptSignal` hop. Remaining speed work is Slice 2 (local `max_tokens` + 80s `:free` cascade).

---

## 0. Latency verdict (read this first)

Chat **does stream**. The UI is not waiting for a full reply before painting tokens (`streamChatReply` + SSE deltas). After [#453](https://github.com/davins56/Anima-Protocol/pull/453), the **first SSE byte is a heartbeat after `beginChatTurn`**, not after context load. Remaining slowness is **client-side fat `systemPrompt` build**, **prefill still from CHARACTER / memories / CORE**, then **generation allowed to 4–8k tokens**, then an **80s OpenRouter `:free` cascade** if local hops.

User-perceived timeline for `POST /api/chat/messages` (production Chat.jsx, post-#453):

```
[click send]
  client builds a large systemPrompt (character sheet + 14 msgs + lore + memory…)
  POST /chat/messages
    ensureSchemaOnce
    beginChatTurn + 409/replay                    ← DB, before any SSE
    writeHead SSE + heartbeat                     ← first network byte (#453)
    retry leftover turns
    load characters, memories, embeddings
    supermemory HTTP (if enabled)
    world-knowledge HTTP (≤1.5s, fail-open)
    repository RAG only if repo-shaped / explicit ← #453 gated
    evolution / relationship / arc / intimacy
    composePrompt: Story so far stripped, wrap ≤2k
    open local Ollama stream (12s hop if OpenRouter
      is next; outer abort 35s, or 80s :free)     ← leftover 80s is cascade
    first content delta                           ← visible TTFT
    …stream tokens…
    done → client persist                         ← E2E “can send again”
```

Telemetry (`ChatPipelineTelemetry`) records `context_load_ms` and `ttft_ms`, but **`ttft_ms` starts at `startGeneration()`** — after context load. After #453 the first *network* byte is a heartbeat; first *content* token still waits on context + prompt + model. Logs understate content TTFT. Perceived wait to first word ≈ `context_load_ms + prompt_build_ms + ttft_ms` (`repository_rag_ms` is nested inside `context_load_ms` when RAG runs; do not add it again).

### Teammate hypotheses — verified

| Hypothesis | Verdict |
|------------|---------|
| Waiting on full replies instead of streaming | **Mostly false.** Main path streams. Exceptions: opt-in `ANIMA_LOCAL_LLM_ENSEMBLE` (off by default, waits for N full drafts); image gen after the reply; `max_tokens` 4–8k so E2E stays long even when TTFT is fine. |
| Oversize context / memory retrieval | **Partly fixed in #453.** Server strips `Story so far:` and caps the remainder at 2k (`clientSceneExcerpt`). Chat.jsx still *builds* the fat prompt before POST; `composePrompt` still adds CHARACTER / memories / CORE. Prefill is smaller, not thin. |
| Worker ~20s wall | **Does not race `/api/chat`.** `isLongLivedApiPath` exempts `/api/openai` and `/api/chat`. The 20s wall is store/healthz. **#450 merged:** Worker `ETIMEOUT` is no longer classified as a DB timeout; live `?probe=1` uses a **45s** bound; **`POST /api/ai/chat`** opens in **18s**. **Chat.jsx still uses `/api/chat/messages`**, which is long-lived and still has a **35s** (or **80s** if OpenRouter is on the chain) **outer** stream-open budget. |
| Cold Ollama | **True for ops/retries; 12s hop already shipped.** `ANIMA_LOCAL_LLM_MAX_RETRIES` defaults to **2**. `localAttemptSignal` in `createChatStreamWithFailover` already combines the caller abort with `LLM_LOCAL_FAILOVER_ATTEMPT_MS` (**12s**) whenever a next provider exists — `/chat/messages` passes `signal: open.signal` into that function. Remaining hang after a cold local fail is the **OpenRouter :free cascade** sharing the **80s** `usesFreeTierOpenBudget()` outer abort, not a missing 12s hop. |

---

## P0 — chat speed (do these first)

### P0-L1 — First SSE byte before context load (TTFT) — **shipped in #453**

**Shipped:** `openChatSse` runs after `beginChatTurn` + replay/409, before memories / embeddings / weather / RAG / `composePrompt`. Duplicate `turn_id`s still get replay SSE or 409 JSON, not a second live stream. Do not reopen this ordering.

### P0-L2 — Stop double-prefill (TTFT + E2E) — **server wrap shipped in #453; Chat.jsx still fat**

**Shipped:** `clientSceneExcerpt` strips `Story so far:` / `CONVERSATION CONTEXT:` and caps at `CLIENT_SCENE_CONTEXT_MAX` (2k). `shouldRetrieveRepositoryKnowledge` skips default RAG. Repository knowledge is its own prompt section.

**Still open:** Chat.jsx still concatenates character sheet + 14×800 history + lore + CharacterMemory before POST. Thinning that payload is identity/P1 work. **[#456](https://github.com/davins56/Anima-Protocol/pull/456)** restores IMAGE/EMOTION/LOCATION contracts that #453’s greedy `Story so far:` strip deleted.

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

`retrieveRelevantMemories` is in-process scoring (topK 12, last 24 turn crumbs). `attachStoredEmbeddings` is a DB read of JSON vectors. That is cheaper than the leftover Chat.jsx fat prompt + 4–8k generation. **Do not** “fix speed” by deleting companion memory. P0-L1/L2 server side shipped; next is P0-L3. Identity-loop P1 still matters for *quality* of recall, not the first-token budget.

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
| Client still prompts from `CharacterMemory` | Chat.jsx `loadCharacterMemories` → `characterMemory` invoke; `buildMemoryContext` | **Do not** wire `GET /chat/memories/:id` into that `system_prompt` (dual-inject). **Do not** drop the client block until distilled `CharacterMemory` facts are merged into `companion_memories` / the server prompt. `upsertTurnMemory` is last-24 raw crumbs with an empty summary — it does not replace `extractCharacterMemories`. |
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
| [#457](https://github.com/davins56/Anima-Protocol/pull/457) Honor `req.maxTokens` on local Ollama | **Superseded.** #455 `262c275e` added the same local `Math.min(req.maxTokens, m.maxTokens)`. Do not merge both — they conflict on `llmFailover.ts`. |
| [#456](https://github.com/davins56/Anima-Protocol/pull/456) Keep IMAGE/EMOTION after `Story so far:` | **Open.** Fixes #453 greedy excerpt. Different files from #455. |
| [#455](https://github.com/davins56/Anima-Protocol/pull/455) Slice 2 E2E — 1024 clamp + 18s open **and** local `max_tokens` | **Open** (ready). After Codex, also honors `req.maxTokens` on the local Ollama path. 1024 on every companion turn is intentional: `routeModel` treats ≥200 chars as heavy/8192 while Chat.jsx already asks 2–4 sentences. |
| [#453](https://github.com/davins56/Anima-Protocol/pull/453) Slice 1 TTFT — SSE before context load | **Merged** `651670a6` (2026-09-14). `beginChatTurn` + replay/409 still run **before** `openChatSse`. Context load after headers is inside the generation `try/catch` (SSE `{ error }`, heartbeat stopped, turn marked failed). Default repo RAG gated; client wrap capped at 2k. Do **not** start a second Slice 1 PR. |
| [#450](https://github.com/davins56/Anima-Protocol/pull/450) Worker ETIMEOUT ≠ DB; `/api/ai/chat` 18s; **12s `localAttemptSignal` in shared failover**; probe 45s | **Merged** `f4a7010a` (2026-09-14). Do not re-open classification. Do **not** recommend another 12s hop on `/chat/messages` — it already shares `createChatStreamWithFailover`. Remaining Chat.jsx work: local `max_tokens` ignoring `req.maxTokens`, 80s OpenRouter outer abort. |
| Rate-limit | Merged #125. User-keyed. Leave it. |
| `main` CI `api-tests` | `llmEnsemble.test.ts` vs OpenRouter in CI chain. Separate PR. |
| Dependabot #449 | Ignore. |

---

## Recommended next 1–2 PRs (latency)

### Slice 1 — TTFT: open the stream, shrink prefill (P0-L1 + P0-L2) — **shipped in #453**

Do not duplicate. Remaining Chat.jsx thinning is identity/P1, not another TTFT PR.

### Slice 2 — E2E: honor token cap on local Ollama; stop 80s OpenRouter cascade (P0-L3)

**Split, then #455 absorbed the local cap:**

- [#455](https://github.com/davins56/Anima-Protocol/pull/455) — `clampChatMessagesMaxTokens(1024)` + 18s open **and** (as of `262c275e`) local `max_tokens: min(req.maxTokens, registry)`. This is now the complete Slice 2 PR.
- [#457](https://github.com/davins56/Anima-Protocol/pull/457) — same local-path fix; **superseded**, do not merge alongside #455.

Do not invent a fourth timeout constant. Do **not** re-apply `LLM_LOCAL_FAILOVER_ATTEMPT_MS`.

**After those:** identity Slice A — seed `companion_memories` on create, then **migrate** distilled `CharacterMemory` facts into that store (or the server prompt) **before** dropping the Chat.jsx block. Do **not** add `GET /chat/memories` to the client prompt. Speed first.

### Explicitly not the first PR

- Another Slice 1 TTFT PR (SSE / repo RAG / 24k wrap) — **shipped in [#453](https://github.com/davins56/Anima-Protocol/pull/453)**.
- Worker ETIMEOUT / healthz probe classification (**done in #450**).
- Another 12s local hop on `/chat/messages` (**already in #450** via `localAttemptSignal`).
- Wiring `GET /chat/memories` into Chat.jsx `system_prompt` (would worsen double-prefill).
- Dropping Chat.jsx `CharacterMemory` before a distillation merge into `companion_memories`.
- Ensemble / OpenRouter chain CI (`llmEnsemble.test.ts` still red on `main`).
- Echo Key radiation, crossover pool recall, intimacy save-on-client-commit.
- Ollama keep_alive (runbook / host, not app).

---

## Evidence index

| Claim | Evidence |
|-------|----------|
| SSE after `beginChatTurn`, before context load | #453 `openChatSse` after replay/409; `chatTtft.test.ts` |
| Chat exempt from 20s wall | `workerApiGuard.ts` `isLongLivedApiPath` matches `/api/chat` |
| Client wrap ≤2k after stripping transcript | `promptBuilder.ts` `clientSceneExcerpt` / `CLIENT_SCENE_CONTEXT_MAX` |
| Chat.jsx streams deltas | `streamChatReply.js` `onDelta` per content event; `useChatStreaming` |
| Ensemble off by default | `localEnsemble.ts` `ANIMA_LOCAL_LLM_ENSEMBLE` |
| 80s outer abort when OpenRouter on chain | `usesFreeTierOpenBudget` + wrangler `ANIMA_OPENROUTER_FALLBACK`/`FREE` + `chat.ts` `openStreamAbort`; leftover after local hop is :free cascade |
| 12s local hop already on `/chat/messages` | `llmFailover.ts` `localAttemptSignal` + `LLM_LOCAL_FAILOVER_ATTEMPT_MS`; `chat.ts` passes `signal: open.signal` into `createChatStreamWithFailover` |
| Local Ollama honors `req.maxTokens` in #455 | `llmFailover.ts` local branch `max_tokens: Math.min(req.maxTokens, m.maxTokens)` as of #455 `262c275e` |
| `/api/ai/chat` ≠ Chat.jsx | Chat.jsx → `animaApi.chat.sendMessage` → `/chat/messages`; #450 18s cap is `llmAiChatOpenTimeoutMs()` on `/api/ai/chat` only |
| #450 merged | `origin/main` `f4a7010a`; `chat.ts` still `llmOpenTimeoutMs({ freeTierCascade: usesFreeTierOpenBudget() })` |
| 8192 max_tokens on typical turns | `modelRouter.ts` `text.length >= 200` → heavy; `MAX_TOKENS.heavy = 8192` |
| Server memories already in prompt | `chat.ts` `loadMemories` → `composePrompt` `formatMemoriesForPrompt`; Chat.jsx also `buildMemoryContext(characterMemories)` |
| Repo RAG gated | `shouldRetrieveRepositoryKnowledge` — ordinary turns skip; `ANIMA_REPOSITORY_RAG=false` still hard off |
| Telemetry | `ttft_ms` from `generationStartedAt`; `repository_rag_ms` is nested in `context_load_ms` (`chat.ts` + `chatTelemetry.ts`) |
| Browser abort 130s | `animaApi.js` `CHAT_STREAM_TIMEOUT_MS = 130_000` |
