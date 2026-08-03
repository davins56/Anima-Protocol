import { base44 } from "@/api/base44Client";

/**
 * Provides edit, delete, and regenerate actions for chat messages.
 */
export function useMessageActions({ activeSession, setActiveSession, isLoading, handleSendMessage }) {
  const handleDeleteMessage = async (messageIndex) => {
    if (!activeSession) return;
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
    const messagesUpToBefore = (activeSession.messages || []).slice(0, messageIndex);
    const lastUserMsg = [...messagesUpToBefore].reverse().find(m => m.role === 'user');
    await base44.entities.ChatSession.update(activeSession.id, { messages: messagesUpToBefore });
    setActiveSession(prev => ({ ...prev, messages: messagesUpToBefore }));
    if (lastUserMsg) await handleSendMessage(lastUserMsg.content);
  };

  return { handleDeleteMessage, handleEditMessage, handleRegenerateMessage };
}