import { useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { animaApi } from "@/api/animaApi";

export function createChatTurnId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `turn_${crypto.randomUUID()}`;
  }
  return `turn_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

export function assignTurnMessageIds(messages, turnId) {
  let userIndex = 0;
  let assistantIndex = 0;
  let eventIndex = 0;
  return (messages || []).map((message) => {
    if (message?.id) return message;
    if (message?.type === "event") {
      const suffix = eventIndex === 0 ? "event" : `event:${eventIndex}`;
      eventIndex += 1;
      return { ...message, id: `${turnId}:${suffix}`, turn_id: turnId };
    }
    if (message?.role === "user") {
      const suffix = userIndex === 0 ? "user" : `user:${userIndex}`;
      userIndex += 1;
      return { ...message, id: `${turnId}:${suffix}`, turn_id: turnId };
    }
    const suffix =
      assistantIndex === 0 ? "assistant" : `assistant:${assistantIndex}`;
    assistantIndex += 1;
    return { ...message, id: `${turnId}:${suffix}`, turn_id: turnId };
  });
}

export function useChatPersistence() {
  const persistTurn = useCallback(
    async ({ sessionId, turnId, messages, content, title }) => {
      const identifiedMessages = assignTurnMessageIds(messages, turnId);
      const storedMessages = [];
      try {
        for (const message of identifiedMessages) {
          storedMessages.push(await base44.messages.append(sessionId, message));
        }
        if (content) {
          await base44.entities.ChatSession.update(sessionId, {
            last_message: content.slice(0, 60),
            title: title || content.slice(0, 30),
          });
        }
        await animaApi.chat.commitTurn(turnId);
        return storedMessages;
      } catch (error) {
        // The server checkpoint contains the generated reply and stable message
        // ids. Ask it to reconcile any partial client write idempotently.
        void animaApi.chat.retryTurn(turnId).catch(() => {});
        error.storedMessages = storedMessages;
        throw error;
      }
    },
    [],
  );

  return { persistTurn };
}
