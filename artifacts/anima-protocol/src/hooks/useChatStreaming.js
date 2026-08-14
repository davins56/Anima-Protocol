import { useCallback } from "react";

export function useChatStreaming(setActiveSession) {
  const createStreamUi = useCallback(
    ({ updatedMessages, characterName, timestamp, onDelta }) => {
      const replaceTransient = (message) => {
        setActiveSession((session) =>
          session
            ? { ...session, messages: [...updatedMessages, message] }
            : session,
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
