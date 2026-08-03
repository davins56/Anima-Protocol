import { useState } from 'react';
import { BookOpen, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

/**
 * Subtle badge that appears when lore keyword is detected.
 * Clicking opens a popover with deeper historical context.
 */
export default function LoreKeywordBadge({ loreEntry, position = 'right' }) {
  const [isOpen, setIsOpen] = useState(false);

  if (!loreEntry) return null;

  const priorityColor = loreEntry.importance === 'critical'
    ? 'from-orange-600/20 to-orange-700/10 border-orange-500/40'
    : 'from-cyan-600/20 to-blue-700/10 border-blue-500/30';

  return (
    <div className="relative inline-block">
      {/* Subtle badge trigger */}
      <motion.button
        onClick={() => setIsOpen(!isOpen)}
        whileHover={{ scale: 1.08 }}
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[8px] font-mono tracking-widest uppercase transition-all ${priorityColor} text-cyan-300/80 hover:text-cyan-200 bg-gradient-to-r`}
        title={`Learn more: ${loreEntry.subject}`}
      >
        <BookOpen className="w-2.5 h-2.5" />
        <span className="hidden sm:inline">{loreEntry.keyword}</span>
      </motion.button>

      {/* Context Popover */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -10 }}
            transition={{ duration: 0.2 }}
            className={`absolute ${position === 'left' ? 'right-full mr-2' : 'left-full ml-2'} top-0 z-50 w-72 bg-black/95 border border-cyan-500/40 rounded-lg shadow-2xl overflow-hidden backdrop-blur-sm`}
          >
            {/* Header */}
            <div
              className="px-4 py-3 border-b border-cyan-500/20 bg-gradient-to-r from-cyan-900/20 to-blue-900/20"
              style={{ borderLeftColor: loreEntry.color_hex || '#60A5FA', borderLeftWidth: '3px' }}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <h3 className="font-mono text-sm text-cyan-300 tracking-wider uppercase">
                    {loreEntry.subject}
                  </h3>
                  <p className="text-[9px] text-cyan-400/60 mt-1 tracking-widest uppercase">
                    {loreEntry.category}
                  </p>
                </div>
                <button
                  onClick={() => setIsOpen(false)}
                  className="text-cyan-400/50 hover:text-cyan-300 transition-colors flex-shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="p-4 space-y-3">
              <p className="text-[10px] font-mono text-cyan-200/80 leading-relaxed">
                {loreEntry.fact}
              </p>

              {/* Importance indicator */}
              {loreEntry.importance === 'critical' && (
                <div className="px-3 py-2 bg-orange-500/10 border border-orange-500/30 rounded text-[9px] font-mono text-orange-300/80 tracking-widest uppercase">
                  ⚠️ Critical to understanding the Slipthk Continuum
                </div>
              )}

              {/* Subtle footer hint */}
              <p className="text-[8px] text-cyan-400/40 italic pt-1 tracking-widest">
                // Click to return to narrative
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}