// @ts-check
import { useEffect, useRef, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { isFinishedLoreMessage, useLocalOnlyLlmChain } from '@/lib/localOnlyLlm';

const LORE_DETECT_DEBOUNCE_MS = 400;

/**
 * Detect lore keywords once per finished message.
 * Local-only chat never calls the network — the model slot is for the reply.
 * @param {string | { content?: string, character_name?: string, is_streaming?: boolean }} messageOrContent
 * @param {string | null} sessionId
 */
export function useLoreDetection(messageOrContent, sessionId) {
  const message =
    typeof messageOrContent === 'string'
      ? { content: messageOrContent }
      : messageOrContent || {};
  const content = typeof message.content === 'string' ? message.content : '';
  const [loreContext, setLoreContext] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const localOnly = useLocalOnlyLlmChain();
  const attempted = useRef(new Set());

  useEffect(() => {
    if (localOnly || !isFinishedLoreMessage(message) || !sessionId) {
      setLoreContext([]);
      setIsLoading(false);
      return undefined;
    }

    const key = `${sessionId}\n${content}`;
    if (attempted.current.has(key)) return undefined;

    const controller = new AbortController();
    const timer = setTimeout(() => {
      attempted.current.add(key);
      setIsLoading(true);
      base44.functions
        .invoke(
          'detectLoreKeywords',
          { content, session_id: sessionId },
          { signal: controller.signal },
        )
        .then((result) => {
          if (controller.signal.aborted) return;
          if (result?.data?.context) setLoreContext(result.data.context);
        })
        .catch((err) => {
          if (controller.signal.aborted) return;
          console.error('Lore detection error:', err);
          setLoreContext([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) setIsLoading(false);
        });
    }, LORE_DETECT_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [localOnly, content, sessionId, message.character_name, message.is_streaming]);

  return {
    loreContext,
    isLoading,
  };
}
