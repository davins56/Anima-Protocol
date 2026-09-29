import { useCallback } from "react";
import { chatStreamStatusCopy } from "@/lib/chatStreamStatusCopy";
import { HELD_SEND_NOTE } from "@/lib/heldChatSend";

/**
 * Paint a streaming/thinking bubble onto the session that started the send.
 * After /chat/:id navigation the updater still sees the newly opened thread —
 * never replace that history with the previous thread's prefix.
 */
export function applyStreamingMessage(session, { sessionId, prefixMessages, message }) {
  if (!session) return session;
  if (sessionId && session.id !== sessionId) return session;
  return { ...session, messages: [...prefixMessages, message] };
}

export function useChatStreaming(setActiveSession) {
  const createStreamUi = useCallback(
    ({ sessionId, updatedMessages, characterName, timestamp, onDelta, turnId }) => {
      let paintedTokens = false;
      const resolveTurnId = () => (typeof turnId === "function" ? turnId() : turnId);

      const replaceTransient = (message) => {
        const id = resolveTurnId();
        setActiveSession((session) =>
          applyStreamingMessage(session, {
            sessionId,
            prefixMessages: updatedMessages,
            message: id ? { ...message, turn_id: id } : message,
          }),
        );
      };

      const showTyping = () => {
        replaceTransient({
          role: "assistant",
          content: "...",
          character_name: "__typing__",
          timestamp,
        });
      };

      const showStreamingPartial = (accumulated) => {
        paintedTokens = true;
        onDelta?.(accumulated);
        replaceTransient({
          role: "assistant",
          content: accumulated,
          character_name: characterName,
          timestamp,
          is_streaming: true,
        });
      };

      const showStatus = (event) => {
        if (paintedTokens && event?.status === "progress") return;
        if (event?.status === "thinking") {
          replaceTransient({
            role: "assistant",
            content: "...",
            character_name: "__thinking__",
            timestamp,
          });
          return;
        }
        if (event?.status === "waiting") {
          if (paintedTokens) return;
          replaceTransient({
            role: "assistant",
            content: chatStreamStatusCopy(event) || HELD_SEND_NOTE,
            character_name: "__thinking__",
            timestamp,
          });
          return;
        }
        const copy = chatStreamStatusCopy(event);
        if (!copy) return;
        if (event?.status === "progress") {
          replaceTransient({
            role: "assistant",
            content: copy,
            character_name: "__thinking__",
            timestamp,
          });
          return;
        }
        if (event?.status !== "ensemble") return;
        replaceTransient({
          role: "assistant",
          content: copy,
          character_name: "__typing__",
          timestamp,
        });
      };

      return { showTyping, showStreamingPartial, showStatus };
    },
    [setActiveSession],
  );

  return { createStreamUi };
}
