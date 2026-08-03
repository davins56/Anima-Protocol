import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { base44 } from "@/api/base44Client";

export default function RelationshipTimeline({ sessionId }) {
  const [characters, setCharacters] = useState([]);
  const [relationships, setRelationships] = useState([]);
  const [emotions, setEmotions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedChar, setSelectedChar] = useState(null);

  useEffect(() => {
    loadData();
  }, [sessionId]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [chars, rels, emots] = await Promise.all([
        base44.entities.Character.list("-created_date", 100),
        sessionId ? base44.entities.CharacterRelationship.filter({ session_id: sessionId }) : Promise.resolve([]),
        sessionId ? base44.entities.CharacterEmotionalState.filter({ session_id: sessionId }, "-created_date", 100) : Promise.resolve([]),
      ]);
      setCharacters(chars || []);
      setRelationships(rels || []);
      setEmotions(emots || []);
    } catch (err) {
      console.error("Error loading timeline data:", err);
    } finally {
      setLoading(false);
    }
  };

  // Get unique characters involved in this session
  const sessionCharIds = new Set(
    relationships.map(r => r.character_id)
  );
  
  const activeChars = characters.filter(c => sessionCharIds.has(c.id) || !sessionId);
  
  if (loading) {
    return (
      <div className="text-center py-8 font-mono text-primary/30 text-sm animate-pulse">
        Loading timeline...
      </div>
    );
  }

  if (activeChars.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="font-mono text-primary/20 text-sm tracking-widest uppercase">
          No character data for visualization
        </p>
      </div>
    );
  }

  const getEmotionColor = (emotion) => {
    const colors = {
      joyful: "text-green-400",
      calm: "text-blue-400",
      sad: "text-cyan-300",
      angry: "text-red-400",
      afraid: "text-orange-300",
      disgusted: "text-purple-400",
      surprised: "text-yellow-400",
      hopeful: "text-lime-400",
      conflicted: "text-pink-400",
      desperate: "text-red-300",
    };
    return colors[emotion] || "text-primary/60";
  };

  const getTierColor = (tier) => {
    const colors = {
      hostile: "border-red-400/40 bg-red-400/10 text-red-400",
      cold: "border-blue-300/40 bg-blue-300/10 text-blue-300",
      neutral: "border-primary/40 bg-primary/10 text-primary",
      warm: "border-cyan-400/40 bg-cyan-400/10 text-cyan-400",
      close: "border-green-400/40 bg-green-400/10 text-green-400",
      devoted: "border-yellow-400/40 bg-yellow-400/10 text-yellow-400",
    };
    return colors[tier] || colors.neutral;
  };

  const getTierScore = (tier) => {
    const scores = { hostile: -100, cold: -50, neutral: 0, warm: 50, close: 75, devoted: 100 };
    return scores[tier] || 0;
  };

  return (
    <div className="space-y-6">
      {/* Character Network */}
      <div>
        <h3 className="font-mono text-xs text-primary/60 tracking-[0.2em] uppercase mb-4">Character Network</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {activeChars.map((char) => {
            const charRels = relationships.filter(r => r.character_id === char.id);
            const charEmotion = emotions.find(e => e.character_id === char.id);
            const avgRelScore = charRels.length > 0 
              ? Math.round(charRels.reduce((sum, r) => sum + r.score, 0) / charRels.length)
              : 0;

            return (
              <motion.button
                key={char.id}
                onClick={() => setSelectedChar(selectedChar?.id === char.id ? null : char)}
                whileHover={{ scale: 1.02 }}
                className={`p-4 border transition-all hud-corner text-left ${
                  selectedChar?.id === char.id
                    ? "border-primary/60 bg-primary/10"
                    : "border-primary/15 bg-black/40 hover:border-primary/40"
                }`}
              >
                <div className="flex items-start gap-2 mb-2">
                  {char.avatar_url ? (
                    <img src={char.avatar_url} alt={char.name} className="w-8 h-8 border border-primary/20" />
                  ) : (
                    <div className="w-8 h-8 border border-primary/20 bg-primary/10 flex items-center justify-center">
                      <span className="font-mono text-[10px] text-primary/60">{char.name[0]}</span>
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <h4 className="font-mono text-[10px] tracking-wider uppercase truncate text-primary">
                      {char.name}
                    </h4>
                    <p className="text-[8px] font-mono text-primary/40 truncate">{char.universe || "Original"}</p>
                  </div>
                </div>

                <div className="space-y-2">
                  {/* Emotional State */}
                  {charEmotion && (
                    <div className="flex items-center gap-2">
                      <span className="text-[8px] font-mono text-primary/40 tracking-widest uppercase flex-shrink-0">Mood:</span>
                      <span className={`text-[9px] font-mono tracking-wider uppercase ${getEmotionColor(charEmotion.primary_emotion)}`}>
                        {charEmotion.primary_emotion}
                      </span>
                      <div className="h-1 flex-1 border border-primary/20 bg-black/60">
                        <div
                          className={`h-full ${getEmotionColor(charEmotion.primary_emotion).replace('text-', 'bg-')}`}
                          style={{ width: `${charEmotion.intensity}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Relationship Network */}
                  {charRels.length > 0 && (
                    <div>
                      <p className="text-[8px] font-mono text-primary/40 tracking-widest uppercase mb-1">
                        {charRels.length} ties · avg {avgRelScore}
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {charRels.slice(0, 3).map((rel) => {
                          const relChar = characters.find(c => c.id === rel.character_id);
                          return relChar ? (
                            <span
                              key={rel.character_id}
                              className={`text-[7px] font-mono px-1.5 py-0.5 border tracking-widest uppercase ${getTierColor(rel.tier)}`}
                            >
                              {relChar.name} {rel.tier}
                            </span>
                          ) : null;
                        })}
                        {charRels.length > 3 && (
                          <span className="text-[7px] font-mono text-primary/30">+{charRels.length - 3}</span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </motion.button>
            );
          })}
        </div>
      </div>

      {/* Relationship Matrix */}
      {selectedChar && relationships.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-4 border border-primary/20 bg-black/40"
        >
          <h3 className="font-mono text-xs text-primary/60 tracking-[0.2em] uppercase mb-4">
            {selectedChar.name}'s Relationships
          </h3>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {relationships
              .filter(r => r.character_id === selectedChar.id)
              .sort((a, b) => b.score - a.score)
              .map((rel, idx) => {
                const otherChar = characters.find(c => c.id === rel.character_id);
                if (!otherChar) return null;

                const scorePercent = ((rel.score + 100) / 200) * 100;
                return (
                  <motion.div
                    key={rel.character_id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.05 }}
                    className={`p-2.5 border ${getTierColor(rel.tier)}`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span className="font-mono text-[9px] tracking-wider uppercase truncate">
                        {otherChar.name}
                      </span>
                      <span className="font-mono text-[8px] text-current/60 flex-shrink-0">
                        {rel.tier}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="h-2 flex-1 border border-current/20 bg-black/60">
                        <div
                          className={`h-full transition-all ${getTierColor(rel.tier).split(' ')[2]}`}
                          style={{ width: `${scorePercent}%` }}
                        />
                      </div>
                      <span className="font-mono text-[8px] text-current/50 w-8 text-right flex-shrink-0">
                        {rel.score > 0 ? '+' : ''}{rel.score}
                      </span>
                    </div>
                    {rel.last_delta !== 0 && (
                      <div className="mt-1 text-[7px] font-mono text-current/40">
                        Last change: {rel.last_delta > 0 ? '+' : ''}{rel.last_delta} 
                        ({rel.total_interactions} interactions)
                      </div>
                    )}
                  </motion.div>
                );
              })}
          </div>
        </motion.div>
      )}

      {/* Emotion Timeline */}
      {emotions.length > 0 && (
        <div>
          <h3 className="font-mono text-xs text-primary/60 tracking-[0.2em] uppercase mb-4">
            Emotional States (Latest)
          </h3>
          <div className="space-y-2">
            {emotions
              .filter(e => activeChars.find(c => c.id === e.character_id))
              .slice(0, 5)
              .map((emotion, idx) => {
                const char = characters.find(c => c.id === emotion.character_id);
                return char ? (
                  <motion.div
                    key={emotion.character_id}
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.05 }}
                    className="p-2.5 border border-primary/15 bg-black/40"
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="font-mono text-[9px] tracking-wider uppercase">
                        {char.name}
                      </span>
                      <span className={`text-[9px] font-mono ${getEmotionColor(emotion.primary_emotion)}`}>
                        {emotion.primary_emotion}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 flex-1 border border-primary/20 bg-black/60">
                        <div
                          className="h-full bg-primary/60"
                          style={{ width: `${emotion.intensity}%` }}
                        />
                      </div>
                      <span className="text-[8px] font-mono text-primary/40 w-6 text-right flex-shrink-0">
                        {emotion.intensity}%
                      </span>
                    </div>
                    {emotion.trigger && (
                      <p className="text-[8px] font-mono text-primary/30 mt-1 line-clamp-1">
                        Trigger: {emotion.trigger}
                      </p>
                    )}
                  </motion.div>
                ) : null;
              })}
          </div>
        </div>
      )}
    </div>
  );
}