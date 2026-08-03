// @ts-check
import { motion, AnimatePresence } from 'framer-motion';
import { Zap, Plus } from 'lucide-react';

/** @type {Record<string, string>} */
const typeIcons = {
  character: '👤',
  location: '📍',
  event: '⚡',
  item: '🎁',
  faction: '🏛️',
  concept: '💡',
  creature: '🐉',
  lore: '📜',
};

/**
 * @param {{ entities?: any[], isExtracting?: boolean, onAddToWiki?: (entity: any) => void }} props
 */
export default function AutoDetectedEntities({
  entities = [],
  isExtracting = false,
  onAddToWiki,
}) {
  if (entities.length === 0 && !isExtracting) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="p-3 border border-yellow-400/20 bg-yellow-900/10 rounded-lg space-y-2"
    >
      <div className="flex items-center gap-2">
        <Zap className="w-4 h-4 text-yellow-400 animate-pulse" />
        <p className="font-mono text-[8px] text-yellow-400 tracking-widest uppercase">
          Auto-detected entities
        </p>
      </div>

      <AnimatePresence>
        {entities.map((/** @type {any} */ entity, /** @type {number} */ idx) => (
          <motion.div
            key={`${entity.name}-${idx}`}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -10 }}
            className="flex items-center justify-between gap-2 p-2 bg-black/40 border border-yellow-400/15 rounded"
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-sm flex-shrink-0">{typeIcons[entity.entry_type]}</span>
              <div className="min-w-0">
                <p className="font-mono text-[8px] text-yellow-400 font-semibold truncate">
                  {entity.name}
                </p>
                {entity.summary && (
                  <p className="text-[7px] text-yellow-400/60 truncate">{entity.summary}</p>
                )}
              </div>
            </div>
            <button
              onClick={() => onAddToWiki?.(entity)}
              className="flex-shrink-0 px-2 py-1 bg-yellow-600/30 border border-yellow-400/40 text-yellow-400/80 hover:text-yellow-400 hover:bg-yellow-600/50 font-mono text-[7px] tracking-widest uppercase transition-all"
            >
              <Plus className="w-3 h-3" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>

      {isExtracting && (
        <p className="text-[7px] font-mono text-yellow-400/50 italic">
          ⚡ Scanning dialogue...
        </p>
      )}
    </motion.div>
  );
}