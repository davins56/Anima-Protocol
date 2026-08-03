import { motion, AnimatePresence } from 'framer-motion';
import { GitBranch, Loader, ArrowRight } from 'lucide-react';

export default function NarrativeDivergencePanel({
  paths = [],
  loading = false,
  onSelectPath,
  isVisible = false,
}) {
  if (!isVisible) return null;

  const arcColors = {
    tension: '#ff6b6b',
    discovery: '#74c0fc',
    resolution: '#51cf66',
    mystery: '#a78bfa',
    conflict: '#ffa94d',
    harmony: '#f783ac',
  };

  const difficultyEmoji = {
    high: '⚡',
    medium: '⭐',
    low: '✨',
  };

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          className="p-4 border border-purple-400/30 bg-purple-900/10 rounded-lg space-y-3"
        >
          {/* Header */}
          <div className="flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-purple-400" />
            <h3 className="font-mono text-[9px] text-purple-400/80 tracking-widest uppercase">
              {loading ? 'Generating paths...' : 'Story Divergence Points'}
            </h3>
          </div>

          {loading ? (
            <div className="flex items-center justify-center gap-2 py-4">
              <Loader className="w-4 h-4 animate-spin text-purple-400" />
              <p className="font-mono text-[9px] text-purple-400/60">Analyzing narrative threads...</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {paths.map((path) => (
                <motion.button
                  key={path.id}
                  onClick={() => onSelectPath(path)}
                  whileHover={{ scale: 1.02 }}
                  className="relative p-3 border border-purple-400/20 bg-black/40 hover:bg-purple-900/20 rounded transition-all text-left group"
                >
                  {/* Arc indicator */}
                  <div
                    className="absolute top-0 left-0 right-0 h-1 rounded-t"
                    style={{ backgroundColor: arcColors[path.emotional_arc] || '#868e96' }}
                  />

                  {/* Content */}
                  <div className="pt-1 space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-mono text-[9px] text-purple-400 font-semibold tracking-wider uppercase flex-1">
                        {path.title}
                      </p>
                      <span className="text-xs flex-shrink-0">
                        {difficultyEmoji[path.difficulty] || '✨'}
                      </span>
                    </div>

                    <p className="text-[8px] text-primary/70 leading-snug">
                      {path.description}
                    </p>

                    <div className="space-y-0.5">
                      <p className="text-[7px] font-mono text-purple-300/60 uppercase tracking-widest">
                        Arc: {path.emotional_arc}
                      </p>
                      <p className="text-[7px] text-primary/50">
                        {path.consequences}
                      </p>
                    </div>
                  </div>

                  {/* Hover indicator */}
                  <div className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <ArrowRight className="w-3 h-3 text-purple-400" />
                  </div>
                </motion.button>
              ))}
            </div>
          )}

          <p className="text-[7px] font-mono text-primary/40 tracking-widest uppercase text-center">
            Click a path to steer the narrative
          </p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}