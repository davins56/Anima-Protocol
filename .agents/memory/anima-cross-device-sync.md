---
name: Anima cross-device live sync
description: How open sessions pick up changes made on another device (server push SSE + revision-token poll fallback + window event), and the rules that keep it correct.
---

# Cross-device live sync

## Server push (SSE) — the fast path
- `GET /api/store/events` is an authenticated SSE stream (under `requireUser`,
  defined BEFORE the `/:entity` catch-all like `/revision`). It emits a bare
  `event: change` nudge — never data. Real change detection still happens client-side
  against `/revision`, so the push is safe to fan out to ALL of a user's devices
  including the writer.
- Fan-out is an in-memory per-user `Map<userId, Set<res>>` in `lib/storeEvents.ts`
  (single process, so no external bus). A `notifyOnWrite` middleware on the store
  router fires `notifyUser` on `res 'finish'` for any non-GET with `statusCode < 400`
  — this auto-covers every current/future write route instead of instrumenting each.
- **Client uses fetch-streaming, NOT EventSource** — EventSource can't send the Clerk
  bearer header. On a push it debounces ~200ms then calls the existing `pollRevision()`
  (single source of truth for suppression). Poll cadence stretches to 60s while SSE is
  connected, reverts to 15s on drop; reconnect is exponential backoff.
- **Teardown race (fixed, has a regression test):** `connectSse()`'s `finally` always
  runs `applyPollCadence()` + `scheduleSseReconnect()`. If a `/events` fetch settles
  AFTER `stopStoreSync()`, those must NOT resurrect polling. Guard: `setPollTimer()` and
  `scheduleSseReconnect()` are no-ops when `!syncStarted`. Test: `src/api/storeSync.test.js`.
- Masked-change bound: when a push/poll is suppressed as a self-write, a one-shot
  `scheduleSuppressRecheck` re-polls just after the ~20s suppress window so a remote
  change that landed in the window is caught promptly despite the slow 60s fallback.



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

**Wired pages:** MainHome, Characters, Journals, Wiki, and Chat.
QuestTrackingDashboard already self-polls every 3s. Non-wired pages still get fresh data on
remount because the poller clears the cache on remote change.

**Chat is a special case (streaming surface).** It refreshes the sidebar list (metadata-only,
can't corrupt a reply) unconditionally, but refetches the OPEN thread's messages only when the
device is idle (`!isLoading`) and the thread has no optimistic `__typing__`/`__thinking__`
bubble. Rules that keep it correct:
- A remote change arriving mid-generation is **deferred** (a `pendingRemoteSyncRef` flag), then
  applied by an `isLoading`-watching effect once generation settles. Self-write suppression in
  the poller already covers the local send itself; the deferral covers remote changes during the
  AI-call window where no local write has happened recently.
- The catch-up must be **retryable**: clear the pending flag ONLY on a successful apply. The
  apply function returns true (applied / navigated-away) vs false (skipped because a reply is in
  flight, or fetch error). Clearing the flag before the async apply resolves lets a second send
  starting mid-catch-up permanently drop the deferred remote change. The settle effect uses a
  `cancelled` guard so a stale async completion can't clear the flag after a new send re-armed it.
- The pending-bubble check must read the LATEST committed `activeSession` (via an
  `activeSessionRef` updated each render) AFTER the await — not the render-closure snapshot — or
  a reply that started during the fetch is missed and gets clobbered.

## Sync handlers extracted for unit testing
- The three Chat sync closures live in `src/lib/chatSyncHandlers.js` (DI functions:
  `syncActiveMessages`, `syncFromRemote`, `settleDeferredSync`); Chat.jsx wraps them
  in its useCallback/useEffect. Same extract-to-DI pattern as edit/delete/rewind so
  the mid-reply race can be driven deterministically (mock base44 `messages.list`).
- The dropped-update race regression test is `src/lib/chatSyncHandlers.test.js`.
