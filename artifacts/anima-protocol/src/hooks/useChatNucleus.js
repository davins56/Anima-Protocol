import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { animaApi } from "@/api/animaApi";
import { collectRegionHints } from "@/lib/userRegion";
import { chatStreamStatusCopy } from "@/lib/chatStreamStatusCopy";
import { streamChatReply } from "@/lib/streamChatReply";
import { replyWasKept, reportChatClientFailure } from "@/lib/chatClientFailure";

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

  // Reset messages when switching to a different session. Keyed on `sessionId`
  // rather than `initialMessages` itself — callers commonly pass a fresh array
  // reference each render (inline literals, derived slices), and depending on
  // the array identity would re-fire this effect every render, looping forever.
  const initialMessagesRef = useRef(initialMessages);
  initialMessagesRef.current = initialMessages;
  useEffect(() => {
    setMessages(initialMessagesRef.current);
  }, [sessionId]);

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
          region: collectRegionHints(),
        });

        const assistantMessage = createChatMessage("assistant", "", {
          characterName: activeCharacter?.name ?? "Serenity",
        });
        const finalMeta = await streamChatReply(stream, {
          onDelta: (content) => {
            setMessages((prev) => {
              const trimmed = prev.filter(
                (msg) =>
                  msg.character_name !== "__typing__" &&
                  msg.character_name !== "__thinking__",
              );
              if (trimmed.some((msg) => msg.id === assistantMessage.id)) {
                return trimmed.map((msg) =>
                  msg.id === assistantMessage.id ? { ...msg, content } : msg,
                );
              }
              return [...trimmed, { ...assistantMessage, content }];
            });
          },
          onStatus: (event) => {
            if (event.provider) setProviderStatus(event.provider);
            const copy = chatStreamStatusCopy(event);
            if (!copy) return;
            setMessages((prev) => {
              if (prev.some((msg) => msg.id === assistantMessage.id)) return prev;
              const trimmed = prev.filter(
                (msg) =>
                  msg.character_name !== "__typing__" &&
                  msg.character_name !== "__thinking__",
              );
              return [
                ...trimmed,
                { ...typingMessage, content: copy, character_name: "__thinking__" },
              ];
            });
          },
        });
        const assistantText = finalMeta.content;
        if (finalMeta.provider) setProviderStatus(finalMeta.provider);

        if (!assistantText.trim()) {
          setMessages((prev) => {
            const trimmed = prev.filter(
              (msg) =>
                msg.character_name !== "__typing__" &&
                msg.character_name !== "__thinking__",
            );
            const assistantMessage = createChatMessage("assistant", "I’m not able to respond right now. Please try again in a moment.", {
              characterName: activeCharacter?.name ?? "Serenity",
            });
            return [...trimmed, assistantMessage];
          });
        }

        return finalMeta || { content: assistantText };
      } catch (err) {
        const messageText = err instanceof Error ? err.message : "Unable to send message right now.";
        reportChatClientFailure({
          error: err,
          sessionId,
          partialKept: replyWasKept({ partial: err?.partialContent }),
        });
        setError(messageText);
        setMessages((prev) => {
          const next = prev.filter(
            (msg) =>
              msg.character_name !== "__typing__" &&
              msg.character_name !== "__thinking__",
          );
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
