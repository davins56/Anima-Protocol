import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { BookOpen, Loader } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export default function CrossSessionLorePanel({
  sessionId,
  characterId,
  visible = true,
}) {
  const [loreConnections, setLoreConnections] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!sessionId || !visible) return;
    loadCrossSessionLore();
  }, [sessionId, visible]);

  const loadCrossSessionLore = async () => {
    setLoading(true);
    try {
      // Find wiki entries mentioned in this session
      const entries = await base44.entities.WikiCodex.filter({
        session_ids: { $elemMatch: sessionId },
      }, '-mention_count', 50);

      if (entries?.length > 0) {
        // Find entries that exist in multiple sessions (cross-session references)
        const crossSessionEntries = entries.filter(
          e => e.session_ids?.length > 1 || (e.mention_count && e.mention_count > 3)
        );
        
        setLoreConnections(crossSessionEntries.slice(0, 8));
      }
    } catch (err) {
      console.error('Error loading cross-session lore:', err);
    } finally {
      setLoading(false);
    }
  };

  if (!visible) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-3 border border-cyan-400/20 bg-cyan-900/10 rounded-lg space-y-2"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-cyan-400/60" />
          <p className="font-mono text-[8px] text-cyan-400/60 tracking-widest uppercase">
            Cross-Session Lore
          </p>
        </div>
        {loreConnections.length > 0 && (
          <span className="text-[7px] font-mono text-cyan-400/40">{loreConnections.length} entries</span>
        )}
      </div>

      <div className="space-y-1 max-h-32 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-3">
            <Loader className="w-3 h-3 text-cyan-400/40 animate-spin" />
          </div>
        ) : loreConnections.length > 0 ? (
          <AnimatePresence>
            {loreConnections.map((entry, idx) => (
              <motion.div
                key={entry.id}
                initial={{ opacity: 0, x: -5 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.05 }}
                className="p-2 bg-cyan-900/20 border border-cyan-400/10 rounded text-[8px]"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-mono text-cyan-400 font-semibold truncate">{entry.name}</p>
                    <p className="text-cyan-400/50 text-[7px] mt-0.5 line-clamp-2">
                      {entry.summary}
                    </p>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <p className="text-cyan-400/60 text-[7px] font-mono">
                      {entry.session_ids?.length || 1} sessions
                    </p>
                    <p className="text-cyan-400/40 text-[7px]">
                      {entry.mention_count || 1} mentions
                    </p>
                  </div>
                </div>
                {entry.related_entries?.length > 0 && (
                  <div className="mt-1.5 pt-1.5 border-t border-cyan-400/10">
                    <p className="text-cyan-400/50 text-[7px] font-mono mb-0.5">Related:</p>
                    <div className="flex flex-wrap gap-0.5">
                      {entry.related_entries.slice(0, 3).map((name, i) => (
                        <span key={i} className="text-[6px] px-1 py-0.5 bg-cyan-400/10 text-cyan-400/60 rounded">
                          {name}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
        ) : (
          <p className="text-[7px] text-cyan-400/40 italic py-2">
            Cross-session lore will appear as you progress
          </p>
        )}
      </div>
    </motion.div>
  );
}