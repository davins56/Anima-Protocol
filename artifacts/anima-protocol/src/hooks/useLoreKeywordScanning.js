import { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useLocalOnlyLlmChain } from '@/lib/localOnlyLlm';

export const useLoreKeywordScanning = (sessionId, messages) => {
  const [loreLinks, setLoreLinks] = useState({});
  const [scanning, setScanning] = useState(false);
  const [lastScannedCount, setLastScannedCount] = useState(0);
  const localOnly = useLocalOnlyLlmChain();

  // Auto-scan when messages arrive
  useEffect(() => {
    if (localOnly) return;
    if (!sessionId || !messages || messages.length === 0) return;

    // Only scan if we have new messages
    if (messages.length <= lastScannedCount) return;

    const scanWithDelay = async () => {
      setScanning(true);
      try {
        const result = await base44.functions.invoke('scanAndLinkLoreKeywords', {
          session_id: sessionId,
          messages: messages.filter(m => m.role !== 'system' && m.character_name !== '__typing__'),
        });

        if (result?.data?.linked_messages) {
          // Index lore links by message index
          const indexed = {};
          result.data.linked_messages.forEach(link => {
            indexed[link.message_index] = link.lore_links;
          });
          setLoreLinks(indexed);
        }

        setLastScannedCount(messages.length);
      } catch (err) {
        console.error('Lore keyword scanning error:', err);
      } finally {
        setScanning(false);
      }
    };

    // Debounce scanning (wait 800ms after last message before scanning)
    const timer = setTimeout(scanWithDelay, 800);
    return () => clearTimeout(timer);
  }, [sessionId, messages, lastScannedCount, localOnly]);

  return { loreLinks, scanning };
};