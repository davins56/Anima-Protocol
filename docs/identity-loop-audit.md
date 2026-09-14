# Identity-loop upgrade audit

**Date:** 2026-09-14  
**Baseline:** `main` @ `f005e052` (`Set up chatting function`)  
**Scope:** companion create → memory-backed chat → stream → persist, then crossover / resonance on top.  
**Not in scope:** more LLM plumbing. That layer is mostly done (`llmFailover`, local Ollama, Worker stream budgets). See `docs/upgrade-audit.md` (2026-09-07, #389) for the earlier LLM/security audit.

This is findings only. No runtime code in this PR.

---

## 1. Current path — what works, what’s stubbed, what’s incomplete

### End-to-end (production Chat page)

```
create companion          POST /api/store/Character|Anima   (user_entities)
        │                 createCompanionRecord — timeout/retry hardened (#371)
        │                 does NOT seed companion_memories
        ▼
open session              POST /api/store/ChatSession
        │                 group sets is_crossover + shared_memory: []
        │                 typed chat_sessions row appears only on first /chat/messages
        ▼
send turn (Chat.jsx)      client builds a large systemPrompt
        │                 Scene Mind runs client-side; /messages gets useSceneMind:false
        │                 POST /api/chat/messages  persist:false  persistence_owner:client
        ▼
server generate           beginChatTurn → load companion_memories + hash embeddings
        │                 composePrompt wraps the client prompt as clientContext
        │                 SSE stream → checkpointGeneratedTurn (chat_turns status=generated)
        ▼
client persist            store ChatMessage appends (user_entities) + ChatSession update
        │                 then POST /chat/turns/:id/commit
        ▼
commit                    recordTurnContinuity → companion_memories + session.shared_memory
                          synchro / evolution / relationship (best-effort)
```

| Step | Status | Notes |
|------|--------|--------|
| Companion create | **Works** | `artifacts/anima-protocol/src/lib/createCompanion.js` → generic store. Timeout/retry/recover landed in #371. No `companion_memories` row. |
| Session create | **Works** | `createInitSession.js` / `NewSessionModal.jsx`. Group writes `is_crossover` + empty `shared_memory`. |
| Stream | **Works** | `/api/chat/messages` SSE, heartbeat, `consumeLlmStream`, turn checkpoint before `done`. Worker 20s wall is a separate reliability track (see §3 / #450). |
| Persist messages | **Works (client-owned)** | Production Chat always sends `persist: false`. Durable history is `user_entities` `ChatMessage` rows. Typed `chat_messages` is **not** written on this path. |
| Persist memory | **Partial** | `commitTurn` writes a raw `User: … \| Companion: …` fact into `companion_memories.facts` (last 24). Extracted identity facts live in a **second** store (`CharacterMemory`) and only fire every 6 solo messages. |
| Memory → next prompt | **Split / incomplete** | Server `composePrompt` reads `companion_memories`. Chat.jsx prompt reads `CharacterMemory` via `characterMemory` invoke. Frontend never calls `GET /api/chat/memories/:id` or `GET /api/chat/sessions/:id/context`. |
| Crossover | **Hooks exist, recall is thin** | Scene Mind + `shared_memory` + `is_crossover` analytics work. Prompt scoring **filters to the speaker** (see §4). |
| Resonance | **Emotion vector live; Key radiation greenfield** | Synchro persists on `companion_memories.emotionalState`. Echo Keys inject static lore. Crystallized `resonance_memories` is not in `ensure-schema` and swallows missing-table errors. |

### Two chat clients, only one is production

| Surface | Persist owner | Mounted? |
|---------|---------------|----------|
| `pages/Chat.jsx` | `client` / `persist: false` | **Yes — this is chat.** |
| `hooks/useChatNucleus.js` + `ChatExperienceNucleus.jsx` | `persist: true` (server writes messages + memory) | **No.** Prototype / unused in `ProtocolApp`. |

Do not “finish the nucleus” as a rewrite. Extend `Chat.jsx` + `/api/chat`. Kernel rule: `docs/ANIMA_KERNEL.md` — no second companion DB, no second chat runtime.

### Two memory systems (the real identity-loop hole)

| Store | Table / entity | Written by | Read by live prompt? |
|-------|----------------|------------|----------------------|
| Typed companion memory | `companion_memories` + `memory_embeddings` | `commitTurn` / server persist | **Server only** (`promptBuilder` / `retrieveRelevantMemories`) |
| Extracted facts | `user_entities` `CharacterMemory` | `POST /openai/invoke/characterMemory` every **6** solo messages | **Client only** (`buildMemoryContext` in Chat.jsx) |
| Session blob | `ChatSession.shared_memory` | commit, crossover turns only | Server `composePrompt` when `isCrossover` |
| Relationship OS crystals | `resonance_memories` (api-server local schema) | `shouldCrystallize` after synchro | Relationship OS UI; **not** Chat.jsx; table **not** in `lib/db` `REQUIRED_TABLES` |

`companion_memories.facts` today are transcript crumbs (`type: "turn"`), not durable identity facts. Embeddings default to `hash-bow-v1` unless `ANIMA_EMBEDDINGS_BASE_URL` is set (`lib/llm/src/embeddings.ts`).

### Two message ledgers

| Ledger | Written on production Chat? | Consumers |
|--------|-----------------------------|-----------|
| `user_entities` `ChatMessage` | **Yes** (client `persistTurn`) | Chat UI, `readRecentStoreMessages` |
| `chat_messages` / `chat_sessions` | Session row: **yes** (pre-stream `syncTypedSession`). Message rows: **no** on client persist | `proactiveMessages.ts` reads **typed** `chat_messages` |

So proactive check-ins can miss the conversation the user actually had, even when Chat UI history is fine.

---

## 2. Prioritized upgrades

### P0 — identity loop (highest leverage)

#### P0-1 — Make `companion_memories` the live prompt source on Chat.jsx

**What’s wrong:** After a committed turn, the server remembers the transcript crumb, but the next Chat.jsx send builds LONG-TERM MEMORY from `CharacterMemory` (empty until message 6, solo-only). Server retrieval and client retrieval disagree.

**Where:** `artifacts/anima-protocol/src/pages/Chat.jsx` (`loadCharacterMemories`, `buildMemoryContext`); `artifacts/api-server/src/routes/chat.ts` `GET /memories/:characterId` (exists, unused); `lib/chatPromptContext.js`.

**Why it matters:** This is the identity loop. Create → chat → remember → next turn. Today “remember” is two half-implementations.

**Approach:** On session open / character select, `GET /api/chat/memories/:characterId` and inject those facts (plus summary / resonance notes) into the client prompt **or** stop sending a competing memory block and trust `composePrompt`. Keep `CharacterMemory` as the Memories UI until a merge PR.

#### P0-2 — Seed memory on companion create; write typed messages on client commit

**What’s wrong:**

1. `createCompanionRecord` never inserts `companion_memories`. First recall cannot exist until commit of turn 1.
2. `commitTurn` records memory but does **not** `persistTypedMessage`. Production path therefore never fills `chat_messages`.

**Where:** `createCompanion.js`; `store.ts` `POST /:entity`; `chat.ts` `router.post("/turns/:turnId/commit")` vs `persistLedgerTurn`.

**Why it matters:** Create is not wired to memory. Proactive messages / any server reader of typed chat will see empty history for real users.

**Approach:** On Character/Anima create (store hook or dedicated call), upsert `{ summary, facts: [], emotionalState: {}, resonanceNotes: "" }`. On `commitTurn`, call the same typed-message writes `persistLedgerTurn` already has (idempotent `onConflictDoNothing`).

#### P0-3 — Durable facts, not only transcript crumbs

**What’s wrong:** `upsertTurnMemory` stores clipped User/Companion text. `characterMemory` invoke already distills 0–3 facts via LLM — into the *other* table, throttled, solo-only.

**Where:** `chat.ts` `upsertTurnMemory`; `routes/openai/functions.ts` `saveCharacterMemories` / `extractCharacterMemories`; `lib/llm` `classifyFact`.

**Why it matters:** Retrieval cannot recall “they take chamomile with honey” if the only facts are 240-char turn dumps.

**Approach:** Run (or reuse) fact extraction **on commit** into `companion_memories.facts` with `type` / `fact_id`, then `upsertMemoryEmbeddings`. Do not add a third store. Optionally dual-write the same facts to `CharacterMemory` so the Memories UI stays in sync.

### P1 — crossover / resonance on top of a working loop

#### P1-1 — Crossover recall actually uses the participant pool

**What’s wrong:** Comment in `promptBuilder.ts` says scoring across every companion’s memories lets speaker A recall speaker B’s facts. Code then **filters to the speaker** before `retrieveRelevantMemories`. Shared session memory is only appended when `mode === "group" && distinctUniverses >= 2`. Same-universe group gets Scene Mind but no `shared_memory`.

**Where:** `artifacts/api-server/src/lib/promptBuilder.ts` (~507–535); `chat.ts` `isCrossover` and `recordTurnContinuity`; `sceneMind.ts` (works).

**Why it matters:** Crossover is the stated value moment (`message_sent` + `is_crossover`). Director works; shared identity does not.

#### P1-2 — Resonance Keys: emotion → how a Key radiates

**What’s wrong:** Echo Keys are a real catalog (~800 + canon Resonance Keys in `echoKeys/canon.js`). Chat injects a **static** lore blurb when the universe/scene matches BN/Star Force (`echoKeyPromptBlock`). NetBattle uses folder/resonance **combat** rules. Nothing reads `companion_memories.emotionalState` / synchro vector to change Key color, intensity, or prompt radiation.

**Where:** `artifacts/anima-protocol/src/lib/echoKeys/index.js` `echoKeyPromptBlock`; `rules.js` `ECHO_RESONANCE` / `drawResonanceHand`; `api-server/src/lib/synchroEngine.ts`; `resonanceState.ts`.

**Why it matters:** Product direction is consciousness/emotion affecting Key radiation. Combat + lore hooks exist; the emotion → Key link is greenfield.

**Do not:** add a second Codex or new recipes (`HIDDEN_SEQUENCES.md`).

#### P1-3 — Persist resonance crystals for real

**What’s wrong:** `crystallizeResonanceMemory` writes `resonance_memories`, but that table is **not** in `lib/db` `REQUIRED_TABLES` / `ensure-schema.ts`. Missing relation → return `null`. Relationship OS UI can look empty in production even when synchro says crystallize.

**Where:** `api-server/src/db/schema.ts` `resonanceMemories`; `lib/resonanceMemories.ts`; `lib/db/src/ensure-schema.ts`.

#### P1-4 — Virus / dark-route progression

**What’s wrong:** Hidden Sequences already own weather (`lull` / `stir` / `storm`), jack-in gates, and virus silhouettes (`Halo.Vrs`, …). Chat passes `hidden_sequences` + weather into `composePrompt`. There is **no** campaign / dark-route skill tree, no persisted “route taken,” no virus that mutates with synchro.

**Where:** `artifacts/anima-protocol/docs/HIDDEN_SEQUENCES.md`; `src/lib/hiddenSequences/*`; `api-server/src/lib/hiddenSequences.ts`; `battleModels.ts`.

**Approach:** Persist weather + learned_life on the session (already in metadata) into `companion_memories` or session metadata as a first-class `route` field. Do not rebuild NetBattle.

### P2 — do not confuse with the identity loop

| ID | Item | Where | Why later |
|----|------|-------|-----------|
| P2-1 | Dual prompt (Chat.jsx sheet + `composePrompt`) | `Chat.jsx` ~1467+, `promptBuilder.ts` | Works; identity lock can fight. Shrink client prompt after P0-1. |
| P2-2 | Hash embeddings | `lib/llm/src/embeddings.ts` | Fine until facts are durable. Then optional real embed host. |
| P2-3 | Intimacy save skipped on client persist | `chat.ts` post-stream `if (persistenceOwner !== "server") return` | Adult-gated; commit does not save intimacy profile/scene. |
| P2-4 | Unused `GET /chat/sessions/:id/context` | `chat.ts` | Wire or delete after P0-1. |
| P2-5 | `ChatExperienceNucleus` unused | `components/chat/` | Do not promote to production. |
| P2-6 | CORS / healthz fingerprints / steward grants / VoiceCloneManager | `docs/upgrade-audit.md` P1-4… | Still valid; not identity-loop. |

LLM P0s from #389 (Secrets Store local URL, fail-closed chain, schema POST auth, Codespace terminal) were follow-up work from that audit — **do not re-open as this PR’s job.** Confirm in a later ops pass; they are not the identity loop.

---

## 3. Open PRs / branches — do not collide

### Open now (2026-09-14)

| PR | Branch | Topic | Collision |
|----|--------|-------|-----------|
| **[#450](https://github.com/davins56/Anima-Protocol/pull/450)** | `cursor/fix-worker-etimeout-db-misclass-9b3b` | Worker 20s wall misclassified as DB timeout; `/api/ai/chat` 18s open timeout; hop vs `ai_timeout` JSON | **Do not duplicate.** Touches `dbErrors.ts`, `workerApiGuard.ts`, `chatTimeouts.ts`, `llmFailover.ts`. Identity-loop PRs should avoid those files unless rebasing after merge. |
| [#449](https://github.com/davins56/Anima-Protocol/pull/449) | Dependabot `sharp` in `/deepseek-llm` | Unrelated | Ignore |

#450 CI: lint / typecheck / frontend-tests green; **`api-tests` red** on pre-existing `test/llmEnsemble.test.ts` (expects chain `["local"]`, CI has OpenRouter in chain). Same failure is on **`main`** (`Set up chatting function`, run `34803208690`).

### Related, already merged (do not redo)

| PR | What it already did |
|----|---------------------|
| #389 | Prior upgrade audit (LLM/security). `docs/upgrade-audit.md`. |
| #330 | Chat turn races / client-commit continuity (`commitTurn` memory path). |
| #382 | supermemory.ai dual-write (optional; Postgres remains source of truth). |
| #371 / #372 / #357 / #318 | Companion create + store + Init timeouts. |
| #125 | Chat rate-limit keyed by Clerk user, not shared proxy IP. **Still in code:** `rateLimit.ts` + `/messages` 60/min. Not an open hole. |
| #340 / #440 | Store timeout classification / Worker list hang. |
| #448 / #447 | Local Ollama `/api/ai/chat`; prefer anima-chat. |

### Rate-limit / CI

- **Rate-limit:** no open PR. #125 shipped. `/chat/messages` is isolated from context GETs. Leave it unless a new 429 shows up in prod.
- **CI hardening (separate small PR, not identity):** `llmEnsemble.test.ts` vs CI `OPENROUTER_API_KEY` / `ANIMA_LLM_PROVIDER=custom` without a local URL. Also `gin_trgm_ops` missing in the CI Postgres service (logged, tests still reached ensemble asserts). **Do not fold this into #450** unless that PR’s author wants it; they already called ensemble failures pre-existing.

---

## 4. Crossover + resonance vs schema/API

### Already in schema / API (hooks)

| Capability | Schema / API | Used in live Chat? |
|------------|--------------|--------------------|
| Group + crossover flag | `ChatSession.is_crossover`, `chat_sessions.is_crossover` | Analytics + server `isCrossover` |
| Shared session facts | `ChatSession.shared_memory` JSON | Written on crossover commit; injected if `isCrossover` |
| Scene Mind | `POST /api/chat/scene-mind`; also inline in `/messages` | Chat.jsx runs its own picker, then disables server Scene Mind |
| Per-companion memory | `companion_memories` unique `(user_id, character_id)` | Server prompt yes; Chat.jsx no |
| Synchro / resonance vector | `emotionalState` JSON + `resonanceNotes` | Yes on generate + commit |
| Mode registry | `chatModeRegistry.ts` `crossover` safety profile | Yes |
| Echo / Resonance Key catalog | Frontend `echoKeys/*` | Combat + static lore prompt |
| Virus / storm jack-in | Hidden Sequences | Yes, in-character weather |
| Relationship OS crystals | `resonance_memories`, `/api/relationship-os/resonance-memories` | Side UI; table may not exist on Worker schema ensure |

### Greenfield gaps (no schema yet, or unused)

1. **Cross-companion fact recall** — code explicitly prevents it (`speakerMemories` filter). Need a retrieval mode: speaker facts + tagged shared facts, not a dump of every private memory.
2. **Emotion → Echo Key radiation** — no column tying `emotionalState` / synchro level to a Key’s prompt or battle chip. Smallest hook: pass synchro vector into `echoKeyPromptBlock` (and later NetBattle `echoResonanceChip`).
3. **`resonance_memories` not in `ensure-schema`** — crystallization is fail-soft.
4. **Dark-route progression** — weather is ephemeral per turn metadata. No `route`, `corruption`, or virus-evolution field on companion or session.
5. **No `PUT /chat/memories`** — Memories UI edits `CharacterMemory` only.

Kernel constraint (`ANIMA_KERNEL.md`): identity lock wins; Operator Model must not overwrite `companion_memories`. Crossover must not smash Serenity into another companion’s voice (`chatParticipants` / group TURN RULES already exist).

---

## 5. Recommended next slices (one focused PR each)

### Slice A — Live memory on the Chat page (P0-1 + seed from P0-2)

**PR size:** S–M. Frontend + a tiny store/chat hook.

1. After Character/Anima create, upsert empty `companion_memories`.
2. Chat.jsx: `GET /api/chat/memories/:characterId` on session open (solo + each group member).
3. Feed those facts into `buildMemoryContext` (or replace it) so turn 2 remembers turn 1 without waiting for the 6-message invoke.
4. Tests: `createCompanion` / Chat load / `chatLifecycle`.

**Out of slice:** fact extraction LLM, embeddings host, nucleus component, Worker timeout files.

### Slice B — Client commit writes the typed ledger (rest of P0-2)

**PR size:** S. `chat.ts` `commitTurn` only (+ tests).

Call `persistTypedMessage` / `syncTypedSession` from the client-commit path (same helpers as `persistLedgerTurn`). Keep message-row writes idempotent. Unblocks proactive messages and any future server reader.

**After A+B:** Slice C (not this week’s first PR) = extract durable facts on commit into `companion_memories` (P0-3). Slice D = crossover pool recall (P1-1). Slice E = synchro → Echo Key prompt tint (P1-2).

**Do not start:** #450’s Worker ETIMEOUT work; `llmEnsemble` CI (unless a dedicated CI PR); Echo Key catalog expansion; NetBattle rewrite.

---

## Evidence index

| Claim | Evidence |
|-------|----------|
| Production Chat is client-persist | `Chat.jsx` `persist: false`, `persistenceOwner: "client"` |
| Nucleus unused | `ChatExperienceNucleus` has no `ProtocolApp` import |
| `GET /memories` unused by SPA | repo grep: no frontend callers |
| `GET /sessions/:id/context` unused | same |
| Typed messages skipped on client commit | `commitTurn` → `recordTurnContinuity` only; `persistTypedMessage` is in `persistLedgerTurn` / pre-stream `shouldPersist` |
| Memory facts are transcripts | `upsertTurnMemory` `type: "turn"` |
| CharacterMemory every 6, solo | `Chat.jsx` `finalMessages.length % 6 === 0` + `mode === "solo"` |
| Crossover scoring filtered to speaker | `promptBuilder.ts` `speakerMemories` filter vs comment |
| Echo Key prompt is static lore | `echoKeyPromptBlock` returns `echoKeyLoreBlock()` or `""` |
| `resonance_memories` not ensured | `REQUIRED_TABLES` in `lib/db/src/ensure-schema.ts` |
| Open timeout PR | #450, updated 2026-09-14 |
| Rate-limit already user-keyed | #125; `rateLimit.ts` `user:${userId}` |
| Main CI api-tests | `llmEnsemble.test.ts` 3 fails; OpenRouter in chain |
