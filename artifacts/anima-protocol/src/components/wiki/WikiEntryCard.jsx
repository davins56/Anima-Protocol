import { useState } from 'react';
import { Edit2, Trash2, ChevronDown, Zap } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const entryTypeColors = {
  character: 'border-cyan-400/30 bg-cyan-900/10',
  location: 'border-green-400/30 bg-green-900/10',
  event: 'border-yellow-400/30 bg-yellow-900/10',
  item: 'border-purple-400/30 bg-purple-900/10',
  faction: 'border-orange-400/30 bg-orange-900/10',
  concept: 'border-pink-400/30 bg-pink-900/10',
  creature: 'border-red-400/30 bg-red-900/10',
  lore: 'border-primary/30 bg-primary/5',
};

const entryTypeIcons = {
  character: '👤',
  location: '📍',
  event: '⚡',
  item: '🎁',
  faction: '🏛️',
  concept: '💡',
  creature: '🐉',
  lore: '📜',
};

export default function WikiEntryCard({
  entry,
  onEdit,
  onDelete,
  isNew = false,
}) {
  const [expanded, setExpanded] = useState(isNew);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`border rounded-lg overflow-hidden transition-all ${entryTypeColors[entry.entry_type] || entryTypeColors.lore}`}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-3 text-left hover:opacity-80 transition-opacity"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-lg">{entryTypeIcons[entry.entry_type]}</span>
              <p className="font-mono text-[9px] text-primary font-semibold tracking-wider uppercase truncate">
                {entry.name}
              </p>
            </div>
            {entry.summary && (
              <p className="text-[8px] text-primary/60 mt-1.5 line-clamp-2">{entry.summary}</p>
            )}
            {entry.tags?.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {entry.tags.slice(0, 3).map((tag, idx) => (
                  <span key={idx} className="text-[7px] font-mono px-1 py-0.5 bg-primary/10 border border-primary/20 text-primary/60 rounded">
                    {tag}
                  </span>
                ))}
                {entry.tags.length > 3 && (
                  <span className="text-[7px] text-primary/40">+{entry.tags.length - 3} more</span>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {isNew && <Zap className="w-3 h-3 text-yellow-400" />}
            <ChevronDown className={`w-4 h-4 text-primary/40 transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </div>
        </div>
      </button>

      {/* Expanded Details */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="border-t border-primary/10 bg-black/40 p-3 space-y-2"
          >
            {/* Summary */}
            {entry.summary && (
              <div className="space-y-1">
                <p className="text-[8px] font-mono text-primary/50 tracking-widest uppercase">Summary</p>
                <p className="text-[8px] text-primary/70 leading-relaxed">{entry.summary}</p>
              </div>
            )}

            {/* Metadata */}
            <div className="grid grid-cols-2 gap-2 text-[8px] pt-1 border-t border-primary/10">
              {entry.entry_type && (
                <div>
                  <span className="text-primary/40">Type:</span>
                  <p className="text-primary/70 font-mono">{entry.entry_type}</p>
                </div>
              )}
              {entry.mention_count && (
                <div>
                  <span className="text-primary/40">Mentions:</span>
                  <p className="text-primary/70 font-mono">{entry.mention_count}</p>
                </div>
              )}
              {entry.importance && (
                <div>
                  <span className="text-primary/40">Importance:</span>
                  <p className="text-primary/70 font-mono uppercase">{entry.importance}</p>
                </div>
              )}
            </div>

            {/* Facts */}
            {entry.lore_facts?.length > 0 && (
              <div className="space-y-1 pt-1 border-t border-primary/10">
                <p className="text-[8px] font-mono text-primary/50 tracking-widest uppercase">Known Facts</p>
                <ul className="space-y-0.5">
                  {entry.lore_facts.slice(0, 3).map((fact, idx) => (
                    <li key={idx} className="text-[7px] text-primary/60">• {fact}</li>
                  ))}
                  {entry.lore_facts.length > 3 && (
                    <li className="text-[7px] text-primary/40">+ {entry.lore_facts.length - 3} more facts</li>
                  )}
                </ul>
              </div>
            )}

            {/* Related Entries */}
            {entry.related_entries?.length > 0 && (
              <div className="space-y-1 pt-1 border-t border-primary/10">
                <p className="text-[8px] font-mono text-primary/50 tracking-widest uppercase">Related</p>
                <div className="flex flex-wrap gap-1">
                  {entry.related_entries.slice(0, 4).map((name, idx) => (
                    <span key={idx} className="text-[7px] px-1.5 py-0.5 bg-primary/10 border border-primary/20 rounded text-primary/70">
                      {name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-1.5 pt-2 border-t border-primary/10">
              <button
                onClick={() => onEdit?.(entry)}
                className="flex-1 flex items-center justify-center gap-1 px-2 py-1 bg-primary/10 border border-primary/30 text-primary/70 hover:text-primary hover:bg-primary/20 font-mono text-[8px] tracking-widest uppercase transition-all"
              >
                <Edit2 className="w-3 h-3" />
                Edit
              </button>
              {onDelete && (
                <button
                  onClick={() => onDelete?.(entry.id)}
                  className="px-2 py-1 border border-red-400/30 text-red-400/60 hover:text-red-400 hover:border-red-400/60 font-mono text-[8px] tracking-widest uppercase transition-all"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}