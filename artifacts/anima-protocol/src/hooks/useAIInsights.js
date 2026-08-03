// @ts-check
import { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";

/**
 * @param {string} sessionId
 * @param {any[]} messages
 */
export function useAIInsights(sessionId, messages) {
  const [insights, setInsights] = useState(null);
  const [loading, setLoading] = useState(false);
  const [lastAnalyzedCount, setLastAnalyzedCount] = useState(0);
  const analysisIntervalRef = useRef(null);

  // Analyze every 10+ new messages or manually triggered
  const analyzeConversation = async () => {
    if (!sessionId || !messages || messages.length < 5) {
      return;
    }

    setLoading(true);
    try {
      const result = await base44.functions.invoke("generateInsightsSummary", {
        session_id: sessionId,
        messages: messages.slice(-50), // Last 50 messages for context
        focus_areas: ["character_themes", "plot_coherence", "character_evolution"],
      });

      if (result?.data) {
        setInsights(result.data);
        setLastAnalyzedCount(messages.length);
      }
    } catch (err) {
      console.error("Error generating insights:", err);
    } finally {
      setLoading(false);
    }
  };

  // Auto-analyze every 10+ new messages
  useEffect(() => {
    if (
      messages &&
      messages.length > lastAnalyzedCount + 10 &&
      !loading
    ) {
      analyzeConversation();
    }
  }, [messages?.length, lastAnalyzedCount, loading, sessionId]);

  return {
    insights,
    loading,
    analyzeNow: analyzeConversation,
  };
}