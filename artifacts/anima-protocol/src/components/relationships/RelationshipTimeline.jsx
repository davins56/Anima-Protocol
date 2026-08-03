import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { motion, AnimatePresence } from "framer-motion";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

export default function RelationshipTimeline({ sessionId, characterId }) {
  const [relationships, setRelationships] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedCharacterId, setSelectedCharacterId] = useState(null);

  useEffect(() => {
    if (!sessionId || !characterId) return;
    loadRelationshipHistory();
  }, [sessionId, characterId]);

  const loadRelationshipHistory = async () => {
    try {
      // Load all relationships for this character
      const data = await base44.entities.CharacterRelationship.filter(
        {
          session_id: sessionId,
          character_a_id: characterId,
        },
        "-created_date",
        50
      );
      setRelationships(data || []);
    } catch (err) {
      console.error("Error loading relationship history:", err);
    } finally {
      setLoading(false);
    }
  };

  const getTrendIcon = (change) => {
    if (change > 0) return <TrendingUp className="w-3 h-3 text-green-400" />;
    if (change < 0) return <TrendingDown className="w-3 h-3 text-red-400" />;
    return <Minus className="w-3 h-3 text-primary/40" />;
  };

  const getTrendColor = (change) => {
    if (change > 0) return "text-green-400";
    if (change < 0) return "text-red-400";
    return "text-primary/40";
  };

  if (loading) {
    return (
      <div className="p-4 text-center">
        <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase animate-pulse">
          Loading...
        </p>
      </div>
    );
  }

  if (relationships.length === 0) {
    return (
      <div className="p-4 text-center border border-primary/15 bg-black/30 rounded">
        <p className="font-mono text-[8px] text-primary/20">No relationship history</p>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-3"
    >
      {/* Timeline Header */}
      <div className="px-3 py-2 border border-primary/20 bg-primary/5 rounded">
        <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase">
          📊 Relationship Evolution ({relationships.length})
        </p>
      </div>

      {/* Timeline */}
      <div className="space-y-2">
        {relationships.map((rel, idx) => {
          const otherCharacterId = rel.character_b_id;
          const isExpanded = selectedCharacterId === otherCharacterId;
          const latestHistory = rel.score_history?.[rel.score_history.length - 1];
          const recentChange = latestHistory?.delta || 0;

          return (
            <motion.div
              key={rel.id}
              layout
              className={`border rounded overflow-hidden transition-all ${
                isExpanded
                  ? "border-primary/40 bg-primary/10"
                  : "border-primary/15 bg-black/40 hover:border-primary/25"
              }`}
            >
              {/* Timeline Item */}
              <button
                onClick={() => setSelectedCharacterId(isExpanded ? null : otherCharacterId)}
                className="w-full px-3 py-2 text-left hover:bg-primary/5 transition-colors"
              >
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div className="flex-1 min-w-0">
                    <p className="font-mono text-[9px] text-primary/80 truncate uppercase tracking-wider">
                      {rel.character_b_name || `Character ${otherCharacterId.slice(0, 8)}`}
                    </p>
                    <p className="text-[8px] text-primary/40 truncate">
                      {rel.relationship_arc || "Evolving"}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    {getTrendIcon(recentChange)}
                    <div className="text-right">
                      <p className="font-mono text-[9px] text-primary/70">{rel.score}/100</p>
                      <p className={`text-[8px] font-mono ${getTrendColor(recentChange)}`}>
                        {recentChange > 0 ? "+" : ""}{recentChange}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Score Bar */}
                <div className="h-1.5 bg-black/60 rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${(rel.score + 100) / 2}%` }}
                    className="h-full bg-gradient-to-r from-red-400 via-yellow-400 to-green-400"
                  />
                </div>
              </button>

              {/* Expanded Details */}
              <AnimatePresence>
                {isExpanded && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="border-t border-primary/10 bg-black/80 px-3 py-2 space-y-2"
                  >
                    {/* Relationship Status */}
                    <div className="grid grid-cols-2 gap-2 text-[8px] font-mono">
                      <div>
                        <p className="text-primary/40 tracking-widest uppercase mb-0.5">Tier</p>
                        <p className="text-primary/70 capitalize">{rel.tier}</p>
                      </div>
                      <div>
                        <p className="text-primary/40 tracking-widest uppercase mb-0.5">Arc</p>
                        <p className="text-primary/70 capitalize">{rel.relationship_arc || "—"}</p>
                      </div>
                      <div>
                        <p className="text-primary/40 tracking-widest uppercase mb-0.5">Interactions</p>
                        <p className="text-primary/70">{rel.interaction_count || 0}</p>
                      </div>
                      <div>
                        <p className="text-primary/40 tracking-widest uppercase mb-0.5">Trust</p>
                        <p className="text-primary/70">{Math.round((rel.trust_level || 0) * 100)}%</p>
                      </div>
                    </div>

                    {/* Score History Timeline */}
                    {rel.score_history && rel.score_history.length > 0 && (
                      <div className="pt-2 border-t border-primary/10">
                        <p className="text-[8px] font-mono text-primary/40 tracking-widest uppercase mb-2">
                          Recent Events
                        </p>
                        <div className="space-y-1 max-h-32 overflow-y-auto">
                          {rel.score_history.slice(-8).reverse().map((entry, idx) => (
                            <div key={idx} className="flex items-start gap-2 text-[8px] font-mono">
                              <div className="flex-shrink-0 mt-0.5">
                                {getTrendIcon(entry.delta)}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-primary/70 truncate">
                                  {entry.catalyst || "Interaction"}
                                </p>
                                <p className={`text-[7px] ${getTrendColor(entry.delta)}`}>
                                  Score: {entry.score} ({entry.delta > 0 ? "+" : ""}{entry.delta})
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Recurring Themes */}
                    {rel.recurring_themes && rel.recurring_themes.length > 0 && (
                      <div className="pt-2 border-t border-primary/10">
                        <p className="text-[8px] font-mono text-primary/40 tracking-widest uppercase mb-1">
                          Patterns
                        </p>
                        <div className="flex flex-wrap gap-1">
                          {rel.recurring_themes.slice(0, 4).map((theme, idx) => (
                            <span
                              key={idx}
                              className="px-1.5 py-0.5 bg-primary/10 border border-primary/20 rounded text-[7px] font-mono text-primary/60"
                            >
                              {theme}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Key Turning Points */}
                    {rel.key_turning_points && rel.key_turning_points.length > 0 && (
                      <div className="pt-2 border-t border-primary/10">
                        <p className="text-[8px] font-mono text-primary/40 tracking-widest uppercase mb-1">
                          Turning Points
                        </p>
                        <div className="space-y-0.5 text-[8px]">
                          {rel.key_turning_points.slice(0, 3).map((point, idx) => (
                            <div key={idx} className="p-1.5 bg-black/60 border border-primary/15 rounded">
                              <p className="font-mono text-primary/70">{point.description}</p>
                              <p className="text-[7px] text-primary/40 mt-0.5">
                                Impact: {point.impact > 0 ? "+" : ""}{point.impact}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </div>

      {/* Summary */}
      <div className="p-2 border border-primary/10 bg-black/30 rounded text-[8px] font-mono text-primary/50">
        <p>
          🔗 {relationships.filter(r => r.tier === "close" || r.tier === "devoted").length} close •{" "}
          {relationships.filter(r => r.tier === "neutral").length} neutral •{" "}
          {relationships.filter(r => r.tier === "hostile" || r.tier === "cold").length} distant
        </p>
      </div>
    </motion.div>
  );
}