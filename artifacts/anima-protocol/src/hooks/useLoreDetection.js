import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';

/**
 * Hook to detect lore keywords in messages and manage popover state.
 */
export function useLoreDetection(messageContent, sessionId) {
  const [loreContext, setLoreContext] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!messageContent || !sessionId) {
      setLoreContext([]);
      return;
    }

    detectLore();
  }, [messageContent, sessionId]);

  const detectLore = async () => {
    setIsLoading(true);
    try {
      const result = await base44.functions.invoke('detectLoreKeywords', {
        content: messageContent,
        session_id: sessionId,
      });

      if (result?.data?.context) {
        setLoreContext(result.data.context);
      }
    } catch (err) {
      console.error('Lore detection error:', err);
      setLoreContext([]);
    } finally {
      setIsLoading(false);
    }
  };

  return {
    loreContext,
    isLoading,
  };
}