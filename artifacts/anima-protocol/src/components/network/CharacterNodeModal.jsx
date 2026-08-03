import { useEffect, useState } from "react";
import { X, Loader, Users, Heart, Zap } from "lucide-react";
import { motion } from "framer-motion";
import { base44 } from "@/api/base44Client";

export default function CharacterNodeModal({
  character,
  faction,
  sessionId,
  onClose,
}) {
  const [relationships, setRelationships] = useState([]);
  const [sharedEvents, setSharedEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (character && sessionId) {
      loadCharacterData();
    }
  }, [character, sessionId]);

  const loadCharacterData = async () => {
    setLoading(true);
    try {
      const [rels, events] = await Promise.all([
        base44.entities.CharacterRelationship.filter(
          { character_id: character.id, session_id: sessionId },
          "-score",
          10
        ),
        base44.entities.WorldState.filter(
          { session_id: sessionId, is_active: true },
          "-created_date",
          10
        ),
      ]);

      setRelationships(rels || []);
      setSharedEvents(events || []);
    } catch (err) {
      console.error("Error loading character data:", err);
    } finally {
      setLoading(false);
    }
  };

  const tierColors = {
    devoted: "text-red-400 bg-red-400/10 border-red-400/30",
    close: "text-green-400 bg-green-400/10 border-green-400/30",
    warm: "text-cyan-400 bg-cyan-400/10 border-cyan-400/30",
    neutral: "text-primary/60 bg-primary/5 border-primary/20",
    cold: "text-yellow-400 bg-yellow-400/10 border-yellow-400/30",
    hostile: "text-orange-400 bg-orange-400/10 border-orange-400/30",
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="w-full max-w-2xl max-h-[90vh] bg-background border border-primary/30 rounded-lg shadow-2xl overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="flex items-start justify-between p-6 border-b border-primary/20 bg-black/60 flex-shrink-0">
          <div className="flex items-start gap-4">
            {character.avatar_url && (
              <img
                src={character.avatar_url}
                alt={character.name}
                className="w-16 h-16 rounded border border-primary/30 object-cover"
              />
            )}
            <div>
              <h2 className="font-mono text-lg text-primary tracking-widest uppercase">
                {character.name}
              </h2>
              <p className="text-[10px] font-mono text-primary/50 mt-1">
                {faction} • {character.category || "Unknown"}
              </p>
              {character.universe && (
                <p className="text-[9px] font-mono text-primary/40 mt-0.5">
                  From: {character.universe}
                </p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-primary/30 hover:text-primary transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* Bio */}
          {character.personality && (
            <div className="space-y-2">
              <h3 className="font-mono text-xs text-primary/40 tracking-widest uppercase">
                Personality & Traits
              </h3>
              <p className="text-[9px] font-mono text-primary/70 leading-relaxed p-3 bg-black/40 border border-primary/10 rounded">
                {character.personality}
              </p>
            </div>
          )}

          {character.backstory && (
            <div className="space-y-2">
              <h3 className="font-mono text-xs text-primary/40 tracking-widest uppercase">
                Backstory
              </h3>
              <p className="text-[9px] font-mono text-primary/70 leading-relaxed p-3 bg-black/40 border border-primary/10 rounded">
                {character.backstory}
              </p>
            </div>
          )}

          {character.speaking_style && (
            <div className="space-y-2">
              <h3 className="font-mono text-xs text-primary/40 tracking-widest uppercase">
                Speaking Style
              </h3>
              <p className="text-[9px] font-mono text-primary/70 leading-relaxed p-3 bg-black/40 border border-primary/10 rounded">
                {character.speaking_style}
              </p>
            </div>
          )}

          {/* Relationships */}
          {relationships.length > 0 && (
            <div className="space-y-2">
              <h3 className="font-mono text-xs text-primary/40 tracking-widest uppercase flex items-center gap-2">
                <Heart className="w-3 h-3" />
                Relationships
              </h3>
              <div className="space-y-1.5">
                {relationships.map((rel, idx) => (
                  <div
                    key={idx}
                    className={`p-2 border rounded text-[8px] font-mono ${
                      tierColors[rel.tier] || tierColors.neutral
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="tracking-widest uppercase">
                        {rel.tier}
                      </span>
                      <span>Score: {rel.score}/100</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Shared Events */}
          {sharedEvents.length > 0 && (
            <div className="space-y-2">
              <h3 className="font-mono text-xs text-primary/40 tracking-widest uppercase flex items-center gap-2">
                <Zap className="w-3 h-3" />
                Recent World Events
              </h3>
              <div className="space-y-1 text-[8px]">
                {sharedEvents.slice(0, 5).map((event, idx) => (
                  <div
                    key={idx}
                    className="p-2 bg-black/40 border border-primary/10 rounded"
                  >
                    <p className="font-mono font-semibold text-primary/80">
                      {event.subject}
                    </p>
                    <p className="text-primary/50 line-clamp-1 mt-0.5">
                      {event.fact}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {loading && (
            <div className="flex items-center justify-center py-6">
              <Loader className="w-4 h-4 text-primary/60 animate-spin" />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 p-6 border-t border-primary/20 bg-black/60 flex-shrink-0">
          <button
            onClick={onClose}
            className="flex-1 px-6 py-2 border border-primary/20 text-primary/40 hover:text-primary hover:border-primary/40 font-mono text-xs tracking-widest uppercase transition-all"
          >
            Close
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}