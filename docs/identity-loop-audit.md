# Chat latency + identity-loop audit

**Date:** 2026-09-14 (updated: #476 local-only 45s open)  
**Baseline:** `main` @ `a495cd07` (`#476`) / `56ec608a` (`#475`)  
**Owner priority:** AI response speed — **TTFT**, then end-to-end chat latency. Identity loop and Worker timeout/CI stay in this document, below latency.

Findings only. No runtime code in this PR.

Complements `docs/upgrade-audit.md` (#389, LLM/security). Slice 1 **[#453](https://github.com/davins56/Anima-Protocol/pull/453)** and Slice 2 **[#455](https://github.com/davins56/Anima-Protocol/pull/455)** (`2af82b82`: 1024 clamp helper + `llmChatMessagesOpenTimeoutMs()`) are on `main`. After **[#476](https://github.com/davins56/Anima-Protocol/pull/476)** that helper is **45s** local-only (`LLM_OPEN_TIMEOUT_LOCAL_ONLY_MS`); **`/api/ai/chat` stays 18s**. Local Ollama honors `req.maxTokens` (**[#457](https://github.com/davins56/Anima-Protocol/pull/457)**). Solo 1:1 Chat.jsx sends lean extras (**[#458](https://github.com/davins56/Anima-Protocol/pull/458)** `cfed7b3a`); production `/chat/messages` uses `chatReplyMaxTokens` (**1024 ordinary solo**; group / `deep_mode` keep the routed budget). Fat-prompt IMAGE/EMOTION survive **[#456](https://github.com/davins56/Anima-Protocol/pull/456)** / **[#461](https://github.com/davins56/Anima-Protocol/pull/461)** / **[#463](https://github.com/davins56/Anima-Protocol/pull/463)** / **[#467](https://github.com/davins56/Anima-Protocol/pull/467)** / **[#471](https://github.com/davins56/Anima-Protocol/pull/471)** (line-start headings; 2k wrap keeps group `CRITICAL INSTRUCTIONS:` and `OUTPUT FORMAT`). Group still uses fat `buildGroupPrompt`. Custom host is fail-closed local-only (**[#464](https://github.com/davins56/Anima-Protocol/pull/464)**). Companion self-state is on the prompt + mood chrome (**[#465](https://github.com/davins56/Anima-Protocol/pull/465)** / **[#468](https://github.com/davins56/Anima-Protocol/pull/468)**); Resonance Keys are still later.

---

## 0. Latency verdict (read this first)

Chat **does stream**. The UI is not waiting for a full reply before painting tokens (`streamChatReply` + SSE deltas). After [#453](https://github.com/davins56/Anima-Protocol/pull/453), the **first SSE byte is a heartbeat after `beginChatTurn`**, not after context load. [#476](https://github.com/davins56/Anima-Protocol/pull/476) also sends JSON `{ status: "progress", phase }` so the thinking bubble is not stuck on `...` while comments are dropped. Ordinary **solo** turns cap at **1024** tokens (`chatReplyMaxTokens`, #458); **group and `deep_mode` keep the routed budget** (4–8k). Chat.jsx `/chat/messages` opens in **45s** local-only (`llmChatMessagesOpenTimeoutMs` / `LLM_OPEN_TIMEOUT_LOCAL_ONLY_MS`) — not the **18s** `/api/ai/chat` wall and not the **80s** `:free` cascade. Opt-in `ANIMA_LOCAL_LLM_ENSEMBLE` gathers drafts **outside** that `openStreamAbort` (off by default; waits for N full drafts). Local Ollama honors `req.maxTokens` (#457). Solo client `system_prompt` is lean extras (#458). Remaining slowness is **group fat `buildGroupPrompt`**, **server CHARACTER / memories / CORE prefill**, then **generation**. A usable custom host does **not** hop to OpenRouter (#464).

User-perceived timeline for `POST /api/chat/messages` (production Chat.jsx, post-#458):

```
[click send]
  client builds lean extras (solo) or fat group prompt
  POST /chat/messages
    ensureSchemaOnce
    beginChatTurn                                 ← DB, before any SSE
      same-body generated → replay SSE            ← #474
      same-body in-flight → 409 turn_in_flight
      mismatch → mint new turn_id and generate
    writeHead SSE + heartbeat + progress JSON     ← first network byte (#453/#476)
    leftover repair unawaited                     ← #458, not on TTFT
    load characters, memories, stored embeddings
    world-knowledge peek + fire-and-forget warm   ← no live Open-Meteo on this turn
    supermemory search not on this path
    repository RAG only if repo-shaped / explicit ← #453 gated
    evolution / relationship / arc / intimacy
    composePrompt: Story so far stripped, wrap ≤2k
    open stream (outer 45s local-only #476;
      /api/ai/chat stays 18s)
      custom host → chain [local] only            ← #464, no OpenRouter hop
      no custom host → Workers AI, then OpenRouter if fallback is on
      12s hop only if a next provider exists
    first content delta                           ← visible TTFT
    …stream tokens…
    done → client persist                         ← E2E “can send again”
```

Telemetry (`ChatPipelineTelemetry`) records `context_load_ms` and `ttft_ms`, but **`ttft_ms` starts at `startGeneration()`** — after context load. After #453 the first *network* byte is a heartbeat; first *content* token still waits on context + prompt + model. Logs understate content TTFT. Perceived wait to first word ≈ `context_load_ms + prompt_build_ms + ttft_ms` (`repository_rag_ms` is nested inside `context_load_ms` when RAG runs; do not add it again).

### Teammate hypotheses — verified

| Hypothesis | Verdict |
|------------|---------|
| Waiting on full replies instead of streaming | **Mostly false.** Main path streams. Exceptions: opt-in `ANIMA_LOCAL_LLM_ENSEMBLE` (off by default, waits for N full drafts, **not** under the Chat.jsx `openStreamAbort`); image gen after the reply. Ordinary solo turns cap at 1024 (`chatReplyMaxTokens`); group and `deep_mode` keep the routed 4–8k budget. Leftover 1:1 E2E is prefill + model, not 4–8k decode. |
| Oversize context / memory retrieval | **Partly fixed.** Server strips `Story so far:` and caps the remainder at 2k (`clientSceneExcerpt`, #453). Solo Chat.jsx sends lean extras (#458). Group still *builds* fat `buildGroupPrompt` before POST. `composePrompt` still adds CHARACTER / memories / CORE. |
| Worker ~20s wall | **Does not race `/api/chat`.** `isLongLivedApiPath` exempts `/api/openai` and `/api/chat`. The 20s wall is store/healthz. **#450 merged:** Worker `ETIMEOUT` is no longer classified as a DB timeout; live `?probe=1` uses a **45s** bound. **`POST /api/chat/messages`** opens in **45s** local-only (#476 `LLM_OPEN_TIMEOUT_LOCAL_ONLY_MS`). **`POST /api/ai/chat`** stays **18s** (`llmAiChatOpenTimeoutMs`). The **80s** `:free` outer abort applies only when OpenRouter is actually on the chain (no custom host + fallback). |
| Cold Ollama | **True for ops; 12s hop only if a next provider exists.** After #476: Ollama `keep_alive: "10m"` (opt-out `ANIMA_OLLAMA_KEEP_ALIVE=off`) plus a best-effort native warm hint while context loads. `ANIMA_LOCAL_LLM_MAX_RETRIES` defaults to **2**. `localAttemptSignal` combines the caller abort with `LLM_LOCAL_FAILOVER_ATTEMPT_MS` (**12s**) whenever a next provider exists. **#464:** a usable custom host makes `getProviderChain()` `[local]` only — local connection/timeout returns `ai_timeout` / connection error, no OpenRouter hop. Do not set `ANIMA_OPENROUTER_FALLBACK` to paper over a down self-hosted host. |

---

## P0 — chat speed (do these first)

### P0-L1 — First SSE byte before context load (TTFT) — **shipped in #453**

**Shipped:** `openChatSse` runs after `beginChatTurn` + replay/409, before leftover repair / memories / embeddings / world-knowledge peek / RAG / `composePrompt`. Duplicate `turn_id`s: same-body generated/committed **replay**; same-body in-flight **409** `turn_in_flight`; different content **mints a new id** and generates ([#474](https://github.com/davins56/Anima-Protocol/pull/474)). Client retries once on `replayed` / 409 (`streamChatReplyWithTurnRetry`). [#476](https://github.com/davins56/Anima-Protocol/pull/476) adds JSON progress (`preparing` / `waking` / `generating`) on open, phase change, and the 8s heartbeat until first token — comment keepalives remain for proxies. Do not reopen the SSE-before-context ordering.

### P0-L2 — Stop double-prefill (TTFT + E2E) — **server wrap #453; solo lean #458; group still fat**

**Shipped:** `clientSceneExcerpt` strips `Story so far:` / `CONVERSATION CONTEXT:` and caps at `CLIENT_SCENE_CONTEXT_MAX` (2k). `shouldRetrieveRepositoryKnowledge` skips default RAG. Repository knowledge is its own prompt section.

**Shipped (fat-prompt contracts):** [#456](https://github.com/davins56/Anima-Protocol/pull/456) `f9db61c7` keeps IMAGE/EMOTION/LOCATION after `Story so far:`. [#461](https://github.com/davins56/Anima-Protocol/pull/461) `55d75fb6` splits at contract markers, not the first blank line inside a user message. [#463](https://github.com/davins56/Anima-Protocol/pull/463) `a6eb6544` line-anchors headings so `Speaker: [EMOTION: …]` is not a boundary. [#467](https://github.com/davins56/Anima-Protocol/pull/467) `fcf57dbc` keeps group `CRITICAL INSTRUCTIONS:` when the unique suffix exceeds 2k (head + tail; `INTELLIGENCE` is already in `CORE_BEHAVIOR`) and ignores own-line `[IMAGE:]` history rows. [#471](https://github.com/davins56/Anima-Protocol/pull/471) `bfc75a3c` reserves 400 chars of tail and clips the head with `clipGroupContractHead` so a long intimacy block cannot drop `OUTPUT FORMAT`.

**Shipped (solo client):** [#458](https://github.com/davins56/Anima-Protocol/pull/458) `cfed7b3a` — `buildLeanSoloClientContext` (≤2k extras; trailing matrix/length/image/Continue reserved). Server `composePrompt` owns identity, store history, memories, `CORE_BEHAVIOR`.

**Still open:** Group still concatenates sheets + transcript + `CRITICAL INSTRUCTIONS` via `buildGroupPrompt`. After [#471](https://github.com/davins56/Anima-Protocol/pull/471), a long unique suffix keeps a 1600-char head (`OUTPUT FORMAT` footer) and a **400-char end-slice**. Production `IMAGE GENERATION` (~479) + loyalty (~641) do not fit that slice, so the wrap can drop `[IMAGE:` while `composePrompt` re-adds `TURN_TAKING` / `LOYALTY_GUARDRAIL` but **not** the image-tag contract. Solo already reserves `imageInstruction` in `buildLeanSoloClientContext`. Do **not** start a fourth contract-split PR unless asked — this is a leftover, not a new split. Solo also dropped client `CharacterMemory` without a distillation merge into `companion_memories` (identity P1, not a speed PR).

### P0-L3 — Cap generation length; don’t use the 80s free-tier open budget on Chat.jsx — **shipped in #455 + #457 + #464 + #476**

**Shipped:**

1. [#457](https://github.com/davins56/Anima-Protocol/pull/457) `cappedLocalMaxTokens` so a caller cap reaches Ollama.
2. [#455](https://github.com/davins56/Anima-Protocol/pull/455) `2af82b82` adds `clampChatMessagesMaxTokens` (1024) and `llmChatMessagesOpenTimeoutMs()`. Production `/chat/messages` uses `chatReplyMaxTokens` (#458 `chat.ts`): **1024 for ordinary solo**; **group and `deep_mode` keep the routed budget**. Do not start a third token-cap PR.
3. [#464](https://github.com/davins56/Anima-Protocol/pull/464) `245b5848` — usable `ANIMA_LOCAL_LLM_BASE_URL` → chain `[local]` only. Local failure does not hop to OpenRouter. `ANIMA_OPENROUTER_FALLBACK` remains opt-in after Workers AI when **no** custom host is set.
4. [#476](https://github.com/davins56/Anima-Protocol/pull/476) `a495cd07` — local-only `/chat/messages` open is **45s** (`LLM_OPEN_TIMEOUT_LOCAL_ONLY_MS`). **`/api/ai/chat` stays 18s.** JSON progress SSE; Ollama `keep_alive: "10m"`; consume budget stays under the 130s browser abort (`llmChatMessagesStreamTotalMs`). Never the **80s** cascade. Never `llmOpenTimeoutMs({ freeTierCascade: false })` (**35s**) on Chat.jsx.

Do **not** re-apply `LLM_LOCAL_FAILOVER_ATTEMPT_MS`. Do not invent another open-budget constant. Optionally lower `LLM_STREAM_FIRST_CHUNK_MS` for anima-chat (50s is R1 `<think>`). Browser abort is still **130s**.

**Ops (not a code PR):** host-side warmup cron against `llm.anima-protocol.com` still helps cold boxes; in-app `keep_alive: "10m"` is already #476. `ANIMA_LOCAL_LLM_MAX_RETRIES=0` on a single-slot box. Worker can set `ANIMA_OPENROUTER_FALLBACK=false` to drop the remaining Workers AI → OpenRouter hop.

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
| `GET /chat/memories/:id` hydrates affect / mood, not `system_prompt` | Chat.jsx `companionMemory` on session setup; dashboard still uses `characterMemory` | **Do not** wire this into `system_prompt` (dual-inject). Fine as a debug/dashboard API plus mood chrome. |
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
| [#476](https://github.com/davins56/Anima-Protocol/pull/476) Local-only cold-start progress (45s `/chat/messages` open) | **Merged** `a495cd07` (2026-09-14). `LLM_OPEN_TIMEOUT_LOCAL_ONLY_MS` 45s; `/api/ai/chat` stays 18s. JSON progress SSE; Ollama `keep_alive: "10m"`; does **not** undo #464. Do **not** start a competing timeout / keep_alive PR. |
| [#475](https://github.com/davins56/Anima-Protocol/pull/475) Audit docs (#474 same-body replay) | **Merged** `56ec608a` (2026-09-14). |
| [#474](https://github.com/davins56/Anima-Protocol/pull/474) Stop turn-2 replay of prior assistant text | **Merged** `447ab86d` (2026-09-14). `classifyChatTurnReuse`: replay only when `userContent` matches; mismatch mints a new `turn_id`; same-body in-flight is 409 `turn_in_flight`. Client `streamChatReplyWithTurnRetry` + `sendingRef`. Does **not** reopen Slice 1 SSE order. |
| [#472](https://github.com/davins56/Anima-Protocol/pull/472) Audit docs (#471 + #458 hot-path claims) | **Merged** `c86bee80` (2026-09-14). |
| [#471](https://github.com/davins56/Anima-Protocol/pull/471) Keep `OUTPUT FORMAT` when the group contract is long | **Merged** `bfc75a3c` (2026-09-14). Follow-up to #467: `GROUP_CONTRACT_TAIL_RESERVE` 400; head up to 1600; `clipGroupContractHead` keeps the `OUTPUT FORMAT` footer. Do **not** start a fourth contract-split PR. Leftover: 400-char end-slice can drop production `IMAGE GENERATION:` / `[IMAGE:` (server does not re-add the tag contract). |
| [#470](https://github.com/davins56/Anima-Protocol/pull/470) Audit docs (#467/#468 collide table) | **Merged** `15b8c782` (2026-09-14). |
| [#468](https://github.com/davins56/Anima-Protocol/pull/468) Synchro snapshot bond-strength contract | **Merged** `93c3db58` (2026-09-14). Same `synchroStrength` reader for serialize / snapshot / Key radiation stub. |
| [#467](https://github.com/davins56/Anima-Protocol/pull/467) Keep group `CRITICAL INSTRUCTIONS` under 2k wrap | **Merged** `fcf57dbc` (2026-09-14). Follow-up to #463: `capUniqueContracts` reserves the group head; headings-only split (no history `[IMAGE:]`). Head/OUTPUT FORMAT clip shipped in #471. |
| [#466](https://github.com/davins56/Anima-Protocol/pull/466) Audit docs (#458/#463/#464/#465) | **Merged** `c5f99465` (2026-09-14). |
| [#465](https://github.com/davins56/Anima-Protocol/pull/465) Companion self-state + visible mood | **Merged** `4e55b96d` (2026-09-14). `SELF-STATE` in `composePrompt`; SSE `companion_affect`. Key radiation still later. |
| [#464](https://github.com/davins56/Anima-Protocol/pull/464) Fail-closed self-hosted chat | **Merged** `245b5848` (2026-09-14). Usable custom host → `[local]` only. Do not re-enable OpenRouter to paper over a down anima-chat host. |
| [#463](https://github.com/davins56/Anima-Protocol/pull/463) Line-start transcript contracts | **Merged** `a6eb6544` (2026-09-14). Follow-up to #461: keep group `CRITICAL INSTRUCTIONS:`; ignore mid-line `[EMOTION:` / `[LOCATION:` in history rows. |
| [#461](https://github.com/davins56/Anima-Protocol/pull/461) Split transcript at contract markers | **Merged** `55d75fb6` (2026-09-14). Follow-up to #456: do not treat a blank line inside a user message as the transcript end. |
| [#458](https://github.com/davins56/Anima-Protocol/pull/458) Lean 1:1 Chat.jsx + TTFT caps | **Merged** `cfed7b3a` (2026-09-14). Solo extras via `buildLeanSoloClientContext`. `chatReplyMaxTokens`: 1024 ordinary solo; group / `deep_mode` keep routed max. Leftover repair unawaited; world-knowledge peek. Keeps `CORE_BEHAVIOR`, trailing lean extras, first-turn `AIBehaviorConfig`, user profile. Dropped client `CharacterMemory` without a distillation merge. Group path still fat. Ensemble minds keep OpenRouter out (`17da2ef6`). |
| [#457](https://github.com/davins56/Anima-Protocol/pull/457) Honor `req.maxTokens` on local Ollama | **Merged** `b59c2db5` (2026-09-14). |
| [#456](https://github.com/davins56/Anima-Protocol/pull/456) Keep IMAGE/EMOTION after `Story so far:` | **Merged** `f9db61c7` (2026-09-14). Still needed for group `buildGroupPrompt` until that path is thinned. |
| [#455](https://github.com/davins56/Anima-Protocol/pull/455) Slice 2 E2E — 1024 clamp helper + open helper | **Merged** `2af82b82` (2026-09-14). `clampChatMessagesMaxTokens` + `llmChatMessagesOpenTimeoutMs()`. After #476 that helper is **45s** local-only; `/api/ai/chat` stays 18s. Production `/chat/messages` applies `chatReplyMaxTokens` (#458): 1024 ordinary solo only. |
| [#454](https://github.com/davins56/Anima-Protocol/pull/454) Audit docs (Slice 1 shipped) | **Merged** `95283f32` (2026-09-14). |
| [#453](https://github.com/davins56/Anima-Protocol/pull/453) Slice 1 TTFT — SSE before context load | **Merged** `651670a6` (2026-09-14). `beginChatTurn` + replay/409 still run **before** `openChatSse`. Context load after headers is inside the generation `try/catch` (SSE `{ error }`, heartbeat stopped, turn marked failed). Default repo RAG gated; client wrap capped at 2k. Reuse classify is **#474**. Do **not** start a second Slice 1 PR. |
| [#450](https://github.com/davins56/Anima-Protocol/pull/450) Worker ETIMEOUT ≠ DB; `/api/ai/chat` 18s; **12s `localAttemptSignal` in shared failover**; probe 45s | **Merged** `f4a7010a` (2026-09-14). Do not re-open classification. Do **not** recommend another 12s hop on `/chat/messages`. |
| Rate-limit | Merged #125. User-keyed. Leave it. |
| `main` CI `api-tests` | Ensemble OpenRouter exclusion shipped in #458 `17da2ef6`. |
| Dependabot #449 | Ignore. |

---

## Recommended next 1–2 PRs (latency)

### Slice 1 — TTFT: open the stream, shrink prefill (P0-L1 + P0-L2) — **shipped in #453 + solo #458**

Do not duplicate. Remaining client fat prompt is **group** `buildGroupPrompt`. Do not start a third token-cap PR. Contract-split follow-ups **[#463](https://github.com/davins56/Anima-Protocol/pull/463)** / **[#467](https://github.com/davins56/Anima-Protocol/pull/467)** / **[#471](https://github.com/davins56/Anima-Protocol/pull/471)** are on `main`.

### Slice 2 — E2E: honor token cap on local Ollama; stop 80s OpenRouter cascade (P0-L3) — **shipped in #455 + #457 + #464 + #476**

Do not duplicate. Next is identity Slice A — seed `companion_memories` on create, then **migrate** distilled `CharacterMemory` facts into that store (or the server prompt). Solo already dropped the client memory block (#458). Do **not** add `GET /chat/memories` to the client prompt.

### Explicitly not the first PR

- Another Slice 1 TTFT PR (SSE / repo RAG / 24k wrap) — **shipped in [#453](https://github.com/davins56/Anima-Protocol/pull/453)**.
- Another turn-id replay PR — **shipped in [#474](https://github.com/davins56/Anima-Protocol/pull/474)** (same-body only; mismatch mints a new id).
- A competing local-only open-budget / keep_alive PR — **shipped in [#476](https://github.com/davins56/Anima-Protocol/pull/476)**.
- Another Slice 2 token-cap / 18s `/api/ai/chat` open PR — **shipped in [#455](https://github.com/davins56/Anima-Protocol/pull/455)** / [#457](https://github.com/davins56/Anima-Protocol/pull/457). Chat.jsx local-only open is **#476** (45s).
- Another lean 1:1 Chat.jsx PR — **shipped in [#458](https://github.com/davins56/Anima-Protocol/pull/458)**.
- Another contract-split / 2k wrap PR — **shipped in [#463](https://github.com/davins56/Anima-Protocol/pull/463)** / [#467](https://github.com/davins56/Anima-Protocol/pull/467) / [#471](https://github.com/davins56/Anima-Protocol/pull/471). Known leftover: group image-tag contract vs 400-char tail — do not start a fourth split unless asked.
- Re-enable OpenRouter after a preferred local host — **#464 fail-closed**.
- Worker ETIMEOUT / healthz probe classification (**done in #450**).
- Another 12s local hop on `/chat/messages` (**already in #450** via `localAttemptSignal`).
- Wiring `GET /chat/memories` into Chat.jsx `system_prompt` (would worsen double-prefill).
- Treating `upsertTurnMemory` crumbs as a replacement for distilled `CharacterMemory`.
- Ensemble / OpenRouter chain CI — **shipped in #458** `17da2ef6`.
- Putting the 18s `openStreamAbort` on opt-in `ANIMA_LOCAL_LLM_ENSEMBLE` gathering (off by default; not the production Chat path).
- Echo Key radiation from `radiationEventFromAffect` (#465 stub only), crossover pool recall, intimacy save-on-client-commit.

---

## Evidence index

| Claim | Evidence |
|-------|----------|
| SSE after `beginChatTurn`, before context load | #453 `openChatSse` after replay/409; `chatTtft.test.ts` |
| Same-body `turn_id` replay only | #474 `classifyChatTurnReuse`; mismatch mints a new id; client `streamChatReplyWithTurnRetry` |
| Chat exempt from 20s wall | `workerApiGuard.ts` `isLongLivedApiPath` matches `/api/chat` |
| Client wrap ≤2k after stripping transcript | `promptBuilder.ts` `clientSceneExcerpt` / `CLIENT_SCENE_CONTEXT_MAX`; #456 keeps IMAGE/EMOTION; #461 splits at contract markers; #463 line-anchors headings; #467 `capUniqueContracts` keeps group `CRITICAL INSTRUCTIONS:`; #471 `clipGroupContractHead` keeps `OUTPUT FORMAT`. Production group image-tag prose can still miss the 400-char tail. |
| Solo Chat.jsx lean extras | #458 `buildLeanSoloClientContext` / `LEAN_SOLO_CLIENT_CONTEXT_MAX` |
| Local Ollama honors `req.maxTokens` | #457 `cappedLocalMaxTokens` on `main` `b59c2db5` (not only #455 `262c275e`) |
| Chat.jsx streams deltas | `streamChatReply.js` `onDelta` per content event; `useChatStreaming` |
| Ensemble off by default | `localEnsemble.ts` `ANIMA_LOCAL_LLM_ENSEMBLE`; gathering path in `chat.ts` skips `openStreamAbort` |
| `/chat/messages` 45s local-only open; 1024 ordinary solo | #476 `LLM_OPEN_TIMEOUT_LOCAL_ONLY_MS` via `llmChatMessagesOpenTimeoutMs`; #458 `chatReplyMaxTokens` in `chat.ts` (solo 1024; group / `deep_mode` keep routed max). `clampChatMessagesMaxTokens` is the 1024 helper, not the production group/deep path. |
| Custom host is local-only | #464 `getProviderChain()` `[local]` when custom URL is usable; `llmFailover.ts`. Without a custom host the chain can start Workers AI and OpenRouter if fallback is on. |
| 12s local hop already on `/chat/messages` | `llmFailover.ts` `localAttemptSignal` + `LLM_LOCAL_FAILOVER_ATTEMPT_MS`; only when a next provider exists |
| `/api/ai/chat` ≠ Chat.jsx | Chat.jsx → `animaApi.chat.sendMessage` → `/chat/messages` (45s local-only #476); `/api/ai/chat` stays 18s (`llmAiChatOpenTimeoutMs`) |
| #450 merged | `origin/main` `f4a7010a`; `/api/ai/chat` still `llmAiChatOpenTimeoutMs()` (18s); `/chat/messages` `llmChatMessagesOpenTimeoutMs()` is 45s after #476 |
| Progress SSE + keep_alive | #476 JSON `{ status: "progress", phase }`; Ollama `keep_alive: "10m"`; `llmChatMessagesStreamTotalMs` under 130s browser abort |
| Companion clamp 1024 | `chatReplyMaxTokens` for ordinary solo; group / `deep_mode` keep `routeModel` 4–8k. Heavy 8192 is not what ordinary 1:1 `/chat/messages` sends. |
| Leftover repair unawaited | #458 `scheduleLeftoverTurnRepair` after SSE heartbeat; must not delay TTFT |
| World knowledge peek | `peekRegionalWorldKnowledge` on hot path; `void fetchRegionalWorldKnowledge` warms cache |
| Server memories already in prompt | `chat.ts` `loadMemories` → `composePrompt` `formatMemoriesForPrompt`; solo Chat.jsx no longer `buildMemoryContext` (#458) |
| `GET /chat/memories/:id` affect chrome | Chat.jsx `companionMemory` hydrates `companion_affect` / mood; **not** `system_prompt` |
| Repo RAG gated | `shouldRetrieveRepositoryKnowledge` — ordinary turns skip; `ANIMA_REPOSITORY_RAG=false` still hard off |
| Telemetry | `ttft_ms` from `generationStartedAt`; `repository_rag_ms` is nested in `context_load_ms` (`chat.ts` + `chatTelemetry.ts`) |
| Browser abort 130s | `animaApi.js` `CHAT_STREAM_TIMEOUT_MS = 130_000` |
