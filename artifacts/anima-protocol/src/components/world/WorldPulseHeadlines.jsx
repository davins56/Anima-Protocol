import { useState, useEffect } from 'react';
import { Zap, TrendingDown, TrendingUp, AlertTriangle, Users } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { base44 } from '@/api/base44Client';

const IMPACT_COLORS = {
  major: 'border-red-400/50 bg-red-400/5 text-red-300',
  moderate: 'border-yellow-400/50 bg-yellow-400/5 text-yellow-300',
  minor: 'border-cyan-400/30 bg-cyan-400/5 text-cyan-300',
};

const CATEGORY_ICONS = {
  political: Users,
  emotional_climate: AlertTriangle,
  established_lore: Zap,
};

export default function WorldPulseHeadlines({
  sessionId,
  recentMessages,
  characterEmotions,
  relationships,
  loreEntries,
  isVisible = true,
}) {
  const [headlines, setHeadlines] = useState([]);
  const [worldState, setWorldState] = useState(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!sessionId || !recentMessages || recentMessages.length === 0) return;

    generateWorldPulse();
  }, [sessionId, recentMessages.length]);

  const generateWorldPulse = async () => {
    setLoading(true);
    try {
      const result = await base44.functions.invoke('aggregateWorldImpact', {
        session_id: sessionId,
        recent_messages: recentMessages.slice(-12),
        character_emotions: characterEmotions || {},
        relationships: relationships || {},
        lore_entries: loreEntries || [],
      });

      if (result?.data) {
        setHeadlines(result.data.headlines || []);
        setWorldState(result.data);
      }
    } catch (err) {
      console.error('World pulse generation failed:', err);
    } finally {
      setLoading(false);
    }
  };

  if (!isVisible || headlines.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="border border-primary/20 bg-black/30 rounded overflow-hidden"
    >
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-primary/5 transition-colors border-b border-primary/10"
      >
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-yellow-400" />
          <span className="font-mono text-[9px] text-primary/60 tracking-widest uppercase">
            World Pulse {headlines.length > 0 && `(${headlines.length})`}
          </span>
        </div>
        {worldState?.impact_summary?.world_stability && (
          <div className="flex items-center gap-2">
            <div className="text-[8px] font-mono">
              <span
                className={
                  worldState.impact_summary.world_stability.score > 70
                    ? 'text-green-400'
                    : worldState.impact_summary.world_stability.score > 40
                    ? 'text-yellow-400'
                    : 'text-red-400'
                }
              >
                {worldState.impact_summary.world_stability.status.toUpperCase()}
              </span>
            </div>
          </div>
        )}
      </button>

      {/* Headlines & State */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="p-4 space-y-3 max-h-96 overflow-y-auto"
          >
            {loading ? (
              <div className="text-center py-4 font-mono text-[9px] text-primary/40 animate-pulse">
                Aggregating world impact...
              </div>
            ) : (
              <>
                {/* Headlines */}
                <div className="space-y-2">
                  {headlines.map((headline, idx) => (
                    <motion.div
                      key={idx}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: idx * 0.05 }}
                      className={`p-2.5 border rounded text-[9px] font-mono ${
                        IMPACT_COLORS[headline.impact_level] ||
                        'border-primary/20 bg-black/40 text-primary/70'
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <Zap className="w-3 h-3 flex-shrink-0 mt-0.5" />
                        <div className="flex-1">
                          <p className="leading-relaxed">{headline.text}</p>
                          <div className="text-[8px] text-primary/40 mt-1 tracking-widest">
                            {headline.source_character} · {headline.affected_count} ripple effects
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>

                {/* World State Changes */}
                {worldState?.world_state_changes?.length > 0 && (
                  <div className="pt-3 border-t border-primary/10 space-y-2">
                    <p className="text-[8px] font-mono text-primary/40 tracking-widest uppercase">
                      Global Shifts
                    </p>
                    {worldState.world_state_changes.map((change, idx) => {
                      const Icon = CATEGORY_ICONS[change.category] || Zap;
                      return (
                        <div
                          key={idx}
                          className="flex items-start gap-2 p-2 bg-primary/5 border border-primary/10 rounded text-[8px]"
                        >
                          <Icon className="w-3 h-3 text-primary/50 flex-shrink-0 mt-0.5" />
                          <div className="flex-1">
                            <p className="text-primary/70 font-mono">{change.description}</p>
                            <div className="w-full h-1 bg-black/60 rounded-full mt-1 overflow-hidden">
                              <motion.div
                                initial={{ width: 0 }}
                                animate={{
                                  width: `${Math.min(
                                    100,
                                    (change.intensity / 10) * 100
                                  )}%`,
                                }}
                                transition={{ duration: 0.6 }}
                                className="h-full bg-gradient-to-r from-primary to-cyan-400"
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Affected Entities */}
                {worldState?.affected_entities?.length > 0 && (
                  <div className="pt-3 border-t border-primary/10 space-y-2">
                    <p className="text-[8px] font-mono text-primary/40 tracking-widest uppercase">
                      Most Impacted
                    </p>
                    <div className="space-y-1">
                      {worldState.affected_entities.slice(0, 4).map((entity, idx) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between text-[8px] px-2 py-1 bg-black/40 rounded"
                        >
                          <span className="text-primary/70 font-mono">{entity.name}</span>
                          <div className="flex items-center gap-2">
                            <div className="w-16 h-1 bg-primary/20 rounded-full overflow-hidden">
                              <motion.div
                                initial={{ width: 0 }}
                                animate={{
                                  width: `${Math.min(
                                    100,
                                    (entity.intensity / 30) * 100
                                  )}%`,
                                }}
                                transition={{ duration: 0.5 }}
                                className="h-full bg-primary/60"
                              />
                            </div>
                            <span className="text-primary/50 w-6 text-right">
                              {entity.effects}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Summary Stats */}
                {worldState?.impact_summary && (
                  <div className="pt-3 border-t border-primary/10 grid grid-cols-2 gap-2 text-[8px]">
                    <div className="p-2 bg-primary/5 border border-primary/10 rounded">
                      <p className="text-primary/40 tracking-widest uppercase mb-1">
                        Total Decisions
                      </p>
                      <p className="text-primary/80 font-mono text-sm">
                        {worldState.impact_summary.total_decisions}
                      </p>
                    </div>
                    <div className="p-2 bg-primary/5 border border-primary/10 rounded">
                      <p className="text-primary/40 tracking-widest uppercase mb-1">
                        Ripple Effects
                      </p>
                      <p className="text-primary/80 font-mono text-sm">
                        {worldState.impact_summary.total_ripple_effects}
                      </p>
                    </div>
                    <div className="p-2 bg-primary/5 border border-primary/10 rounded col-span-2">
                      <p className="text-primary/40 tracking-widest uppercase mb-1">
                        Entities Affected
                      </p>
                      <p className="text-primary/80 font-mono">
                        {worldState.impact_summary.entities_affected}
                      </p>
                    </div>
                  </div>
                )}
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}