# Continuity (feature/continuity)

Each companion is the same "her" on every surface, across visits.

## companion_state
`supabase/migrations/20261022280000_continuity.sql` adds a **derived view** with no stored copy, so it can't drift. It is backed by an **append-only snapshot table**.

**`companion_state` view, one row per (user, companion):**
- `last_interaction_at`: latest `turn` memory event.
- `active_band`: latest resonance encounter.
- `vessel_version`: max `character_vessel.version`.
- `last_dream_at` and `recent_dreams`: last 3 dreams from feature/dream-layer.
- `last_seen_at`.
- `unread_highlights`: high-weight memories since the last snapshot, or the last 7 days if there is none. Retracted memories are excluded.
- **Emotional tone** comes from `companion_memories.emotional_state.selfState.mood`. That table is managed by Drizzle, so the API joins it instead of the view depending on it.
- **Cross-surface echo** comes from `echo_themes`: recurring themes of PDFs shared in the last 14 days (`document_chunk` memories).

**`companion_state_snapshots` table:**
- Records what each surface loaded and when. A snapshot marks highlights as read.
- Append-only, select-own RLS, protected.

## Loaded at session start on every surface
`GET /api/continuity/:characterId?surface=chat|photo|vessel|resonance|home&tz_offset=&name=` returns `{state, presence, presence_label, greeting}` and appends a snapshot. If it fails, it falls back to an empty state; it never breaks a page.

| Surface | Where |
|---|---|
| Chat | `ChatHeader` (solo): presence and a one-time greeting |
| Photo | `InlinePhotoComposer` header |
| Vessel | `VesselStudio` canvas corner |
| Resonance | `Resonance` scanner corner (Serenity first) |

The chat prompt also gets a short **Continuity** block, built in `memoryCore/sessionContext.ts` in parallel with recall. It carries:
- the carried-over tone;
- a recent dream, to be mentioned only if it fits;
- PDF themes, to colour her tone, not to be recited;
- the last band;
- unread moments.

## Greetings and presence
- **Greeting:** `continuityGreeting` uses the user's local part of day (from the browser's `getTimezoneOffset`) and the length of the gap. A dream fragment is added only after a gap of 6 hours or more. The client shows each greeting once per companion (localStorage).
- **Presence:** `presenceState` is tied to the dream scheduler's inactivity window:
  - here: under 10 minutes since the last turn;
  - lost in thought: inside the window;
  - dreaming: past the window and not yet dreamt, or a dream in the last 45 minutes (the dot pulses);
  - resting: otherwise.

## Recall tuning (relevance + recency, nothing forgotten)
`recall_memories` v3 keeps the same signature. The only change is the recency term: it is still a half-life decay but floored at **0.12**. Candidates are pre-selected by vector similarity first, so an old memory that is relevant always competes, and age only makes it quieter.

The weights are now tunable from env without a migration (`memoryCore.recallWeights`):

| Var | Default |
|---|---|
| `ANIMA_RECALL_HALF_LIFE_DAYS` | 30 |
| `ANIMA_RECALL_W_SIMILARITY` | 0.6 |
| `ANIMA_RECALL_W_RECENCY` | 0.25 |
| `ANIMA_RECALL_W_EMOTION` | 0.15 |

## Remaining
- Echo uses PDFs only. Photo-prompt themes are not echoed yet.
- The `companion_state` view scans `memory_events` for distinct pairs when it is queried without a filter. Always filter by user and companion, as the API does.
- The greeting appears in the header, not as a chat message.
- No device testing.
