import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import StoryBeginningModal from "./StoryBeginningModal";

export default function StoryBeginningProvider({ sessionId, isNewSession, onStoryBeginningSubmitted }) {
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    // Show modal only for new sessions (no messages yet)
    if (isNewSession && sessionId) {
      setShowModal(true);
    }
  }, [isNewSession, sessionId]);

  const handleSubmit = async (text) => {
    if (sessionId && text) {
      try {
        await base44.entities.ChatSession.update(sessionId, {
          story_beginning: text,
        });
        onStoryBeginningSubmitted?.(text);
      } catch (err) {
        console.error("Error saving story beginning:", err);
      }
    }
    setShowModal(false);
  };

  return (
    <StoryBeginningModal
      isOpen={showModal}
      onSubmit={handleSubmit}
      onSkip={() => setShowModal(false)}
    />
  );
}