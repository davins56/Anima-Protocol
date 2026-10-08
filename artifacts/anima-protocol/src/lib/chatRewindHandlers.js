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
import { planRetryReply } from "@/lib/chatReplyActions";

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
  // Re-read fresh rather than trusting the activeSession snapshot captured
  // before the (user-paced) confirm dialog — ChatSession.update({messages})
  // reconciles the whole array against server rows, so a stale snapshot would
  // silently delete any message that arrived while the dialog was open.
  const fresh = await base44.entities.ChatSession.get(activeSession.id);
  const rewoundMessages = (fresh?.messages || activeSession.messages || []).slice(0, messageIndex + 1);
  const last_message = lastMessagePreview(rewoundMessages);
  await base44.entities.ChatSession.update(activeSession.id, { messages: rewoundMessages, last_message });
  setActiveSession((prev) => ({ ...prev, messages: rewoundMessages, last_message }));
}

function replacementBlocked(isLoading) {
  return typeof isLoading === "function" ? Boolean(isLoading()) : Boolean(isLoading);
}

// Retry her reply: keep his user line, discard that assistant message and
// anything after it, then ask for a new reply. The send is marked `retry` so
// the page does not append another user turn and the server skips mood/memory.
//
// deps:
//   confirm          — async confirm dialog (returns true to proceed)
//   activeSession    — the session currently open (null/undefined when none)
//   isLoading        — true, or a function that is true, while a turn is in
//                      flight or a message is waiting to send
//   setActiveSession — state setter used to reflect the change in the page view
//   sendMessage      — page's send fn; called with { text, replyAction, history }
export async function regenerateMessageFlow(idx, { confirm, activeSession, isLoading, setActiveSession, sendMessage }) {
  if (!activeSession || replacementBlocked(isLoading)) return;
  const askingAgain = idx >= (activeSession.messages || []).length;
  const ok = await confirm({
    heading: "Retry",
    title: askingAgain ? "Ask her again?" : "Retry her reply?",
    message: askingAgain
      ? "This asks for a reply to your message. It is not sent a second time."
      : "This discards this reply and anything after it, then writes a new one. Your message stays as it is.",
    confirmLabel: "Retry",
  });
  if (!ok || replacementBlocked(isLoading)) return;
  // Re-read fresh — see the comment in rewindToMessageFlow: a stale
  // activeSession snapshot here would delete any message that arrived while
  // the confirm dialog was open.
  const fresh = await base44.entities.ChatSession.get(activeSession.id);
  const messages = fresh?.messages || activeSession.messages || [];
  const plan = planRetryReply(messages, idx);
  if (!plan.ok) return;
  const last_message = plan.kept[plan.kept.length - 1]?.content?.slice(0, 60) || "";
  await base44.entities.ChatSession.update(activeSession.id, { messages: plan.kept, last_message });
  setActiveSession((prev) => ({ ...prev, messages: plan.kept, last_message }));
  if (!plan.userContent) return;
  const result = await sendMessage({
    text: plan.userContent,
    replyAction: "retry",
    history: plan.kept,
    priorMessages: messages,
    replacedTurnId: plan.replacedTurnId || "",
    replacedTurnIds: plan.replacedTurnIds || [],
    replacedFromSeq: plan.replacedFromSeq,
    replacedFromMessageId: plan.replacedFromMessageId || "",
    replacedMessageIds: plan.replacedMessageIds || [],
  });
  if (result?.started === false) {
    const restoredPreview = messages[messages.length - 1]?.content?.slice(0, 60) || "";
    await base44.entities.ChatSession.update(activeSession.id, {
      messages,
      last_message: restoredPreview,
    });
    setActiveSession((prev) =>
      prev && prev.id === activeSession.id
        ? { ...prev, messages, last_message: restoredPreview }
        : prev,
    );
  }
}
