import { base44 } from "@/api/base44Client";
import { useConfirm } from "@/lib/ConfirmDialog";

/**
 * Provides edit, delete, and regenerate actions for chat messages.
 */
export function useMessageActions({ activeSession, setActiveSession, isLoading, handleSendMessage }) {
  const confirm = useConfirm();
  const handleDeleteMessage = async (messageIndex) => {
    if (!activeSession) return;
    const ok = await confirm({
      title: "Delete this message?",
      message: "This permanently removes the message from the conversation.",
      confirmLabel: "Delete",
    });
    if (!ok) return;
    const updated = (activeSession.messages || []).filter((_, i) => i !== messageIndex);
    await base44.entities.ChatSession.update(activeSession.id, { messages: updated });
    setActiveSession(prev => ({ ...prev, messages: updated }));
  };

  const handleEditMessage = async (messageIndex, newText) => {
    if (!activeSession) return;
    const updated = (activeSession.messages || []).map((msg, i) =>
      i === messageIndex ? { ...msg, content: newText } : msg
    );
    await base44.entities.ChatSession.update(activeSession.id, { messages: updated });
    setActiveSession(prev => ({ ...prev, messages: updated }));
  };

  const handleRegenerateMessage = async (messageIndex) => {
    if (!activeSession || isLoading) return;
    const ok = await confirm({
      heading: "Regenerate",
      title: "Regenerate this response?",
      message: "This discards this reply and anything after it, then writes a new one.",
      confirmLabel: "Regenerate",
    });
    if (!ok) return;
    const messagesUpToBefore = (activeSession.messages || []).slice(0, messageIndex);
    const lastUserMsg = [...messagesUpToBefore].reverse().find(m => m.role === 'user');
    await base44.entities.ChatSession.update(activeSession.id, { messages: messagesUpToBefore });
    setActiveSession(prev => ({ ...prev, messages: messagesUpToBefore }));
    if (lastUserMsg) await handleSendMessage(lastUserMsg.content);
  };

  return { handleDeleteMessage, handleEditMessage, handleRegenerateMessage };
}