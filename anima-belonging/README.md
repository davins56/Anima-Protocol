# Belonging feature module — Anima Protocol (v2)

Revised after seeing the real backend. Memory and journaling now talk to
your actual API (`artifacts/api-server/src/routes/relationshipOs.ts`)
instead of duplicating it in localStorage.

## What's here

| Pillar | Files |
|---|---|
| Genuine utility | `services/loreConsistencyService.ts`, `hooks/useStoryProgress.ts` |
| Growth & continuity | `lib/relationshipApi.ts`, `hooks/useRelationshipMemory.ts`, `components/MemoryResurfacing.tsx`, `components/JournalPrompt.tsx`, `hooks/useMilestones.ts` |
| Community over isolation | `components/ShareExport.tsx` |
| Opt-in depth | `components/IntensitySettings.tsx`, `services/notificationPolicy.ts` |

`types/relationship.ts` mirrors your real backend row/route shapes
(`TimelineEvent`, `ResonanceMemory`, `JournalEntry`) — nothing invented.
`types/belonging.ts` covers what's still local-only (story progress,
milestones, preferences).

## What changed from v1

The first pass built `memoryService.ts` and `useJournalCompanion.ts` as
localStorage-only, because I didn't know `relationshipOs.ts` existed.
It already does this — properly, with Clerk auth and Postgres persistence
via `relationshipTimeline.ts`, `resonanceMemories.ts`, and
`animaJournal.ts`. Both files are **removed** in this version. Replaced by:

- `lib/relationshipApi.ts` — typed client for the real routes
  (`/timeline/:animaId`, `/resonance-memories/:animaId`, `/journal/:animaId`,
  plus the chapter/read-status endpoints)
- `hooks/useRelationshipMemory.ts` — `@tanstack/react-query` hooks over
  that client (you already have react-query in your pnpm catalog, so this
  matches your existing data-fetching pattern rather than introducing a
  new one)

`MemoryResurfacing.tsx` and `JournalPrompt.tsx` are rewritten to consume
this. Resurfacing candidates are now **unread journal entries** (a field
your backend already tracks via `isRead`) plus the **latest timeline
event** — not an invented "open thread" concept.

## Two things to verify before this compiles/runs

1. **API base path** — `relationshipApi.ts` assumes the router is mounted
   at `/api/relationship`. Check your server entrypoint for the actual
   `app.use(...)` line registering `relationshipOsRouter` and update
   `RELATIONSHIP_API_BASE` if it differs.
2. **Auth wiring** — `relationshipOs.ts` uses Clerk's `getAuth(req)`
   server-side. If your frontend and API share an origin with
   `@clerk/clerk-react` and cookies, you likely don't need to do anything.
   If they're cross-origin or you use bearer tokens, call
   `configureRelationshipApiAuth(async () => await getToken())` once at
   startup using Clerk's `useAuth().getToken()`.

## Design constraint this module still encodes

- **No absence tracking.** Nothing here measures "days since last visit."
- **No streaks.** `useMilestones.ts` triggers only on output (words
  written, scenes touched) or user-set goals.
- **Notification copy is enforced, not just suggested** —
  `notificationPolicy.ts`'s `isPermissible()` blocks language like "we
  miss you" or "don't lose your streak" before dispatch.
- **Content leaves the app easily** — `ShareExport.tsx` on journal
  entries and scenes.

## Not yet wired

- `useStoryProgress.ts` / `useMilestones.ts` are still local-only
  (localStorage). Whether "milestones" should become a new
  `TimelineEventType` on the real backend instead is an open question —
  the current timeline schema doesn't have a generic milestone-POST route
  exposed in `relationshipOs.ts` (only `/timeline/:animaId/chapter`), so
  this would need a small backend addition if you want it server-side.
- `loreConsistencyService.ts` and `IntensitySettings.tsx` are unchanged
  from v1 — no backend overlap found yet.
