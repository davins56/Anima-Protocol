import { base44 } from "@/api/base44Client";
import { useConfirm } from "@/lib/ConfirmDialog";
import { editMessageFlow } from "@/lib/chatEditHandlers";
import { regenerateMessageFlow } from "@/lib/chatRewindHandlers";

/**
 * Provides edit, delete, and regenerate actions for chat messages.
 * Edit resends the new wording. Retry replaces her reply without a second user turn.
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

  const handleEditMessage = (messageIndex, newText) =>
    editMessageFlow(messageIndex, newText, {
      confirm,
      activeSession,
      isLoading,
      setActiveSession,
      sendMessage: handleSendMessage,
    });

  const handleRegenerateMessage = (messageIndex) =>
    regenerateMessageFlow(messageIndex, {
      confirm,
      activeSession,
      isLoading,
      setActiveSession,
      sendMessage: handleSendMessage,
    });

  return { handleDeleteMessage, handleEditMessage, handleRegenerateMessage };
}