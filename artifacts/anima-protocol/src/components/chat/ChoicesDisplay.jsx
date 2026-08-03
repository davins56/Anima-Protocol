import { useState } from "react";
import { motion } from "framer-motion";
import { base44 } from "@/api/base44Client";

export default function ChoicesDisplay({ sessionId, characterId, onChoiceMade, choices }) {
  const [selecting, setSelecting] = useState(null);

  const handleChoice = async (choice) => {
    setSelecting(choice.id);
    try {
      // Update relationships for affected characters
      if (choice.affects_relationships) {
        for (const [charId, delta] of Object.entries(choice.affects_relationships)) {
          const rels = await base44.entities.CharacterRelationship.filter({
            character_id: charId,
            session_id: sessionId,
          });

          if (rels?.length > 0) {
            const rel = rels[0];
            const newScore = Math.max(-100, Math.min(100, rel.score + delta));
            await base44.entities.CharacterRelationship.update(rel.id, {
              score: newScore,
            });
          }
        }
      }

      // Update emotions for affected characters
      if (choice.affects_emotions) {
        for (const [charId, emotionData] of Object.entries(choice.affects_emotions)) {
          await base44.entities.CharacterEmotionalState.create({
            character_id: charId,
            session_id: sessionId,
            primary_emotion: emotionData.emotion,
            intensity: emotionData.intensity,
            trigger: choice.text,
            affected_by_actor: "player",
            is_current: true,
          });
        }
      }

      onChoiceMade(choice);
    } catch (err) {
      console.error("Error processing choice:", err);
    } finally {
      setSelecting(null);
    }
  };

  if (!choices || choices.length === 0) return null;

  return (
    <div className="px-3 sm:px-4 py-3 border-t border-primary/20 bg-black/80 backdrop-blur-sm space-y-2">
      <p className="text-[8px] font-mono text-primary/40 tracking-[0.2em] uppercase">What do you do?</p>
      <div className="space-y-2">
        {choices.map((choice, idx) => (
          <motion.button
            key={choice.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.05 }}
            onClick={() => handleChoice(choice)}
            disabled={selecting !== null}
            className="w-full text-left p-2.5 sm:p-3 border border-primary/20 bg-black/40 hover:bg-primary/10 hover:border-primary/40 text-primary/70 hover:text-primary font-mono text-[9px] sm:text-xs tracking-wide transition-all disabled:opacity-50 group"
          >
            <div className="flex items-start gap-2">
              <div className="w-1.5 h-1.5 sm:w-2 sm:h-2 bg-primary/30 group-hover:bg-primary rounded-full mt-1 flex-shrink-0 transition-colors" />
              <span className="flex-1">{choice.text}</span>
            </div>
            {choice.consequence && (
              <p className="text-[8px] sm:text-[9px] text-primary/40 mt-1.5 ml-3.5">
                {choice.consequence}
              </p>
            )}
          </motion.button>
        ))}
      </div>
    </div>
  );
}