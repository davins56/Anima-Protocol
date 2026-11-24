# Anima Essence: frontend (flagged) and what it needs from the server

In-house rebuild of Dàvīn's Base44 prototype "Anima Essence"
(anima-essence-vault.base44.app). Approved by Dàvīn on Nov 23, 2026: start now,
in parallel with #757/#763/#765/#768/#769; screen order Calibrate → Vessel
Awakens → Aspects → Reflections → Patterns; dream-journal hold lifted for this;
save every vessel type's settings but only fully render Humanoid until 3D Visual
catches up.

## Flag

`VITE_ANIMA_ESSENCE=1` at build time. Off by default: without it the
`/essence/:characterId?/:screen?` route is not mounted and the page renders
"not available". No server flag yet; once Backend Data ships Essence routes,
they should sit behind a server flag `ANIMA_ESSENCE` (404 when off), and the
page will also ask `/api/essence/status`, the same way martial arts and the
Aetherial Net do.

## What each screen uses today

| Screen | Live data (shipped routes) | Waiting on |
|---|---|---|
| Calibrate | – | Calibration storage route (Backend Data) + calibrated vessel render (3D Visual). Saved on this device per character in `localStorage["anima_essence_v1"]` until then. Humanoid preview = the existing still vessel portrait (`VesselPortrait`) with the sapphire glow / silver tone applied as a CSS ring. Other forms show a placeholder. |
| Vessel Awakens | Memory count (`GET /api/memory-core/:id/health`), recent dream fragments (`GET /api/dreams/:id`) | Reflections count from the server, avg resonance |
| Aspects | Memory → `/what-she-remembers/:id`, Dream → `/dreams/:id` (counts live) | Emotion / Intuition / Aspiration counts, custom aspects |
| Reflections | – | Reflections write route into `memory_events`. Entries are kept on this device and labelled "not shared yet". |
| Patterns | Dream mood/theme tallies and dreams per week (from `GET /api/dreams/:id`, first 50), memory count and span | Trend endpoint over all memories, avg resonance |

Essence never marks dreams read (it calls `fetchDreamJournal` directly, not
`useDreamJournal`), so the journal's unread hint is unaffected.

## vesselCalibration v1 (3D Visual's proposal, mirrored client-side)

`src/features/essence/calibration.ts` mirrors 3D Visual's proposed payload:

```
{ version: 1, vesselType: humanoid|crystal|orb|chalice|flame|tree, netForm?: (same minus humanoid),
  shape: slender|curved|tall|compact, hair: { style: flowing|long|short|braided|none, color: '#rrggbb' },
  eyes: { shape: almond|round|narrow|closed, color: '#rrggbb' },
  resonance: { intensity: 0-100, glow: 0-100 }, silverWarmth: 0-100, theme: dark|light,
  source: { [fieldPath]: 'photo'|'user'|'default' } }
```

`normalizeVesselCalibration` clamps 0–100, validates hex and enums, and never
throws. Unknown fields follow the server rules accepted by Backend Data: kept
only at the top level and inside `hair` / `eyes` / `resonance`; keys match
`^[A-Za-z][A-Za-z0-9_]{0,31}$` (no `__proto__` / `constructor` / `prototype`,
never `name` / `tagline`); whole-calibration depth ≤ 3; at most 16 keys and
**≤ 1024 UTF-8 bytes** of serialized unknown fields (`calibration_unknown_bytes`).
Extras are dropped deterministically: sorted by path, taken greedily while
under the caps. `source` keys are limited to known leaf paths and kept unknown
paths (≤ 32). Name is 1–60 characters and tagline 0–120 (trimmed, no control
characters), matching the server's `invalid_name` rules. A user edit marks that field `user`; fields
marked `photo` are only replaced by an explicit edit. When 3D Visual's
canonical module lands in `src/lib/vessel/`, this file should re-export it.

## Proposed server contract (for Backend Data to accept or change; nothing built)

All owner-scoped (same `characterOwnedBy` check as dreams), `Cache-Control: no-store`,
404 `companion_not_found`, 503 `essence_schema_missing` when a table is missing,
404 everywhere when `ANIMA_ESSENCE` is off.

- `GET /api/essence/status` → `{ enabled: boolean }`
- `GET /api/essence/:characterId/calibration` → `{ character_id, name, tagline, calibration: vesselCalibration v1 | null, rev, updated_at }`
- `PUT /api/essence/:characterId/calibration` `{ name?, tagline?, calibration, expected_rev }` → same shape; 409 `calibration_stale` on rev mismatch; server re-normalizes and keeps `photo` fields unless the body marks them `user`.
- `GET /api/essence/:characterId/reflections?limit=&cursor=` → `{ reflections: [{ id, text, aspect: string|null, created_at }], next_cursor }`
- `POST /api/essence/:characterId/reflections` `{ text (1–2000), aspect?: string|null, client_id }` → `{ reflection }` (append-only into `memory_events`; `client_id` makes the on-device drafts uploadable once, idempotently)
- `GET /api/essence/:characterId/aspects` → `{ aspects: [{ key, name, line, count, custom: boolean }] }`
- `GET /api/essence/:characterId/patterns?days=30` → `{ days: [{ date, mood: string|null, themes: string[], resonance: number|null }], avg_resonance: number|null }`

Any new table or column (calibration storage, reflections tagging, custom
aspects) is a migration and needs Dàvīn's separate OK before it is applied.
