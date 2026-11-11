# Dream journal frontend contract

This document is for Anima Backend Data. The dream-journal UI is built against
these routes and shapes. **None of them exist on the server yet.** The client
treats a missing route (HTML/empty 404), `501`, or `503` with
`code: "dream_schema_missing"` as “not available yet.” Do not implement these
routes or migrations in the frontend PR.

The scheduled dream layer already writes append-only rows to `public.dreams`
(`docs/dream-layer.md`, migration `20261022270000_dream_layer.sql`). Continuity
already exposes the last three fragments on
`GET /api/continuity/:characterId` as `state.recentDreams`
(`{ id, fragment, mood, themes, created_at }`). That is not a journal: it is
capped at three, has no summary, no pagination, no read state, and no opt-out.
`GET /api/notifications/dreams/run` is a `CRON_SECRET` tick, not a user API.
`ANIMA_DREAM_LAYER` is an ops kill switch, not a per-companion setting.

A separate legacy path, `animaClient.entities.AnimaDream` / `useAnimaPresence`,
synthesizes client-side dreams into a different entity. Do not wire the journal
to that table.

`anima_journal` / idle reflections are a different store. Out of scope here.

## Ownership

Every call is authenticated (Clerk). The server must:

1. Resolve `userId` from the session.
2. Confirm the caller owns `characterId` (same ownership check as
   `GET /api/continuity/:characterId`).
3. Scope every query with `user_id = auth user` **and** `character_id = :characterId`.
4. Never return another user’s dream, even if they know the uuid.

If the character does not exist or is not owned, respond `404` with
`{ "error": "Companion not found", "code": "companion_not_found" }`.

If the `dreams` table/view is missing, respond `503` with
`{ "error": "Dream journal is not set up yet.", "code": "dream_schema_missing" }`.

Successful list/detail responses should be `Cache-Control: no-store`.

## Routes

### `GET /api/dreams/:characterId`

List this companion’s dreams, newest first.

**Query**

| Param | Default | Notes |
|---|---|---|
| `limit` | `20` | Integer 1–50 |
| `cursor` | — | Opaque; the previous page’s `next_cursor` |

**200**

```json
{
  "character_id": "char_123",
  "dreaming_enabled": true,
  "unread_count": 1,
  "is_dreaming": false,
  "dreams": [
    {
      "id": "uuid",
      "created_at": "2026-11-10T12:00:00.000Z",
      "mood": "dreamy",
      "themes": ["lantern", "hallway"],
      "summary": "Two or three sentences. Abstract, non-literal.",
      "fragment": "A short first-person line she might let slip.",
      "read": false,
      "surfaced_count": 0
    }
  ],
  "next_cursor": null
}
```

- `mood` and `themes` may be empty/`null`; the UI only shows a tag when `mood` is a non-empty string.
- Do not include `source_event_ids`, raw memory content, `synthesizer`, or `model` in this payload.
- `is_dreaming` should match `presenceState` in `continuityCore.ts` (`presence === "dreaming"`).
- `unread_count` is the number of this companion’s dreams the owner has not opened in the journal (see Read state).
- `dreaming_enabled` is the per-companion “Let her dream” setting. Default `true` when no row exists.

**Errors:** `401 unauthorized`; `400 invalid_cursor`; `404 companion_not_found`; `503 dream_schema_missing`.

### `GET /api/dreams/:characterId/:dreamId`

One dream for the detail view. Same object shape as a list item. `404` with
`code: "dream_not_found"` if the id is missing or belongs to another companion
or user. Same ownership and schema-missing rules as the list.

### `POST /api/dreams/:characterId/:dreamId/read`

Marks that dream read **for the journal only**. The `dreams` table is
append-only (`anima_forbid_mutation`); do not `UPDATE` or `DELETE` it. Store
reads in a new owner-scoped table (for example `dream_reads`) or an equivalent
append-only log. Do **not** reuse `dream_surfacings`: that log means a fragment
was used as a proactive opener, and it must stay independent of journal reads.
Continuity session-start snapshots must also not mark a dream read in the journal.

**200:** `{ "ok": true, "unread_count": 0 }`

**Errors:** same as detail, plus `401`.

### `GET /api/dreams/:characterId/settings` and `PUT /api/dreams/:characterId/settings`

Per-companion opt-out.

**PUT body:** `{ "dreaming_enabled": false }`

**200:** `{ "character_id": "char_123", "dreaming_enabled": false }`

When `dreaming_enabled` is `false`, `findDreamCandidates` / `dreamFor` must skip
this companion. Existing dreams stay readable. Turning it back on allows new
dreams after the usual inactivity/cooldown rules. Default is `true`.

There is no existing user-facing setting to hang this on. `ANIMA_DREAM_LAYER`
must stay an ops kill switch and must not be flipped by this endpoint.

**Errors:** `401`; `404 companion_not_found`; `400` if the body is not a boolean;
`503 dream_schema_missing`.

## Frontend behaviour until these land

The UI calls the routes above through a typed client (zod). Until they exist:

- The journal shows a clear “not available yet” state and does not invent rows.
- Continuity `presence === "dreaming"` still powers `useIsDreaming` (for 3D
  Visual later) and the existing presence label.
- A gentle unread hint on `PresenceIndicator` may use `state.recentDreams`
  plus a local read ledger, and is replaced by `unread_count` once the API exists.
- The “Let her dream” toggle is visible but clearly not honored by the server yet.

## Out of scope for Backend Data in this contract

- Dreaming pose / vessel animation (3D Visual). The frontend exposes
  `useIsDreaming(characterId)` / `isDreaming` only.
- “What did you dream?” is a prefilled chat composer prompt. It does not call
  a backend generate endpoint and must not auto-send.
