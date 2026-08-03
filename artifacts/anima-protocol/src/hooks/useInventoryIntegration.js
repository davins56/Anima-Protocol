import { useCallback } from 'react';
import { base44 } from '@/api/base44Client';

export function useInventoryIntegration() {
  const detectAndProcessItemLoss = useCallback(async (narrative, characterId, sessionId) => {
    const itemLossKeywords = ['lost', 'destroyed', 'broken', 'stolen', 'consumed', 'dropped'];
    const narrativeText = narrative.toLowerCase();

    if (itemLossKeywords.some(kw => narrativeText.includes(kw))) {
      try {
        // Extract item name from narrative (simplified pattern matching)
        const itemMatches = narrativeText.match(
          /(?:lost|destroyed|stolen|dropped|consumed|broke)\s+(?:the\s+)?([a-zA-Z\s]+?)(?:\.|,|\s+(?:and|or))/i
        );

        if (itemMatches?.[1]) {
          const itemName = itemMatches[1].trim();
          await base44.functions.invoke('processItemLoss', {
            character_id: characterId,
            session_id: sessionId,
            loss_type: 'narrative',
            item_name: itemName,
            quantity: 1,
            reason: 'Story event',
          }).catch(() => {});
        }
      } catch (e) {
        console.warn('Item loss detection error:', e);
      }
    }
  }, []);

  const calculateEquipmentImpact = useCallback(async (characterId, sessionId) => {
    try {
      const result = await base44.functions.invoke('calculateInventoryStats', {
        character_id: characterId,
        session_id: sessionId,
      });
      return result.data;
    } catch (err) {
      console.error('Equipment impact calculation failed:', err);
      return null;
    }
  }, []);

  const generateInventoryNarrativeChoices = useCallback(async (characterId, sessionId, recentMessages) => {
    try {
      const result = await base44.functions.invoke('inventoryNarrativeImpact', {
        character_id: characterId,
        session_id: sessionId,
        recent_messages: recentMessages,
      });
      return result.data?.narrative_choices || [];
    } catch (err) {
      console.error('Narrative choice generation failed:', err);
      return [];
    }
  }, []);

  return {
    detectAndProcessItemLoss,
    calculateEquipmentImpact,
    generateInventoryNarrativeChoices,
  };
}