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

import { animaClient } from "@/api/animaClient";
import { planRetryReply } from "@/lib/chatReplyActions";
import { keepRetriedBranch, switchToSibling } from "@/lib/replySiblings";

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
  const fresh = await animaClient.entities.ChatSession.get(activeSession.id);
  const rewoundMessages = (fresh?.messages || activeSession.messages || []).slice(0, messageIndex + 1);
  const last_message = lastMessagePreview(rewoundMessages);
  await animaClient.entities.ChatSession.update(activeSession.id, { messages: rewoundMessages, last_message });
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
/**
 * Retry one reply. With `correction` ({ original, better, note }) the new reply
 * is a re-render guided by the steward's correction; `skipConfirm` is for that
 * path, where the steward already chose "Correct her".
 */
export async function regenerateMessageFlow(
  idx,
  { confirm, activeSession, isLoading, setActiveSession, sendMessage, correction = null, skipConfirm = false, keepSiblings = false },
) {
  if (!activeSession || replacementBlocked(isLoading)) return;
  const askingAgain = idx >= (activeSession.messages || []).length;
  const ok = skipConfirm || await confirm({
    heading: "Retry",
    title: askingAgain ? "Ask her again?" : "Retry her reply?",
    message: askingAgain
      ? "This asks for a reply to your message. It is not sent a second time."
      : keepSiblings
        ? "This writes a new reply. This one and anything after it are kept as an earlier version you can switch back to."
        : "This discards this reply and anything after it, then writes a new one. Your message stays as it is.",
    confirmLabel: "Retry",
  });
  if (!ok || replacementBlocked(isLoading)) return;
  // Re-read fresh — see the comment in rewindToMessageFlow: a stale
  // activeSession snapshot here would delete any message that arrived while
  // the confirm dialog was open.
  const fresh = await animaClient.entities.ChatSession.get(activeSession.id);
  const messages = fresh?.messages || activeSession.messages || [];
  const plan = planRetryReply(messages, idx);
  if (!plan.ok) return;
  // Chat upgrade 2 (VITE_ANIMA_REPLY_SIBLINGS): the discarded branch is kept
  // on his user line as an earlier sibling instead of being lost.
  const kept = keepSiblings ? keepRetriedBranch(messages, plan) : plan.kept;
  const last_message = kept[kept.length - 1]?.content?.slice(0, 60) || "";
  await animaClient.entities.ChatSession.update(activeSession.id, { messages: kept, last_message });
  setActiveSession((prev) => ({ ...prev, messages: kept, last_message }));
  if (!plan.userContent) return;
  const result = await sendMessage({
    text: plan.userContent,
    replyAction: "retry",
    history: kept,
    priorMessages: messages,
    replacedTurnId: plan.replacedTurnId || "",
    replacedTurnIds: plan.replacedTurnIds || [],
    replacedFromSeq: plan.replacedFromSeq,
    replacedFromMessageId: plan.replacedFromMessageId || "",
    replacedMessageIds: plan.replacedMessageIds || [],
    ...(correction ? { correction } : {}),
  });
  if (result?.started === false) {
    const saved = await animaClient.entities.ChatSession.update(activeSession.id, {
      messages,
      keep_arrivals: true,
    });
    const restored = Array.isArray(saved?.messages) ? saved.messages : messages;
    const restoredPreview = restored[restored.length - 1]?.content?.slice(0, 60) || "";
    setActiveSession((prev) =>
      prev && prev.id === activeSession.id
        ? { ...prev, messages: restored, last_message: restoredPreview }
        : prev,
    );
  }
}

// Chat upgrade 2 (VITE_ANIMA_REPLY_SIBLINGS): make an earlier sibling the live
// reply again. The current reply (and anything after it) becomes a sibling, so
// switching is never destructive. Re-reads the session first for the same
// reason as the flows above.
//
// deps:
//   activeSession    — the session currently open
//   isLoading        — true, or a function that is true, while a turn is in flight
//   setActiveSession — state setter used to reflect the change in the page view
export async function switchSiblingFlow(parentIndex, key, { activeSession, isLoading, setActiveSession }) {
  if (!activeSession || replacementBlocked(isLoading)) return { ok: false, reason: "busy" };
  const fresh = await animaClient.entities.ChatSession.get(activeSession.id);
  const messages = fresh?.messages || activeSession.messages || [];
  const plan = switchToSibling(messages, parentIndex, key);
  if (!plan.ok) return plan;
  if (replacementBlocked(isLoading)) return { ok: false, reason: "busy" };
  const last_message = lastMessagePreview(plan.messages);
  const saved = await animaClient.entities.ChatSession.update(activeSession.id, {
    messages: plan.messages,
    last_message,
  });
  const next = Array.isArray(saved?.messages) ? saved.messages : plan.messages;
  setActiveSession((prev) =>
    prev && prev.id === activeSession.id ? { ...prev, messages: next, last_message } : prev,
  );
  return { ok: true };
}
