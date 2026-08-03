import { useState, useEffect } from 'react';
import { ChevronDown, Heart, TrendingUp, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export default function RelationshipTimeline({ characterBId, relationshipData, loading }) {
  const [expanded, setExpanded] = useState(false);

  if (!relationshipData) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="border border-primary/20 bg-black/30 rounded p-3"
      >
        <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase">
          No relationship history
        </p>
      </motion.div>
    );
  }

  const { metadata, narrative } = relationshipData;
  const scorePercentage = ((metadata.current_score + 100) / 200) * 100;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="border border-primary/20 bg-black/30 rounded overflow-hidden"
    >
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-primary/5 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Heart className="w-4 h-4 text-pink-400" />
          <span className="font-mono text-[9px] text-primary/60 tracking-widest uppercase">
            Relationship Arc
          </span>
        </div>
        <ChevronDown
          className={`w-4 h-4 text-primary/40 transition-transform ${expanded ? 'rotate-180' : ''}`}
        />
      </button>

      {/* Content */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="border-t border-primary/10 p-4 space-y-3 max-h-96 overflow-y-auto"
          >
            {loading ? (
              <div className="text-center py-4 font-mono text-[9px] text-primary/40 animate-pulse">
                Loading relationship data...
              </div>
            ) : (
              <>
                {/* Score Bar */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[8px] font-mono text-primary/60 tracking-widest uppercase">
                      Current Bond
                    </span>
                    <span className="text-[8px] font-mono text-primary/80">
                      {metadata.current_score}/100
                    </span>
                  </div>
                  <div className="w-full h-2 bg-black/60 border border-primary/15 rounded overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${scorePercentage}%` }}
                      transition={{ duration: 0.8, ease: 'easeOut' }}
                      className={`h-full ${
                        metadata.current_score > 50
                          ? 'bg-gradient-to-r from-green-500 to-cyan-400'
                          : metadata.current_score > 0
                          ? 'bg-gradient-to-r from-yellow-500 to-orange-400'
                          : 'bg-gradient-to-r from-red-500 to-pink-400'
                      }`}
                    />
                  </div>
                </div>

                {/* Arc & Trust */}
                <div className="grid grid-cols-2 gap-2 text-[8px]">
                  <div className="p-2 bg-primary/5 border border-primary/10 rounded">
                    <p className="text-primary/50 tracking-widest uppercase mb-0.5">Arc</p>
                    <p className="text-primary/80 font-mono capitalize">{metadata.arc}</p>
                  </div>
                  <div className="p-2 bg-primary/5 border border-primary/10 rounded">
                    <p className="text-primary/50 tracking-widest uppercase mb-0.5">Trust</p>
                    <p className="text-primary/80 font-mono">
                      {(metadata.trust_level * 100).toFixed(0)}%
                    </p>
                  </div>
                </div>

                {/* Themes */}
                {metadata.themes?.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-[8px] font-mono text-primary/50 tracking-widest uppercase">
                      Recurring Patterns
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {metadata.themes.slice(0, 4).map((theme, idx) => (
                        <span
                          key={idx}
                          className="px-1.5 py-0.5 text-[7px] bg-primary/10 border border-primary/20 text-primary/60 rounded font-mono uppercase tracking-wider"
                        >
                          {theme.replace(/-/g, ' ')}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Turning Points */}
                {metadata.turning_points_count > 0 && (
                  <div className="space-y-1">
                    <p className="text-[8px] font-mono text-primary/50 tracking-widest uppercase">
                      Pivotal Moments ({metadata.turning_points_count})
                    </p>
                    <div className="space-y-1 max-h-24 overflow-y-auto">
                      <span className="text-[8px] text-primary/60">
                        Major shifts have shaped this bond
                      </span>
                    </div>
                  </div>
                )}

                {/* Narrative Summary */}
                {narrative && (
                  <div className="pt-2 border-t border-primary/10 space-y-1">
                    <p className="text-[8px] font-mono text-primary/50 tracking-widest uppercase">
                      Emotional Reality
                    </p>
                    <p className="text-[8px] font-mono text-primary/70 leading-relaxed">
                      {narrative.substring(0, 200)}...
                    </p>
                  </div>
                )}

                {/* Interactions */}
                <div className="flex items-center justify-between text-[8px]">
                  <span className="text-primary/50 font-mono tracking-widest uppercase">
                    Sessions Together
                  </span>
                  <span className="text-primary/80 font-mono">{metadata.interaction_count}</span>
                </div>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}