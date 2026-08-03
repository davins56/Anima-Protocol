import { useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";

export default function QuestAutoDetector({ sessionId, characterId, messages = [] }) {
  const lastMessageCountRef = useRef(0);
  const detectionCooldownRef = useRef(0);

  useEffect(() => {
    if (!sessionId || !characterId || messages.length < 3) return;

    const currentCount = messages.length;
    const newMessages = currentCount > lastMessageCountRef.current;

    if (newMessages && Date.now() > detectionCooldownRef.current) {
      detectAndCreateQuests();
      detectionCooldownRef.current = Date.now() + 5000; // 5 second cooldown
    }

    lastMessageCountRef.current = currentCount;
  }, [sessionId, characterId, messages.length]);

  const detectAndCreateQuests = async () => {
    try {
      // Get recent chat context
      const recentMessages = messages.slice(-10).map(m => ({
        role: m.role,
        character_name: m.character_name,
        content: m.content,
      }));

      // Call detection function
      const result = await base44.functions.invoke("detectQuestsFromNarrative", {
        session_id: sessionId,
        character_id: characterId,
        recent_messages: recentMessages,
      });

      // Create detected quests if any
      if (result?.data?.detected_quests?.length > 0) {
        const quests = result.data.detected_quests.map(q => ({
          session_id: sessionId,
          title: q.title,
          description: q.description,
          objectives: q.objectives || [],
          status: "active",
          difficulty: q.difficulty || "moderate",
          rewards: q.rewards || { xp: 0, items: [] },
          narrative_context: q.narrative_context || "",
          related_characters: [characterId, ...(q.related_characters || [])],
        }));

        // Check if quest already exists to avoid duplicates
        const existing = await base44.entities.Quest.filter({
          session_id: sessionId,
          title: { $in: quests.map(q => q.title) },
        });

        const existingTitles = new Set(existing.map(q => q.title));
        const newQuests = quests.filter(q => !existingTitles.has(q.title));

        // Create new quests
        if (newQuests.length > 0) {
          await base44.entities.Quest.bulkCreate(newQuests);
        }
      }
    } catch (err) {
      console.error("Error detecting quests:", err);
    }
  };

  // This is a background detector - no UI render
  return null;
}