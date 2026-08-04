import { useCallback, useEffect, useMemo, useState } from "react";
import { animaApi } from "@/api/animaApi";

function createChatMessage(role, content, { characterName = null, attachments = [], type = undefined } = {}) {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    content: String(content ?? ""),
    timestamp: new Date().toISOString(),
    character_name: characterName ?? (role === "assistant" ? "Serenity" : undefined),
    attachments: attachments.length > 0 ? attachments : undefined,
    type,
  };
}

export function useChatNucleus({ sessionId, initialMessages = [], characters = [], activeCharacter = null, mode = "solo" }) {
  const [messages, setMessages] = useState(initialMessages);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [providerStatus, setProviderStatus] = useState(null);

  useEffect(() => {
    setMessages(initialMessages);
  }, [initialMessages]);

  const session = useMemo(
    () => ({
      id: sessionId,
      mode,
      character_id: activeCharacter?.id ?? null,
      group_character_ids: mode === "group" ? characters.map((c) => c.id).filter(Boolean) : undefined,
    }),
    [sessionId, mode, activeCharacter, characters],
  );

  const sendMessage = useCallback(
    async (message) => {
      const userText = String(message?.text ?? "").trim();
      if (!userText) return;
      if (isLoading) return;

      const userMessage = createChatMessage("user", userText, {
        attachments: message.attachments ?? [],
      });
      setMessages((prev) => [...prev, userMessage]);
      setIsLoading(true);
      setError(null);

      const typingMessage = createChatMessage("assistant", "...", {
        characterName: "__typing__",
        type: "typing",
      });
      setMessages((prev) => [...prev, typingMessage]);

      try {
        const stream = animaApi.chat.sendMessage({
          sessionId,
          content: userText,
          characterId: activeCharacter?.id ?? null,
          characterIds: characters.map((character) => character.id).filter(Boolean),
          assistantCharacterId: activeCharacter?.id ?? null,
          assistantCharacterName: activeCharacter?.name ?? null,
          mode,
          persist: true,
        });

        let assistantText = "";
        let assistantMessageId = null;
        let finalMeta = null;

        for await (const event of stream) {
          if (event?.error) {
            throw new Error(event.error);
          }

          if (event?.provider) {
            setProviderStatus(event.provider);
          }

          if (typeof event?.content === "string") {
            assistantText += event.content;
            setMessages((prev) => {
              const trimmed = prev.filter((msg) => msg.character_name !== "__typing__");
              if (assistantMessageId && trimmed[trimmed.length - 1]?.id === assistantMessageId) {
                return trimmed.map((msg) =>
                  msg.id === assistantMessageId ? { ...msg, content: assistantText } : msg,
                );
              }

              const assistantMessage = createChatMessage("assistant", assistantText, {
                characterName: activeCharacter?.name ?? "Serenity",
              });
              assistantMessageId = assistantMessage.id;
              return [...trimmed, assistantMessage];
            });
          }

          if (event?.done) {
            finalMeta = event;
          }
        }

        if (!assistantText.trim()) {
          setMessages((prev) => {
            const trimmed = prev.filter((msg) => msg.character_name !== "__typing__");
            const assistantMessage = createChatMessage("assistant", "I’m not able to respond right now. Please try again in a moment.", {
              characterName: activeCharacter?.name ?? "Serenity",
            });
            return [...trimmed, assistantMessage];
          });
        }

        return finalMeta || { content: assistantText };
      } catch (err) {
        const messageText = err instanceof Error ? err.message : "Unable to send message right now.";
        setError(messageText);
        setMessages((prev) => {
          const next = prev.filter((msg) => msg.character_name !== "__typing__");
          return [
            ...next,
            createChatMessage("assistant", `System: ${messageText}`, {
              characterName: "Serenity",
            }),
          ];
        });
        return { error: messageText };
      } finally {
        setIsLoading(false);
      }
    },
    [activeCharacter, characters, isLoading, mode, sessionId],
  );

  const resetMessages = useCallback((nextMessages = []) => {
    setMessages(nextMessages);
    setError(null);
    setProviderStatus(null);
  }, []);

  return {
    session,
    messages,
    isLoading,
    error,
    providerStatus,
    sendMessage,
    resetMessages,
  };
}
