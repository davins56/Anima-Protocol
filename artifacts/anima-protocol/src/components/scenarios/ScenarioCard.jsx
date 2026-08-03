import { Star, Repeat2, Play } from 'lucide-react';
import { motion } from 'framer-motion';

export default function ScenarioCard({ scenario, onRemix, onPlay }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="border border-primary/20 bg-black/40 rounded overflow-hidden hover:border-primary/40 transition-all group"
    >
      {/* Header */}
      <div className="p-4 sm:p-5 border-b border-primary/10 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <h3 className="font-mono text-sm sm:text-base text-primary font-semibold truncate">
              {scenario.title}
            </h3>
            {scenario.creator && (
              <p className="text-[9px] font-mono text-primary/40 mt-1">
                by {scenario.created_by?.split('@')[0] || 'Creator'}
              </p>
            )}
          </div>
          {scenario.difficulty && (
            <span className="text-[8px] font-mono px-2 py-1 bg-primary/10 border border-primary/20 text-primary/60 rounded whitespace-nowrap">
              {scenario.difficulty}
            </span>
          )}
        </div>
        <p className="text-[10px] sm:text-xs text-primary/70 line-clamp-2">
          {scenario.description}
        </p>
      </div>

      {/* Tags */}
      {scenario.tags?.length > 0 && (
        <div className="px-4 py-2 border-b border-primary/10 flex flex-wrap gap-1">
          {scenario.tags.slice(0, 4).map(tag => (
            <span
              key={tag}
              className="text-[8px] font-mono px-2 py-0.5 bg-primary/5 border border-primary/15 text-primary/50 rounded"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Stats */}
      <div className="px-4 py-3 border-b border-primary/10 grid grid-cols-3 gap-2 text-[9px] font-mono">
        <div>
          <p className="text-primary/40 tracking-widest uppercase">Rating</p>
          <p className="text-primary flex items-center gap-1 mt-0.5">
            <Star className="w-3 h-3 fill-primary" />
            {scenario.rating || 0}
          </p>
        </div>
        <div>
          <p className="text-primary/40 tracking-widest uppercase">Plays</p>
          <p className="text-primary mt-0.5">{scenario.play_count || 0}</p>
        </div>
        <div>
          <p className="text-primary/40 tracking-widest uppercase">Remixes</p>
          <p className="text-cyan-400 flex items-center gap-1 mt-0.5">
            <Repeat2 className="w-3 h-3" />
            {scenario.remix_count || 0}
          </p>
        </div>
      </div>

      {/* Meta */}
      {scenario.estimated_duration && (
        <div className="px-4 py-2 border-b border-primary/10 text-[9px] font-mono text-primary/50">
          ~{scenario.estimated_duration}
        </div>
      )}

      {/* Actions */}
      <div className="p-3 sm:p-4 flex gap-2">
        <button
          onClick={() => onRemix(scenario)}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 font-mono text-[9px] tracking-widest uppercase transition-all"
        >
          <Repeat2 className="w-3 h-3" />
          Remix
        </button>
        {onPlay && (
          <button
            onClick={() => onPlay(scenario)}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-cyan-600/20 border border-cyan-400/40 text-cyan-400 hover:bg-cyan-600/30 font-mono text-[9px] tracking-widest uppercase transition-all"
          >
            <Play className="w-3 h-3" />
            Preview
          </button>
        )}
      </div>
    </motion.div>
  );
}