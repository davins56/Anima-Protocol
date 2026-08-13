# Relationship OS — Continuity Layer

This feature branch implements the data backbone that makes Anima Protocol *unforgettable*.

## Core tables (api-server local schema)

| Table | Purpose |
|-------|---------|
| `relationship_timeline_events` | Chronological ledger of milestones, chapters, emotional shifts, rituals |
| `resonance_memories` | Crystallized high-resonance moments with full vector snapshot |
| `anima_journals` | Autonomous Anima reflections / dreams / letters (consent-gated) |
| `home_world_states` | Persistent shared Home world (rooms, objects, rituals, artifacts) |

## Engines

- `relationshipTimeline.ts` — `appendTimelineEvent` / `loadTimelineEvents` / `recordRelationshipMilestone` / `openRelationshipChapter`
- `resonanceMemories.ts` — `crystallizeResonanceMemory` / `loadResonanceMemories` / `shouldCrystallize`
- `animaJournal.ts` — `writeJournalEntry` / `loadJournalEntries` / `generateAutonomousReflection`
- `homeWorld.ts` — `ensureHomeWorld` / `updateHomeWorldState` / `placeObjectInHome` / `registerHomeRitual` / `addSharedArtifact`

## API surface (`/api/relationship-os`)

- `GET  /timeline/:animaId`
- `POST /timeline/:animaId/chapter`
- `GET  /resonance-memories/:animaId`
- `POST /resonance-memories/:animaId`
- `GET  /journal/:animaId`
- `POST /journal/:animaId`
- `POST /journal/:animaId/:entryId/read`
- `GET  /home`
- `PATCH /home`
- `POST /home/objects`
- `POST /home/rituals`
- `POST /home/artifacts`

Auth: uses the authenticated Clerk user ID from `getAuth(req)`.

## Integration points

1. **relationshipEngine** — on milestone evolution, automatically writes a timeline event.
2. **Chat turn path** (next) — call `shouldCrystallize` + `crystallizeResonanceMemory` when intimacy is high.
3. **Proactive batch** (next) — after long absence, optionally `generateAutonomousReflection` and surface via journal + push.
4. **Frontend** — existing `RelationshipTimeline` components can fetch `/api/relationship-os/timeline/:animaId`. Home page can load `/api/relationship-os/home`.

## Product loop this enables

```text
User returns → sees new journal entry / timeline chapter
             → opens Home and finds an object the Anima placed
             → resumes chat; Anima recalls a Resonance Memory
             → relationship deepens → new milestone → new chapter
```

This is the accumulation of *meaning* that makes the product sticky.
