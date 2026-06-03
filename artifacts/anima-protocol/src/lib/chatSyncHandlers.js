// Cross-device live-sync handlers for the Chat page, extracted so the tricky
// "remote change arriving mid-reply must never clobber the in-progress response"
// timing can be unit tested without rendering the whole Chat component.
//
// Chat is a live streaming surface. Another device on the same account may add
// messages or sessions; the store poller drops caches and fires
// `anima:store-changed`, which the page turns into these calls. The hard part is
// timing: a remote change that arrives while a reply is generating (or a new
// reply that starts during the deferred catch-up) must eventually appear without
// ever wiping the optimistic thinking/typing bubbles or the streaming reply.
//
// These take their page concerns (active session ref/state, loading flag, the
// sidebar loader, and the deferred-sync flag ref) as injected deps so the tests
// can drive the exact race the review caught.

import { base44 } from "@/api/base44Client";

// Fetch the open thread's messages from the server and apply them, but never
// over an in-flight reply. Returns true if applied (or there was nothing to
// apply because the user navigated away), false if it was skipped/failed and
// should be retried once the device settles.
//
// deps:
//   sessionId         — id of the currently open thread (falsy when none open)
//   activeSessionRef   — ref mirroring the latest committed activeSession; read
//                        AFTER the await so a reply that started during the fetch
//                        is seen and not clobbered
//   setActiveSession  — state setter used to reflect applied messages
export async function syncActiveMessages({ sessionId, activeSessionRef, setActiveSession }) {
  if (!sessionId) return true;
  let messages;
  try {
    messages = await base44.messages.list(sessionId);
  } catch {
    return false; // transient — caller re-arms a retry
  }
  const cur = activeSessionRef.current;
  if (!cur || cur.id !== sessionId) return true; // navigated away; new session loads fresh
  // Never clobber a thread whose optimistic thinking/typing bubbles or
  // streaming reply are in flight — signal a retry instead.
  const hasPending = (cur.messages || []).some(
    (m) =>
      m.character_name === "__typing__" || m.character_name === "__thinking__",
  );
  if (hasPending) return false;
  setActiveSession((prev) =>
    prev && prev.id === sessionId ? { ...prev, messages } : prev,
  );
  return true;
}

// React to a remote change. The sidebar list is metadata-only (no message
// hydration) and can't corrupt an in-progress reply, so refresh it
// unconditionally. Defer the open conversation's refetch while a reply is
// generating; otherwise sync now and re-arm a retry if it couldn't apply.
//
// deps:
//   isLoading             — true when a reply is being generated locally
//   loadSessions          — sidebar (metadata-only) loader
//   pendingRemoteSyncRef  — ref flag: a remote change is awaiting a safe moment
//   runSync               — bound syncActiveMessages (returns applied:boolean)
export function syncFromRemote({ isLoading, loadSessions, pendingRemoteSyncRef, runSync }) {
  loadSessions();
  if (isLoading) {
    // Defer the open conversation's refetch until generation settles.
    pendingRemoteSyncRef.current = true;
    return;
  }
  runSync().then((applied) => {
    if (!applied) pendingRemoteSyncRef.current = true;
  });
}

// Body of the effect that runs when local generation finishes: apply any remote
// change that arrived while we were busy (deferred so it couldn't corrupt the
// streaming reply). Only clear the pending flag on a SUCCESSFUL apply, so a
// fresh send starting mid-catch-up can't make us drop the deferred remote
// change. The `cancelled` guard stops a stale async completion from clearing the
// flag after a new send re-armed it. Returns an effect cleanup function.
//
// deps:
//   isLoading             — true when a reply is being generated locally
//   pendingRemoteSyncRef  — ref flag set while a remote change is deferred
//   runSync               — bound syncActiveMessages (returns applied:boolean)
export function settleDeferredSync({ isLoading, pendingRemoteSyncRef, runSync }) {
  if (isLoading || !pendingRemoteSyncRef.current) return () => {};
  let cancelled = false;
  runSync().then((applied) => {
    if (!cancelled && applied) pendingRemoteSyncRef.current = false;
  });
  return () => {
    cancelled = true;
  };
}
