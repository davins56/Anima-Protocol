---
name: Anima character seeding race
description: Why localStorage character seeding double-seeded and how the guard must work
---

# Character seeding double-seed under StrictMode

Anima characters are localStorage-backed (via `base44Client.js`), seeded once by
`src/lib/seedCharacters.js`, invoked from a `useEffect([])` in `App.full.jsx`.

**Bug:** the seed was async and set its `SEED_KEY` localStorage guard only *after*
the `await`+create loop. `main.jsx` wraps the app in `React.StrictMode`, which
double-invokes effects in dev, so both passes ran the loop before either set the
guard → every roster seeded twice (18 → 36).

**Rule:** any "seed/migrate once" routine triggered from an effect must be
race-safe against StrictMode's double invoke — use a module-level promise lock so
concurrent calls share one run (and/or set the guard synchronously before the
first await). Setting a localStorage guard only at the end is not enough.

**Why:** StrictMode intentionally double-fires effects in dev; an end-of-run guard
leaves a window where both runs proceed.

**How to apply:** when adding any new one-time seed/migration here, gate it the same
way (promise lock + a dedicated `*_SEED_KEY`). A module-level lock only covers one
tab; multi-tab simultaneous first-run is a known residual gap (not yet handled).

Note: the `api-server` dev workflow runs `build && start` (esbuild, no watch), so
restart that workflow to pick up backend source edits before curling endpoints.

## Extension: Lore Archives crystal generation

The same StrictMode/concurrent-open race applies to Lore Archives memory crystal
auto-generation (`LoreArchivesDashboard.jsx` `autoGenerateCrystals`, run from a
no-guard load effect). Fixed with the same shape: a module-level promise lock
(`crystalGenLocks`, keyed by email) so concurrent opens share one pass, PLUS a
re-read of existing crystals *inside* the locked critical section so a sequential
re-open never mints a second crystal for an already-crystalized session. The lock
is per-runtime, so two separate devices/processes are still a residual gap — that
needs a server-side (user_email, session_id) uniqueness guard, not a client lock.

## Server-side crystal uniqueness (cross-device source of truth)

Client locks are per-runtime, so two devices/tabs (separate processes) could
still both mint a crystal for the same session. The authoritative guard lives in
api-server `store.ts` POST /:entity: for `MemoryCrystal` with a `session_id`, it
runs inside a transaction holding `pg_advisory_xact_lock(hashtext(userId),
hashtext(sessionId))`, checks for an existing crystal (`data ->> 'session_id'`),
and returns it (HTTP 200) instead of inserting a duplicate; a real insert is 201.
The generic `user_entities` unique index is on the generated entityId, NOT
session_id, so it does NOT dedup crystals by session — the advisory-lock
check-then-insert is what guarantees one-per-session under concurrent writers.
