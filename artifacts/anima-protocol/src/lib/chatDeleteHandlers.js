// Page-level delete flows for the Chat page, extracted so they can be unit
// tested without rendering the whole Chat component.
//
// These wrap the lower-level undo helpers (see lib/undoableDelete) with the
// page concerns that the helpers don't know about: asking the user to confirm
// before deleting a whole session, and navigating away from a session that is
// being deleted while it is the active one.

import { animaClient } from "@/api/animaClient";
import { toast } from "sonner";
import { deleteWithUndo } from "@/lib/undoableDelete";

// Delete a whole chat session after a confirm prompt, with an undo window.
//
// deps:
//   confirm      — async confirm dialog (returns true to proceed)
//   sessions     — current list of session records (to find the one to delete)
//   sessionId    — id of the session currently open on the page (may be undefined)
//   navigate     — router navigate fn; called with "/" when the active session is deleted
//   loadSessions — re-run after delete/restore to refresh the page's session list
export async function deleteSessionFlow(id, { confirm, sessions, sessionId, navigate, loadSessions }) {
  const ok = await confirm({
    title: "Delete this chat session?",
    message: "You'll have a few seconds to undo this.",
    confirmLabel: "Delete",
  });
  if (!ok) return;
  const item = (sessions || []).find((s) => s.id === id);
  if (sessionId === id) navigate("/");
  await deleteWithUndo({
    entity: "ChatSession",
    item,
    label: "Chat session",
    onChange: loadSessions,
  });
}

// Delete a single message from the active session, with an undo window.
//
// The bubble disappears at once (optimistic) and ONE row is deleted on the
// server (DELETE /store/messages/:id). This used to re-read the whole history
// and rewrite it through ChatSession.update({messages}) -> /messages/replace,
// which on a long chat outran the 8s store budget and was cancelled, so the
// message never went away. If the delete fails, the bubble comes back and an
// error toast says so.
//
// deps:
//   activeSession    — the session currently open (null/undefined when none)
//   setActiveSession — state setter used to reflect the change in the page view
export async function deleteMessageFlow(idx, { activeSession, setActiveSession }) {
  if (!activeSession) return;
  const sessionId = activeSession.id;
  const target = Array.isArray(activeSession.messages) ? activeSession.messages[idx] : undefined;
  if (!target) return;
  const isTarget = (m) => m === target || (target.id != null && m?.id != null && m.id === target.id);
  const inSession = (fn) =>
    setActiveSession((prev) => (prev && prev.id === sessionId ? fn(prev) : prev));
  const removeLocally = () =>
    inSession((prev) => ({ ...prev, messages: (prev.messages || []).filter((m) => !isTarget(m)) }));
  const putBack = (row) =>
    inSession((prev) =>
      (prev.messages || []).some(isTarget)
        ? prev
        : { ...prev, messages: insertMessageBack(prev.messages || [], row, idx) },
    );

  removeLocally();
  // A row that never reached the store (no id) only lives in this view.
  if (target.id == null) return;

  let stored = target;
  try {
    let result = await animaClient.messages.remove(sessionId, target.id);
    if (result?.missing) {
      // The bubble may carry a client-side id from before the turn was saved.
      // Find the stored row for the same turn and text, and delete that.
      const rows = await animaClient.messages.list(sessionId, { limit: 200 });
      const match = (Array.isArray(rows) ? rows : []).find((m) => sameStoredMessage(m, target));
      if (match?.id != null) {
        stored = match;
        result = await animaClient.messages.remove(sessionId, match.id);
      }
    }
    if (result && Number.isFinite(Number(result.seq))) stored = { ...stored, seq: Number(result.seq) };
  } catch (err) {
    console.error("Failed to delete message:", err);
    putBack(target);
    toast.error("Couldn't delete that message. Check your connection and try again.");
    return;
  }

  toast("Message deleted", {
    description: "Tap undo to restore it.",
    duration: MESSAGE_UNDO_MS,
    action: {
      label: "Undo",
      onClick: async () => {
        try {
          const restored = await animaClient.messages.restore(sessionId, stored);
          putBack(restored && typeof restored === "object" ? { ...stored, ...restored } : stored);
          toast.success("Message restored");
        } catch (err) {
          console.error("Failed to restore message:", err);
          toast.error("Couldn't restore message");
        }
      },
    },
  });
}

const MESSAGE_UNDO_MS = 6000;

function sameStoredMessage(row, target) {
  if (!row || row.role !== target.role) return false;
  if (String(row.content ?? "") !== String(target.content ?? "")) return false;
  const turn = target.turn_id || target.late_turn_id;
  return !turn || row.turn_id === turn || row.late_turn_id === turn;
}

/** Put a row back in seq order when it has one, else at its old index. */
export function insertMessageBack(messages, row, fallbackIndex) {
  const list = Array.isArray(messages) ? messages : [];
  const seq = Number(row?.seq);
  let at = Math.min(Math.max(0, Number(fallbackIndex) || 0), list.length);
  if (Number.isFinite(seq)) {
    const later = list.findIndex((m) => Number.isFinite(Number(m?.seq)) && Number(m.seq) > seq);
    at = later === -1 ? list.length : later;
  }
  return [...list.slice(0, at), row, ...list.slice(at)];
}
