---
name: Anima story mode (canonical stories)
description: Product model + two recurring gotchas behind "chat at any part of any series".
---

# Story mode — canonical stories / insertion points

Story mode = enter a chat seeded at a chosen scene ("insertion point") of a
canonical series. It is a **self-insert** feature: the user brings THEIR own
Character/Anima into a canonical scene — there is no requirement that the
series' canonical cast exist as saved Character entities. Adding a new series
needs only `insertionPoints` data in `canonicalStories.js`, not matching
characters.

The narrator opening shows up purely from the inline `messages:[narrator]` blob
on `ChatSession.create` — the server migrates that blob to rows on first
`GET /messages`, so no follow-up `update({messages})` is needed.

## Two gotchas that made it look unbuilt
1. **Set-state-then-act on the same tick reads stale state.** A create handler
   was called right after `setSelectedInsertions(...)` and re-read the still-empty
   state, hit its `length === 0` guard, and silently created nothing.
   **Rule:** any "set then immediately act" handler must pass the value
   explicitly, never re-read the just-set React state. (Same class of bug: an
   `onClick={fn}` that should be `onClick={() => fn()}` so the click event isn't
   passed as the first arg.)
2. **Gating the character list on canonical names emptied it.** Filtering saved
   characters by the story's canonical name list dead-ended almost every series
   (those names aren't seeded entities, and it contradicts self-insert). Show all
   of the user's characters/Animas instead.

**Why it matters:** both bugs failed *silently* (empty list / no-op create), so
the feature looked missing rather than broken — check these first if a wired flow
"does nothing".
