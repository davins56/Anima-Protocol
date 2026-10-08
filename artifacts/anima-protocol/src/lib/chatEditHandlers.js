// Page-level edit flow for the Chat page, extracted so it can be unit tested
// without rendering the whole Chat component.
//
// Editing his message truncates from that user line onward (the old wording,
// her reply, and anything after it), then sends the new wording once. It must
// not stop at a silent text rewrite — she has to answer the edited line. The
// send is marked `edit` so mood and memory are not written a second time.

import { base44 } from "@/api/base44Client";
import { planEditResend } from "@/lib/chatReplyActions";

function replacementBlocked(isLoading) {
  return typeof isLoading === "function" ? Boolean(isLoading()) : Boolean(isLoading);
}

// deps:
//   confirm          — async confirm dialog (returns true to proceed)
//   activeSession    — the session currently open (null/undefined when none)
//   isLoading        — true, or a function that is true, while a turn is in
//                      flight or a message is waiting to send
//   setActiveSession — state setter used to reflect the change in the page view
//   sendMessage      — page's send fn; called once with the new wording
export async function editMessageFlow(idx, newText, { confirm, activeSession, isLoading, setActiveSession, sendMessage }) {
  if (!activeSession || replacementBlocked(isLoading)) return { status: "blocked" };
  const preview = planEditResend(activeSession.messages, idx, newText);
  if (!preview.ok) return { status: preview.reason };
  if (typeof confirm === "function") {
    const ok = await confirm({
      heading: "Edit",
      title: "Rewrite this message?",
      message:
        "This replaces your message, discards her reply and anything after it, and she answers the new wording once.",
      confirmLabel: "Rewrite",
    });
    if (!ok) return { status: "cancelled" };
  }
  if (replacementBlocked(isLoading)) return { status: "blocked" };
  const fresh = await base44.entities.ChatSession.get(activeSession.id);
  const messages = fresh?.messages || activeSession.messages || [];
  const plan = planEditResend(messages, idx, newText);
  if (!plan.ok) return { status: plan.reason };
  const last_message = plan.kept[plan.kept.length - 1]?.content?.slice(0, 60) || "";
  await base44.entities.ChatSession.update(activeSession.id, { messages: plan.kept, last_message });
  setActiveSession((prev) => ({ ...prev, messages: plan.kept, last_message }));
  const result = await sendMessage({
    text: plan.content,
    replyAction: "edit",
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
    return { status: "not_started" };
  }
  return { status: "sent" };
}
