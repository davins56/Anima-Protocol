import { useCallback } from "react";

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
    ({ sessionId, updatedMessages, characterName, timestamp, onDelta }) => {
      const replaceTransient = (message) => {
        setActiveSession((session) =>
          applyStreamingMessage(session, {
            sessionId,
            prefixMessages: updatedMessages,
            message,
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
        if (event?.status === "thinking") {
          replaceTransient({
            role: "assistant",
            content: "...",
            character_name: "__thinking__",
            timestamp,
          });
          return;
        }
        if (event?.status !== "ensemble") return;
        const minds = Array.isArray(event.minds)
          ? event.minds.filter(Boolean).join(", ")
          : "";
        const content =
          event.phase === "combining"
            ? "Combining mind drafts…"
            : minds
              ? `Minds drafting: ${minds}…`
              : "Minds drafting…";
        replaceTransient({
          role: "assistant",
          content,
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
