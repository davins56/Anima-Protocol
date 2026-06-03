---
name: Anima cross-device live sync
description: How open sessions pick up changes made on another device (polling + revision token + window event), and the rules that keep it correct.
---

# Cross-device live sync

The app has no React subscription layer — pages fetch-on-mount via `useEffect`. Live
cross-device updates are layered on top without rewriting call sites:

- **Server**: `GET /api/store/revision` returns a cheap token
  `count:entitiesEpoch:profileEpoch`. Must stay defined BEFORE the `/:entity`
  catch-all in `store.ts` or it gets swallowed. Use `extract(epoch from max(updatedAt))::text`
  (NOT `getTime()` ms) so sub-millisecond writes still shift the token and so the
  pg driver's Date parsing can't truncate precision. `count` catches deletes;
  `max(updatedAt)` catches creates/updates (every upsert sets `updatedAt = now()`).
- **Client** (`base44Client.js`): `startStoreSync`/`stopStoreSync` poll `/revision`
  every 15s while the tab is visible, plus on `focus` and `visibilitychange`. On a
  detected change it drops list+profile caches and dispatches window event
  `anima:store-changed`. `useStoreSync(loadFn)` hook re-runs a page's loader on that
  event (ref-based, subscribes once). Polling starts/stops in `AuthContext` on sign-in/out.

**Why the self-write suppression must NOT advance the baseline:** `bumpVersion` records
`lastLocalWriteAt`. If a revision change is seen within `SELF_WRITE_SUPPRESS_MS` (~20s) of
a local write, we drop caches but suppress the event so a device doesn't reload from its
own edits. Critically we do **not** advance `lastSeenRevision` while suppressing — otherwise
a remote change that coincides with our own write would be permanently lost. By leaving the
baseline behind, the next poll (after local writes settle) re-detects and emits it. Worst
case: a remote change is delayed until local editing pauses, never dropped.

**Account switch:** `syncIdentity` calls `resetSyncBaseline()` when the user id changes, so
the next poll re-baselines against the new account (no spurious/missed first change).

**Wired pages:** MainHome, Characters, Journals, Wiki. Chat is intentionally NOT wired
(active streaming surface — a blanket reload would corrupt in-progress generation).
QuestTrackingDashboard already self-polls every 3s. Non-wired pages still get fresh data on
remount because the poller clears the cache on remote change.
