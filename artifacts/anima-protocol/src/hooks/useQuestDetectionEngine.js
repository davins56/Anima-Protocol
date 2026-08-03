import { useEffect, useCallback } from 'react';
import { base44 } from '@/api/base44Client';

export function useQuestDetectionEngine(sessionId, characterName) {
  const detectAndCreateQuests = useCallback(async (userMessage, aiResponse) => {
    if (!sessionId || !userMessage) return null;

    try {
      const result = await base44.functions.invoke('detectAndCreateQuests', {
        session_id: sessionId,
        user_message: userMessage,
        ai_response: aiResponse || '',
        character_name: characterName,
      });

      return result?.data;
    } catch (err) {
      console.error('Quest detection error:', err);
      return null;
    }
  }, [sessionId, characterName]);

  return { detectAndCreateQuests };
}