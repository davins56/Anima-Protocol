# Chat latency + identity-loop audit

**Date:** 2026-09-14 (updated: #467 2k group-contract cap)  
**Baseline:** `main` @ `fcf57dbc` (`#467`) / `93c3db58` (`#468`)  
**Owner priority:** AI response speed — **TTFT**, then end-to-end chat latency. Identity loop and Worker timeout/CI stay in this document, below latency.

Findings only. No runtime code in this PR.

Complements `docs/upgrade-audit.md` (#389, LLM/security). Slice 1 **[#453](https://github.com/davins56/Anima-Protocol/pull/453)** and Slice 2 **[#455](https://github.com/davins56/Anima-Protocol/pull/455)** (`2af82b82`: 1024 clamp + `llmChatMessagesOpenTimeoutMs()` 18s) are on `main`. Local Ollama honors `req.maxTokens` (**[#457](https://github.com/davins56/Anima-Protocol/pull/457)**). Solo 1:1 Chat.jsx sends lean extras (**[#458](https://github.com/davins56/Anima-Protocol/pull/458)** `cfed7b3a`). Fat-prompt IMAGE/EMOTION survive **[#456](https://github.com/davins56/Anima-Protocol/pull/456)** / **[#461](https://github.com/davins56/Anima-Protocol/pull/461)** / **[#463](https://github.com/davins56/Anima-Protocol/pull/463)** / **[#467](https://github.com/davins56/Anima-Protocol/pull/467)** (line-start headings; 2k wrap keeps group `CRITICAL INSTRUCTIONS:`). Group still uses fat `buildGroupPrompt`. Custom host is fail-closed local-only (**[#464](https://github.com/davins56/Anima-Protocol/pull/464)**). Companion self-state is on the prompt + mood chrome (**[#465](https://github.com/davins56/Anima-Protocol/pull/465)** / **[#468](https://github.com/davins56/Anima-Protocol/pull/468)**); Resonance Keys are still later.

---

## 0. Latency verdict (read this first)

Chat **does stream**. The UI is not waiting for a full reply before painting tokens (`streamChatReply` + SSE deltas). After [#453](https://github.com/davins56/Anima-Protocol/pull/453), the **first SSE byte is a heartbeat after `beginChatTurn`**, not after context load. Companion turns cap at **1024** tokens (#455) and open in **18s** (`llmChatMessagesOpenTimeoutMs`) on the default failover path — not the **80s** `:free` cascade. Opt-in `ANIMA_LOCAL_LLM_ENSEMBLE` gathers drafts **outside** that `openStreamAbort` (off by default; waits for N full drafts). Local Ollama honors `req.maxTokens` (#457). Solo client `system_prompt` is lean extras (#458). Remaining slowness is **group fat `buildGroupPrompt`**, **server CHARACTER / memories / CORE prefill**, then **generation**. A usable custom host does **not** hop to OpenRouter (#464).

User-perceived timeline for `POST /api/chat/messages` (production Chat.jsx, post-#458):

```
[click send]
  client builds lean extras (solo) or fat group prompt
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
    open local Ollama stream (outer 18s #455;
      chain [local] only when custom host is set   ← #464, no OpenRouter hop
      12s hop only if a next provider exists)
    first content delta                           ← visible TTFT
    …stream tokens…
    done → client persist                         ← E2E “can send again”
```

Telemetry (`ChatPipelineTelemetry`) records `context_load_ms` and `ttft_ms`, but **`ttft_ms` starts at `startGeneration()`** — after context load. After #453 the first *network* byte is a heartbeat; first *content* token still waits on context + prompt + model. Logs understate content TTFT. Perceived wait to first word ≈ `context_load_ms + prompt_build_ms + ttft_ms` (`repository_rag_ms` is nested inside `context_load_ms` when RAG runs; do not add it again).

### Teammate hypotheses — verified

| Hypothesis | Verdict |
|------------|---------|
| Waiting on full replies instead of streaming | **Mostly false.** Main path streams. Exceptions: opt-in `ANIMA_LOCAL_LLM_ENSEMBLE` (off by default, waits for N full drafts, **not** under the 18s `openStreamAbort`); image gen after the reply. Companion turns cap at 1024 (#455); leftover E2E is prefill + model, not 4–8k decode. |
| Oversize context / memory retrieval | **Partly fixed.** Server strips `Story so far:` and caps the remainder at 2k (`clientSceneExcerpt`, #453). Solo Chat.jsx sends lean extras (#458). Group still *builds* fat `buildGroupPrompt` before POST. `composePrompt` still adds CHARACTER / memories / CORE. |
| Worker ~20s wall | **Does not race `/api/chat`.** `isLongLivedApiPath` exempts `/api/openai` and `/api/chat`. The 20s wall is store/healthz. **#450 merged:** Worker `ETIMEOUT` is no longer classified as a DB timeout; live `?probe=1` uses a **45s** bound. **`POST /api/chat/messages`** and **`POST /api/ai/chat`** both open in **18s** (`llmChatMessagesOpenTimeoutMs` / `llmAiChatOpenTimeoutMs`). The **80s** `:free` outer abort applies only when OpenRouter is actually on the chain (no custom host + fallback). |
| Cold Ollama | **True for ops; 12s hop only if a next provider exists.** `ANIMA_LOCAL_LLM_MAX_RETRIES` defaults to **2**. `localAttemptSignal` combines the caller abort with `LLM_LOCAL_FAILOVER_ATTEMPT_MS` (**12s**) whenever a next provider exists. **#464:** a usable custom host makes `getProviderChain()` `[local]` only — local connection/timeout returns `ai_timeout` / connection error, no OpenRouter hop. Do not set `ANIMA_OPENROUTER_FALLBACK` to paper over a down self-hosted host. |

---

## P0 — chat speed (do these first)

### P0-L1 — First SSE byte before context load (TTFT) — **shipped in #453**

**Shipped:** `openChatSse` runs after `beginChatTurn` + replay/409, before memories / embeddings / weather / RAG / `composePrompt`. Duplicate `turn_id`s still get replay SSE or 409 JSON, not a second live stream. Do not reopen this ordering.

### P0-L2 — Stop double-prefill (TTFT + E2E) — **server wrap #453; solo lean #458; group still fat**

**Shipped:** `clientSceneExcerpt` strips `Story so far:` / `CONVERSATION CONTEXT:` and caps at `CLIENT_SCENE_CONTEXT_MAX` (2k). `shouldRetrieveRepositoryKnowledge` skips default RAG. Repository knowledge is its own prompt section.

**Shipped (fat-prompt contracts):** [#456](https://github.com/davins56/Anima-Protocol/pull/456) `f9db61c7` keeps IMAGE/EMOTION/LOCATION after `Story so far:`. [#461](https://github.com/davins56/Anima-Protocol/pull/461) `55d75fb6` splits at contract markers, not the first blank line inside a user message. [#463](https://github.com/davins56/Anima-Protocol/pull/463) `a6eb6544` line-anchors headings so `Speaker: [EMOTION: …]` is not a boundary. [#467](https://github.com/davins56/Anima-Protocol/pull/467) `fcf57dbc` keeps group `CRITICAL INSTRUCTIONS:` when the unique suffix exceeds 2k (head + tail; `INTELLIGENCE` is already in `CORE_BEHAVIOR`) and ignores own-line `[IMAGE:]` history rows.

**Shipped (solo client):** [#458](https://github.com/davins56/Anima-Protocol/pull/458) `cfed7b3a` — `buildLeanSoloClientContext` (≤2k extras; trailing matrix/length/image/Continue reserved). Server `composePrompt` owns identity, store history, memories, `CORE_BEHAVIOR`.

**Still open:** Group still concatenates sheets + transcript + `CRITICAL INSTRUCTIONS` via `buildGroupPrompt`. Solo dropped client `CharacterMemory` without a distillation merge into `companion_memories` (identity P1, not a speed PR).

### P0-L3 — Cap generation length; don’t use the 80s free-tier open budget on Chat.jsx — **shipped in #455 + #457 + #464**

**Shipped:**

1. [#457](https://github.com/davins56/Anima-Protocol/pull/457) `cappedLocalMaxTokens` so a caller cap reaches Ollama.
2. [#455](https://github.com/davins56/Anima-Protocol/pull/455) `2af82b82` clamps `/chat/messages` with `clampChatMessagesMaxTokens` (1024) and opens with `llmChatMessagesOpenTimeoutMs()` (**18s**, same helper as `/api/ai/chat` — not `llmOpenTimeoutMs({ freeTierCascade: false })` which is **35s**).
3. [#464](https://github.com/davins56/Anima-Protocol/pull/464) `245b5848` — usable `ANIMA_LOCAL_LLM_BASE_URL` → chain `[local]` only. Local failure does not hop to OpenRouter. `ANIMA_OPENROUTER_FALLBACK` remains opt-in after Workers AI when **no** custom host is set.

Do not invent a fourth timeout constant. Do **not** re-apply `LLM_LOCAL_FAILOVER_ATTEMPT_MS`. Optionally lower `LLM_STREAM_FIRST_CHUNK_MS` for anima-chat (50s is R1 `<think>`). Browser abort is still **130s**.

**Ops (not a code PR):** keep Ollama loaded (`keep_alive`, a 1-token warmup cron against `llm.anima-protocol.com`). `ANIMA_LOCAL_LLM_MAX_RETRIES=0` on a single-slot box. Worker can set `ANIMA_OPENROUTER_FALLBACK=false` to drop the remaining Workers AI → OpenRouter hop.

### P0-L4 — Memory retrieval is not the first TTFT knob (but don’t grow it)

`retrieveRelevantMemories` is in-process scoring (topK 12, last 24 turn crumbs). `attachStoredEmbeddings` is a DB read of JSON vectors. That is cheaper than leftover group fat prompt. **Do not** “fix speed” by deleting companion memory. P0-L1/L2/L3 server + solo client shipped. Identity-loop P1 still matters for *quality* of recall, not the first-token budget.

---

## P1 — identity loop (after a faster chat)

Production Chat is client-persist. Server **already** injects `companion_memories` every turn (`loadMemories` → `composePrompt`). [#458](https://github.com/davins56/Anima-Protocol/pull/458) stopped stuffing `CharacterMemory` into the solo `system_prompt`. Two stores remain; only the server store is on the hot path for 1:1.

```
create   POST /api/store/Character|Anima     no companion_memories row
session  POST /api/store/ChatSession
send     Chat.jsx lean extras (solo) or fat group prompt
         POST /api/chat/messages persist:false persistence_owner:client
stream   loadMemories + composePrompt (server memory block); SSE; chat_turns
persist  user_entities ChatMessage, then commitTurn
memory   upsertTurnMemory / recordTurnContinuity → companion_memories
         solo no longer re-injects CharacterMemory; group still fat
```

| Gap | Where | Do not |
|-----|--------|--------|
| Create does not seed `companion_memories` | `createCompanion.js` | — |
| Solo dropped client `CharacterMemory` without distillation | #458 Chat.jsx; facts still live in `characterMemory` invoke | **Do not** wire `GET /chat/memories/:id` into `system_prompt` (dual-inject). **Migrate** distilled facts into `companion_memories` / the server prompt. `upsertTurnMemory` is last-24 raw crumbs with an empty summary — it does not replace `extractCharacterMemories`. |
| `GET /chat/memories/:id` unused by SPA | `chat.ts`; dashboard still uses `characterMemory` | Fine as a debug/dashboard API. Not a Chat.jsx prompt source. |
| `commitTurn` skips typed `chat_messages` | `chat.ts` vs `persistLedgerTurn` — breaks `proactiveMessages` | — |
| Facts are turn dumps, not distilled identity | `upsertTurnMemory` vs `extractCharacterMemories` | — |
| `ChatExperienceNucleus` persist:true path unused | not mounted in ProtocolApp | — |

---

## P2 — crossover / resonance (after identity)

- Scene Mind heuristics already skip extra HTTP (Chat.jsx group path). Good for TTFT.
- `promptBuilder` **filters memories to the speaker** despite a comment that crossover shares the pool.
- Echo Keys: static lore blurb; synchro does **not** change Key radiation. [#465](https://github.com/davins56/Anima-Protocol/pull/465) `4e55b96d` shipped durable companion self-state + mood chrome and a `radiationEventFromAffect` stub — not the Key system.
- `resonance_memories` not in `ensure-schema` (fail-soft).
- Hidden Sequences weather/jack-in live; no persisted dark-route field.

---

## Do not collide

| Item | Status |
|------|--------|
| [#468](https://github.com/davins56/Anima-Protocol/pull/468) Synchro snapshot bond-strength contract | **Merged** `93c3db58` (2026-09-14). Same `synchroStrength` reader for serialize / snapshot / Key radiation stub. |
| [#467](https://github.com/davins56/Anima-Protocol/pull/467) Keep group `CRITICAL INSTRUCTIONS` under 2k wrap | **Merged** `fcf57dbc` (2026-09-14). Follow-up to #463: `capUniqueContracts` reserves the group head; headings-only split (no history `[IMAGE:]`). |
| [#466](https://github.com/davins56/Anima-Protocol/pull/466) Audit docs (#458/#463/#464/#465) | **Merged** `c5f99465` (2026-09-14). |
| [#465](https://github.com/davins56/Anima-Protocol/pull/465) Companion self-state + visible mood | **Merged** `4e55b96d` (2026-09-14). `SELF-STATE` in `composePrompt`; SSE `companion_affect`. Key radiation still later. |
| [#464](https://github.com/davins56/Anima-Protocol/pull/464) Fail-closed self-hosted chat | **Merged** `245b5848` (2026-09-14). Usable custom host → `[local]` only. Do not re-enable OpenRouter to paper over a down anima-chat host. |
| [#463](https://github.com/davins56/Anima-Protocol/pull/463) Line-start transcript contracts | **Merged** `a6eb6544` (2026-09-14). Follow-up to #461: keep group `CRITICAL INSTRUCTIONS:`; ignore mid-line `[EMOTION:` / `[LOCATION:` in history rows. |
| [#461](https://github.com/davins56/Anima-Protocol/pull/461) Split transcript at contract markers | **Merged** `55d75fb6` (2026-09-14). Follow-up to #456: do not treat a blank line inside a user message as the transcript end. |
| [#458](https://github.com/davins56/Anima-Protocol/pull/458) Lean 1:1 Chat.jsx + TTFT caps | **Merged** `cfed7b3a` (2026-09-14). Solo extras via `buildLeanSoloClientContext`. Keeps `CORE_BEHAVIOR`, trailing lean extras, first-turn `AIBehaviorConfig`, user profile. Dropped client `CharacterMemory` without a distillation merge. Group path still fat. Ensemble minds keep OpenRouter out (`17da2ef6`). |
| [#457](https://github.com/davins56/Anima-Protocol/pull/457) Honor `req.maxTokens` on local Ollama | **Merged** `b59c2db5` (2026-09-14). |
| [#456](https://github.com/davins56/Anima-Protocol/pull/456) Keep IMAGE/EMOTION after `Story so far:` | **Merged** `f9db61c7` (2026-09-14). Still needed for group `buildGroupPrompt` until that path is thinned. |
| [#455](https://github.com/davins56/Anima-Protocol/pull/455) Slice 2 E2E — 1024 clamp + 18s open | **Merged** `2af82b82` (2026-09-14). `clampChatMessagesMaxTokens` + `llmChatMessagesOpenTimeoutMs()`. |
| [#454](https://github.com/davins56/Anima-Protocol/pull/454) Audit docs (Slice 1 shipped) | **Merged** `95283f32` (2026-09-14). |
| [#453](https://github.com/davins56/Anima-Protocol/pull/453) Slice 1 TTFT — SSE before context load | **Merged** `651670a6` (2026-09-14). `beginChatTurn` + replay/409 still run **before** `openChatSse`. Context load after headers is inside the generation `try/catch` (SSE `{ error }`, heartbeat stopped, turn marked failed). Default repo RAG gated; client wrap capped at 2k. Do **not** start a second Slice 1 PR. |
| [#450](https://github.com/davins56/Anima-Protocol/pull/450) Worker ETIMEOUT ≠ DB; `/api/ai/chat` 18s; **12s `localAttemptSignal` in shared failover**; probe 45s | **Merged** `f4a7010a` (2026-09-14). Do not re-open classification. Do **not** recommend another 12s hop on `/chat/messages`. |
| Rate-limit | Merged #125. User-keyed. Leave it. |
| `main` CI `api-tests` | Ensemble OpenRouter exclusion shipped in #458 `17da2ef6`. |
| Dependabot #449 | Ignore. |

---

## Recommended next 1–2 PRs (latency)

### Slice 1 — TTFT: open the stream, shrink prefill (P0-L1 + P0-L2) — **shipped in #453 + solo #458**

Do not duplicate. Remaining client fat prompt is **group** `buildGroupPrompt`. Do not start a third token-cap PR. Contract-split follow-ups **[#463](https://github.com/davins56/Anima-Protocol/pull/463)** / **[#467](https://github.com/davins56/Anima-Protocol/pull/467)** are on `main`.

### Slice 2 — E2E: honor token cap on local Ollama; stop 80s OpenRouter cascade (P0-L3) — **shipped in #455 + #457 + #464**

Do not duplicate. Next is identity Slice A — seed `companion_memories` on create, then **migrate** distilled `CharacterMemory` facts into that store (or the server prompt). Solo already dropped the client memory block (#458). Do **not** add `GET /chat/memories` to the client prompt.

### Explicitly not the first PR

- Another Slice 1 TTFT PR (SSE / repo RAG / 24k wrap) — **shipped in [#453](https://github.com/davins56/Anima-Protocol/pull/453)**.
- Another Slice 2 token-cap / 18s open PR — **shipped in [#455](https://github.com/davins56/Anima-Protocol/pull/455)** / [#457](https://github.com/davins56/Anima-Protocol/pull/457).
- Another contract-split / 2k wrap PR — **shipped in [#463](https://github.com/davins56/Anima-Protocol/pull/463)** / [#467](https://github.com/davins56/Anima-Protocol/pull/467).
- Re-enable OpenRouter after a preferred local host — **#464 fail-closed**.
- Worker ETIMEOUT / healthz probe classification (**done in #450**).
- Another 12s local hop on `/chat/messages` (**already in #450** via `localAttemptSignal`).
- Wiring `GET /chat/memories` into Chat.jsx `system_prompt` (would worsen double-prefill).
- Treating `upsertTurnMemory` crumbs as a replacement for distilled `CharacterMemory`.
- Ensemble / OpenRouter chain CI — **shipped in #458** `17da2ef6`.
- Putting the 18s `openStreamAbort` on opt-in `ANIMA_LOCAL_LLM_ENSEMBLE` gathering (off by default; not the production Chat path).
- Echo Key radiation from `radiationEventFromAffect` (#465 stub only), crossover pool recall, intimacy save-on-client-commit.
- Ollama keep_alive (runbook / host, not app).

---

## Evidence index

| Claim | Evidence |
|-------|----------|
| SSE after `beginChatTurn`, before context load | #453 `openChatSse` after replay/409; `chatTtft.test.ts` |
| Chat exempt from 20s wall | `workerApiGuard.ts` `isLongLivedApiPath` matches `/api/chat` |
| Client wrap ≤2k after stripping transcript | `promptBuilder.ts` `clientSceneExcerpt` / `CLIENT_SCENE_CONTEXT_MAX`; #456 keeps IMAGE/EMOTION; #461 splits at contract markers; #463 line-anchors headings; #467 `capUniqueContracts` keeps group `CRITICAL INSTRUCTIONS:` |
| Solo Chat.jsx lean extras | #458 `buildLeanSoloClientContext` / `LEAN_SOLO_CLIENT_CONTEXT_MAX` |
| Local Ollama honors `req.maxTokens` | #457 `cappedLocalMaxTokens` on `main` `b59c2db5` (not only #455 `262c275e`) |
| Chat.jsx streams deltas | `streamChatReply.js` `onDelta` per content event; `useChatStreaming` |
| Ensemble off by default | `localEnsemble.ts` `ANIMA_LOCAL_LLM_ENSEMBLE`; gathering path in `chat.ts` skips `openStreamAbort` |
| `/chat/messages` 18s open + 1024 cap | #455 `llmChatMessagesOpenTimeoutMs` + `clampChatMessagesMaxTokens`; default `createChatStreamWithFailover` path in `chat.ts` |
| Custom host is local-only | #464 `getProviderChain()` `[local]` when custom URL is usable; `llmFailover.ts` |
| 12s local hop already on `/chat/messages` | `llmFailover.ts` `localAttemptSignal` + `LLM_LOCAL_FAILOVER_ATTEMPT_MS`; only when a next provider exists |
| `/api/ai/chat` ≠ Chat.jsx | Chat.jsx → `animaApi.chat.sendMessage` → `/chat/messages`; both routes now 18s (`llmAiChatOpenTimeoutMs` / `llmChatMessagesOpenTimeoutMs`) |
| #450 merged | `origin/main` `f4a7010a`; `/api/ai/chat` still `llmAiChatOpenTimeoutMs()` (18s); `/chat/messages` now `llmChatMessagesOpenTimeoutMs()` (#455) |
| Companion clamp 1024 | #455 `clampChatMessagesMaxTokens`; `modelRouter.ts` heavy 8192 is not what `/chat/messages` sends |
| Server memories already in prompt | `chat.ts` `loadMemories` → `composePrompt` `formatMemoriesForPrompt`; solo Chat.jsx no longer `buildMemoryContext` (#458) |
| Repo RAG gated | `shouldRetrieveRepositoryKnowledge` — ordinary turns skip; `ANIMA_REPOSITORY_RAG=false` still hard off |
| Telemetry | `ttft_ms` from `generationStartedAt`; `repository_rag_ms` is nested in `context_load_ms` (`chat.ts` + `chatTelemetry.ts`) |
| Browser abort 130s | `animaApi.js` `CHAT_STREAM_TIMEOUT_MS = 130_000` |
