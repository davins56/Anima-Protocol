import { useEffect, useRef, useState } from 'react';
import { base44 } from '@/api/base44Client';

export function useAutoWikiTagging(sessionId, recentMessages = [], enabled = true) {
  const [autoDetectedEntities, setAutoDetectedEntities] = useState([]);
  const [isExtracting, setIsExtracting] = useState(false);
  const messageCheckRef = useRef(0);

  useEffect(() => {
    if (!sessionId || !enabled || recentMessages.length === 0) return;

    const currentMessageCount = recentMessages.length;

    // Trigger extraction every 5-6 new messages
    if (currentMessageCount > messageCheckRef.current + 5) {
      messageCheckRef.current = currentMessageCount;
      triggerAutoTagging();
    }
  }, [sessionId, recentMessages, enabled]);

  const triggerAutoTagging = async () => {
    setIsExtracting(true);
    try {
      const result = await base44.functions.invoke('autoTagWikiEntities', {
        session_id: sessionId,
        recent_messages: recentMessages.slice(-10),
        action: 'extract_and_update',
      });

      if (result?.data?.extracted?.length > 0) {
        // Show newly extracted entities
        setAutoDetectedEntities(result.data.extracted.slice(0, 3));

        // Clear notification after 4 seconds
        setTimeout(() => setAutoDetectedEntities([]), 4000);
      }
    } catch (err) {
      console.error('Error in auto wiki tagging:', err);
    } finally {
      setIsExtracting(false);
    }
  };

  const linkAcrossSession = async (entityName, entityType, targetSessionId) => {
    try {
      // Find the entity in current session
      const entries = await base44.entities.WikiCodex.filter({
        name: entityName,
        entry_type: entityType,
        session_ids: { $elemMatch: sessionId },
      });

      if (entries?.length > 0) {
        const entry = entries[0];
        
        // Add target session to session_ids to track cross-session mentions
        const updatedSessionIds = [...new Set([...(entry.session_ids || []), targetSessionId])];
        
        await base44.entities.WikiCodex.update(entry.id, {
          session_ids: updatedSessionIds,
          mention_count: (entry.mention_count || 0) + 1,
        });
      }
    } catch (err) {
      console.error('Error linking entity across sessions:', err);
    }
  };

  return {
    autoDetectedEntities,
    isExtracting,
    triggerAutoTagging,
    linkAcrossSession,
  };
}