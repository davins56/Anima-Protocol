---
name: Anima per-character memory log (cross-session recall)
description: How the AI "remembers past conversations" — the characterMemory contract and which memory functions are real vs stubbed.
---

# Per-character cross-session memory

"The AI remembering past conversations" is driven by the server `characterMemory`
function — NOT by the MemoryCrystal / Lore / VectorMemory features. The client
(Chat.jsx) loads a character's log on session open (action:"get"), injects it into
the prompt as "PERSISTENT MEMORIES" / "LONG-TERM MEMORY", and saves distilled
facts every few messages (action:"save").

**Non-obvious contract (the trap):** `base44.functions.invoke` returns
`json.result`, so an invoke handler must return `result = { data: {...} }` for the
client's `res.data.*` to resolve. A handler that returns plain text/`result = <x>`
compiles and "works" but the client silently sees `res.data === undefined` — which
is exactly why the original shared `characterMemory`/`respondMentalLine` stub made
memory a no-op (it returned free LLM text and ignored `action`).

**Decision — save is a per-user, repeatable LLM call, so it must be cost-bounded.**
Clip the exchange text and cap the existing-memory context fed to the model
(denial-of-wallet). Dedupe new facts against the authoritative *stored* log by a
normalized-fact key, not just the client-passed `existing_memories`.
**Why:** authenticated abuse / large payloads otherwise drive unbounded token cost,
and trusting only the client's list lets stale clients re-create duplicates.

**Known gap (acceptable, low risk):** the save read→insert is not transactional /
DB-unique-guarded, so truly simultaneous saves could double-write one fact. Fine in
the sequential every-few-messages path; revisit only if saves become concurrent.

**Still stubbed — these hit the generic `default` LLM case and return garbage, so
do NOT treat them as the live recall path:** `buildMemoryContext`,
`formCrossSessionMemory`, `updateMemoryFromSession`, `retrieveCrossSessionMemories`,
`vectorMemorySearch`, `createVectorMemory`, and `searchMemoriesSemantically`
(returns empty). The `useCrossSessionMemory` / `useVectorMemorySystem` hooks call
these; they are not wired into real persistence.
