// @ts-check
import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';

/**
 * @param {string} sessionId
 * @param {any[]} messages
 */
export function useEventDrivenFlow(sessionId, messages) {
  const [flowAnalysis, setFlowAnalysis] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!sessionId || !messages || messages.length < 3) return;

    // Analyze every 5 messages
    if (messages.length % 5 === 0) {
      analyzeEventFlow();
    }
  }, [sessionId, messages?.length]);

  const analyzeEventFlow = async () => {
    setLoading(true);
    try {
      const result = await base44.functions.invoke('eventDrivenStoryFlow', {
        session_id: sessionId,
        recent_messages: messages.slice(-10),
      });

      if (result?.data?.story_flow) {
        setFlowAnalysis(result.data);
      }
    } catch (err) {
      console.error('Event flow analysis error:', err);
    } finally {
      setLoading(false);
    }
  };

  return {
    flowAnalysis,
    loading,
    reanalyze: analyzeEventFlow,
  };
}