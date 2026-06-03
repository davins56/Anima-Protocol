// @ts-check
import { useState, useCallback } from "react";

/**
 * Hook to detect and highlight when the AI references a prior memory or shows continuity.
 * Creates the "the AI remembers me" moment.
 * @param {any} message
 * @param {any[]} characterMemories
 */
export function useMemoryHighlight(message, characterMemories) {
  const [isMemoryReference, setIsMemoryReference] = useState(false);
  const [memoryDetail, setMemoryDetail] = useState(null);

  const checkForMemory = useCallback(() => {
    if (!message?.content || !characterMemories?.length) return;

    const content = message.content.toLowerCase();

    // Scan for memory keywords
    for (const memory of characterMemories) {
      const subject = memory.subject?.toLowerCase() || "";
      const fact = memory.fact?.toLowerCase() || "";

      // Check if message references this memory
      if (
        (subject && content.includes(subject)) ||
        (fact && content.includes(fact.slice(0, 20))) // Check first 20 chars to avoid false positives
      ) {
        setIsMemoryReference(true);
        setMemoryDetail(memory);
        return;
      }
    }

    setIsMemoryReference(false);
    setMemoryDetail(null);
  }, [message, characterMemories]);

  // Run check when message or memories change
  useState(() => {
    checkForMemory();
  });

  return { isMemoryReference, memoryDetail };
}