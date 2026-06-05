// Page-level edit flow for the Chat page, extracted so it can be unit tested
// without rendering the whole Chat component.
//
// Editing rewrites a single message's content in place. Unlike rewind, delete,
// and regenerate, it is not destructive to the rest of the conversation: every
// other message must be left exactly as it was. The active session state and
// its setter are injected so the test can drive the flow directly.

import { base44 } from "@/api/base44Client";

// Replace the content of the message at idx in the active session, persisting
// the change and reflecting it in the page view. All other messages are kept.
//
// deps:
//   activeSession    — the session currently open (null/undefined when none)
//   setActiveSession — state setter used to reflect the change in the page view
export async function editMessageFlow(idx, newText, { activeSession, setActiveSession }) {
  if (!activeSession) return;
  const updated = (activeSession.messages || []).map((m, i) =>
    i === idx ? { ...m, content: newText } : m
  );
  await base44.entities.ChatSession.update(activeSession.id, { messages: updated });
  setActiveSession((prev) => ({ ...prev, messages: updated }));
}
