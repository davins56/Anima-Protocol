import { useEffect, useState } from 'react';
import { BookOpen, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { base44 } from '@/api/base44Client';

export default function InventoryNarrativePanel({ characterId, sessionId, recentMessages }) {
  const [narrativeChoices, setNarrativeChoices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!characterId || !sessionId) return;

    const generateNarrative = async () => {
      setLoading(true);
      try {
        const result = await base44.functions.invoke('inventoryNarrativeImpact', {
          character_id: characterId,
          session_id: sessionId,
          recent_messages: recentMessages?.slice(-5) || [],
        });
        setNarrativeChoices(result.data?.narrative_choices || []);
      } catch (err) {
        console.error('Narrative generation failed:', err);
      } finally {
        setLoading(false);
      }
    };

    // Only generate if we have recent messages
    if (recentMessages?.length > 0) {
      generateNarrative();
    }
  }, [characterId, sessionId, recentMessages]);

  if (narrativeChoices.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-3 border border-cyan-400/20 bg-cyan-900/10 rounded space-y-2"
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between cursor-pointer hover:opacity-80 transition-opacity"
      >
        <div className="flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-cyan-400" />
          <span className="font-mono text-[9px] text-cyan-400 tracking-widest uppercase">
            Item-Driven Choices ({narrativeChoices.length})
          </span>
        </div>
        <span className={`text-cyan-400/50 transition-transform ${expanded ? 'rotate-180' : ''}`}>▼</span>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="space-y-2"
          >
            {narrativeChoices.map((choice, idx) => (
              <div
                key={idx}
                className="p-2 border border-cyan-400/30 bg-black/40 rounded space-y-1"
              >
                <div className="flex items-start gap-1.5">
                  <Sparkles className="w-3 h-3 text-cyan-400 flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[8px] font-mono text-cyan-300 font-semibold">{choice.title}</p>
                    <p className="text-[7px] font-mono text-cyan-400/70 leading-relaxed mt-0.5">
                      {choice.description}
                    </p>
                    {choice.item_requirement && (
                      <p className="text-[7px] font-mono text-yellow-400/70 mt-1">
                        Requires: {choice.item_requirement}
                      </p>
                    )}
                    {choice.stat_bonus && (
                      <p className="text-[7px] font-mono text-green-400/70 mt-1">
                        Bonus: {choice.stat_bonus}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}