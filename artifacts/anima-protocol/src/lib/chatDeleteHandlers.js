// Page-level delete flows for the Chat page, extracted so they can be unit
// tested without rendering the whole Chat component.
//
// These wrap the lower-level undo helpers (see lib/undoableDelete) with the
// page concerns that the helpers don't know about: asking the user to confirm
// before deleting a whole session, and navigating away from a session that is
// being deleted while it is the active one.

import { base44 } from "@/api/base44Client";
import { deleteWithUndo, deleteArrayItemWithUndo } from "@/lib/undoableDelete";

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
// deps:
//   activeSession    — the session currently open (null/undefined when none)
//   setActiveSession — state setter used to reflect the change in the page view
export async function deleteMessageFlow(idx, { activeSession, setActiveSession }) {
  if (!activeSession) return;
  const sessionId = activeSession.id;
  await deleteArrayItemWithUndo({
    entity: "ChatSession",
    recordId: sessionId,
    field: "messages",
    index: idx,
    label: "Message",
    onChange: async () => {
      const fresh = await base44.entities.ChatSession.get(sessionId);
      if (fresh) {
        setActiveSession((prev) =>
          prev && prev.id === sessionId
            ? { ...prev, messages: fresh.messages || [] }
            : prev
        );
      }
    },
  });
}
