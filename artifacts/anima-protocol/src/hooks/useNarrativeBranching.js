import { useState, useCallback } from 'react';
import { base44 } from '@/api/base44Client';

export function useNarrativeBranching(sessionId) {
  const [lastUserChoice, setLastUserChoice] = useState(null);
  const [branches, setBranches] = useState([]);
  const [branchLoading, setBranchLoading] = useState(false);

  const predictBranches = useCallback(
    async (userMessage, recentMessages, characterEmotions, relationships) => {
      if (!sessionId || !userMessage) return;

      setBranchLoading(true);
      try {
        const result = await base44.functions.invoke('predictNarrativeBranches', {
          session_id: sessionId,
          last_user_choice: userMessage,
          recent_messages: recentMessages.slice(-5),
          character_emotions: characterEmotions,
          relationships,
        });

        if (result?.data?.branches) {
          setBranches(result.data.branches);
          setLastUserChoice(userMessage);
        }
      } catch (err) {
        console.error('Error predicting narrative branches:', err);
      } finally {
        setBranchLoading(false);
      }
    },
    [sessionId]
  );

  return {
    lastUserChoice,
    branches,
    branchLoading,
    predictBranches,
  };
}