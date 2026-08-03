// Page-level rewind/regenerate flows for the Chat page, extracted so they can be
// unit tested without rendering the whole Chat component.
//
// Both of these are destructive, confirm-guarded actions on the active session's
// message list:
//   - rewindToMessageFlow trims the conversation to a chosen point (inclusive).
//   - regenerateMessageFlow discards a reply plus everything after it, then asks
//     the page to send the last user message again so a fresh reply is produced.
//
// They take their page concerns (confirm dialog, active session state, the send
// function) as injected deps so the tests can drive them directly.

import { base44 } from "@/api/base44Client";

// Compute the short "last_message" preview the page stores alongside a session.
function lastMessagePreview(messages) {
  return messages[messages.length - 1]?.content.slice(0, 60) || "";
}

// Rewind the active session to a chosen message, removing everything after it.
//
// deps:
//   confirm          — async confirm dialog (returns true to proceed)
//   activeSession    — the session currently open (null/undefined when none)
//   setActiveSession — state setter used to reflect the change in the page view
export async function rewindToMessageFlow(messageIndex, { confirm, activeSession, setActiveSession }) {
  if (!activeSession) return;
  const ok = await confirm({
    heading: "Rewind",
    title: "Rewind to this message?",
    message: "This permanently removes every message after this point.",
    confirmLabel: "Rewind",
  });
  if (!ok) return;
  const rewoundMessages = (activeSession.messages || []).slice(0, messageIndex + 1);
  const last_message = lastMessagePreview(rewoundMessages);
  await base44.entities.ChatSession.update(activeSession.id, { messages: rewoundMessages, last_message });
  setActiveSession((prev) => ({ ...prev, messages: rewoundMessages, last_message }));
}

// Regenerate a reply: discard the message at idx and everything after it, then
// re-send the most recent preceding user message to produce a fresh reply.
//
// deps:
//   confirm          — async confirm dialog (returns true to proceed)
//   activeSession    — the session currently open (null/undefined when none)
//   isLoading        — true when a request is already in flight (skip if so)
//   setActiveSession — state setter used to reflect the change in the page view
//   sendMessage      — page's send fn; called with the last user message's content
export async function regenerateMessageFlow(idx, { confirm, activeSession, isLoading, setActiveSession, sendMessage }) {
  if (!activeSession || isLoading) return;
  const ok = await confirm({
    heading: "Regenerate",
    title: "Regenerate this response?",
    message: "This discards this reply and anything after it, then writes a new one.",
    confirmLabel: "Regenerate",
  });
  if (!ok) return;
  const before = (activeSession.messages || []).slice(0, idx);
  const lastUser = [...before].reverse().find((m) => m.role === "user");
  await base44.entities.ChatSession.update(activeSession.id, { messages: before });
  setActiveSession((prev) => ({ ...prev, messages: before }));
  if (lastUser) await sendMessage(lastUser.content);
}
