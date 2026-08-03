import { useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";

export function useBackgroundQuestDetection(sessionId, messages, characterEmotions, onQuestsDetected) {
  const checkRef = useRef(0);
  const lastAnalysisRef = useRef(0);

  useEffect(() => {
    if (!sessionId || !messages || messages.length < 3) return;

    const currentCount = messages.length;
    const timeSinceLastCheck = Date.now() - lastAnalysisRef.current;
    const messagesSinceLastCheck = currentCount - checkRef.current;

    // Trigger analysis every 4-6 messages or every 45 seconds, whichever comes first
    const shouldAnalyze =
      messagesSinceLastCheck >= (4 + Math.floor(Math.random() * 3)) || timeSinceLastCheck > 45000;

    if (!shouldAnalyze) return;

    lastAnalysisRef.current = Date.now();
    checkRef.current = currentCount;

    // Run detection in background (non-blocking)
    const detectQuests = async () => {
      try {
        // Get narrative context analysis
        const contextRes = await base44.functions.invoke("analyzeNarrativeContext", {
          recent_messages: messages.slice(-8),
          session_context: "",
          character_emotions: characterEmotions,
        });

        if (!contextRes?.data) return;

        // Detect quests from the narrative context
        const questRes = await base44.functions.invoke("detectQuestsFromNarrative", {
          session_id: sessionId,
          narrative_context: contextRes.data,
          recent_messages: messages.slice(-8).map((m) => ({
            role: m.role,
            character_name: m.character_name,
            content: m.content,
          })),
          character_emotions: characterEmotions,
        });

        if (questRes?.data?.detected_quests?.length > 0) {
          onQuestsDetected(questRes.data.detected_quests);
        }
      } catch (err) {
        console.error("Quest detection error:", err);
      }
    };

    detectQuests();
  }, [sessionId, messages, characterEmotions, onQuestsDetected]);
}