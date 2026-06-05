---
name: Anima identity systems (soulprint / resonance / evolution / dream)
description: How the "digital being" roadmap features persist and where their non-obvious constraints live.
---

# Anima identity & presence systems

All new fields live directly on the schemaless `Anima` entity (no migration):
`soulprint {id,primary_trait,secondary_trait,core_drive}`, `resonance` (int),
`evolution_path`, `awakening_date`, `ceremony`, `last_visit`. Pure helpers in
`src/lib/soulprint.js` (path metadata, thresholds, deltas).

## Persistent resonance + evolution (Chat.jsx)
Accumulated CLIENT-SIDE in `handleSendMessage` after each solo exchange against
an Anima (`activeChar._isAnima`): read prev → `+resonanceDelta(emotionIntensity)`
→ `Anima.update({resonance, evolution_path?})`. `determineEvolution` only sets a
path once resonance crosses `EVOLUTION_THRESHOLD`.

**Why a `resonanceRef` (id→latest):** `activeChar` is derived from the
`characters` state closure, so two rapid sequential sends before a re-render
would both read the same stale prev and lose an increment. The ref accumulates
synchronously; we take `Math.max(ref, server)` so cross-device growth is also
caught (works only because `resonanceDelta` is always positive — resonance
currently only grows, despite `resonanceMood` having negative bands).

**Known tradeoff:** the write is absolute, not a server-side read-modify-write,
so truly concurrent multi-device sends can still clobber. Accepted for a
single-user companion app; revisit with a server function if it matters.

## Dream Mode + Echoes (useAnimaPresence.js)
On mount with a loaded primary Anima: if away > threshold since `last_visit`,
LLM-generate a short dream → persist as new `AnimaDream` entity → surface on
MainHome; then stamp `last_visit`. Echoes are PURELY DERIVED (no LLM) from
`awakening_date` anniversaries / round day counts.

**Loop-safety:** the effect writes `last_visit` AND has `anima.last_visit` in its
deps. A `lockRef` keyed by `anima.id` (run-once-per-Anima) prevents the
write→refetch→re-run loop. Do not remove it.
