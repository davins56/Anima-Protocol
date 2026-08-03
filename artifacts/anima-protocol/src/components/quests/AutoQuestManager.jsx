import { useState, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { useBackgroundQuestDetection } from "@/hooks/useBackgroundQuestDetection";

export function useAutoQuestManager({
  sessionId,
  characterId,
  messages,
  characterEmotions,
}) {
  const [detectedQuests, setDetectedQuests] = useState([]);
  const [activeQuests, setActiveQuests] = useState([]);

  const handleQuestsDetected = useCallback((quests) => {
    if (!quests || quests.length === 0) return;

    // Filter out already-active quests
    const newQuests = quests.filter(
      (q) => !activeQuests.find((aq) => aq.title === q.title)
    );

    if (newQuests.length > 0) {
      setDetectedQuests(newQuests);
    }
  }, [activeQuests]);

  // Run background detection
  useBackgroundQuestDetection(
    sessionId,
    messages,
    characterEmotions,
    handleQuestsDetected
  );

  const handleAcceptQuest = async (quest) => {
    try {
      // Create quest record in database
      const created = await base44.entities.Quest.create({
        session_id: sessionId,
        title: quest.title || quest.name,
        description: quest.description || quest.summary || "",
        objectives: quest.objectives || [{ id: "main", description: quest.title, completed: false }],
        status: "active",
        difficulty: quest.difficulty || "moderate",
        narrative_context: quest.context || "",
        required_locations: quest.required_locations || [],
        related_characters: quest.related_characters || [],
      });

      // Move from detected to active
      setActiveQuests((prev) => [...prev, created]);
      setDetectedQuests((prev) =>
        prev.filter((q) => q.title !== quest.title)
      );
    } catch (err) {
      console.error("Error accepting quest:", err);
    }
  };

  const handleRejectQuest = (questTitle) => {
    setDetectedQuests((prev) => prev.filter((q) => q.title !== questTitle));
  };

  return {
    detectedQuests,
    activeQuests,
    handleAcceptQuest,
    handleRejectQuest,
  };
}