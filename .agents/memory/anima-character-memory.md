---
name: Anima per-character memory log (cross-session recall)
description: How the AI "remembers past conversations" — the characterMemory server function contract and pitfalls.
---

# Per-character cross-session memory

The AI "remembering past conversations" is driven by the server `characterMemory`
function (api-server functions.ts), NOT by the MemoryCrystal/Lore/VectorMemory
features. The whole client side is wired in `Chat.jsx`:
- `loadCharacterMemories(charId)` on session open → invoke `characterMemory` {action:"get"} → expects `res.data.memories`.
- save every 6 messages → invoke `characterMemory` {action:"save", user_message, ai_response, existing_memories} → expects `res.data.created`; reloads on created>0.
- prompt assembly injects them as "PERSISTENT MEMORIES" / "LONG-TERM MEMORY" blocks (fields used: `m.category`, `m.fact`).

**Why it was broken:** the server `characterMemory` case was a stub shared with
`respondMentalLine` — it ignored `action` and just returned free LLM text, so get
never returned memories and save never persisted. Characters never accumulated or
recalled anything.

**The contract:** `base44.functions.invoke` returns `json.result` (base44Client.js),
so handlers MUST return `result = { data: {...} }` for the client's `res.data.*`
to resolve. Stub handlers that `result = <text>` look fine but the client sees
`res.data === undefined`.

**Storage:** memories are generic store rows — `userEntities` with
`entityName="CharacterMemory"`, scoped to the Clerk `userId`, each `data` tagged
with `character_id` (plus category/fact/session_id/created_date). Load filters by
character_id in JS (per-user set is small), mirroring buildUserContextPrompt.

**Save hardening that matters:** `save` always makes an authenticated LLM call, so
clip message text and cap the existing-memory context passed to the model
(denial-of-wallet). Dedupe via a normalized-fact key against the authoritative
stored log (not just client-passed existing_memories). Call `notifyUser(userId)`
after inserts so other devices sync. Known minor gap: read→insert isn't
transactional/uniqueness-guarded, so truly concurrent saves could double-write a
fact (low risk in the sequential every-6-messages path).

**Still stubbed (hit the generic `default` LLM case, return garbage):**
`buildMemoryContext`, `formCrossSessionMemory`, `updateMemoryFromSession`,
`retrieveCrossSessionMemories`, `vectorMemorySearch`, `createVectorMemory`,
`searchMemoriesSemantically` (returns `{memories:[]}`). The `useCrossSessionMemory`
/ `useVectorMemorySystem` hooks call these — they are NOT the live recall path.
