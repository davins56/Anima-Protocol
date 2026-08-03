import { useState } from 'react';
import { Search, Brain, Zap, TrendingUp } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const MEMORY_TYPE_COLORS = {
  narrative_event: 'text-blue-400',
  relationship_dynamic: 'text-pink-400',
  character_interaction: 'text-purple-400',
  emotional_moment: 'text-yellow-400',
  conflict: 'text-red-400',
  resolution: 'text-green-400',
  growth: 'text-cyan-400',
};

export default function VectorMemorySearch({ onSearch, results, loading }) {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (query.trim()) {
      await onSearch(query);
      setExpanded(true);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="border border-primary/20 bg-black/30 rounded overflow-hidden"
    >
      {/* Search Header */}
      <form onSubmit={handleSubmit} className="p-3 border-b border-primary/10">
        <div className="flex items-center gap-2">
          <Brain className="w-4 h-4 text-primary/50" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search memories... (e.g., 'when we first met', 'that conflict')"
            className="flex-1 bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-[9px] px-2 py-1.5 focus:outline-none focus:border-primary/50 transition-colors"
          />
          <button
            type="submit"
            disabled={loading || !query.trim()}
            className="p-1.5 bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 disabled:opacity-50 transition-all"
          >
            <Search className="w-3.5 h-3.5" />
          </button>
        </div>
      </form>

      {/* Results */}
      <AnimatePresence>
        {(results.length > 0 || loading) && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="max-h-96 overflow-y-auto p-3 space-y-2"
          >
            {loading ? (
              <div className="text-center py-4 font-mono text-[9px] text-primary/40 tracking-widest uppercase animate-pulse">
                Searching memories...
              </div>
            ) : results.length === 0 ? (
              <div className="text-center py-4 font-mono text-[9px] text-primary/30 tracking-widest uppercase">
                No memories match this search
              </div>
            ) : (
              results.map((memory) => (
                <motion.div
                  key={memory.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="p-2.5 border border-primary/15 bg-black/40 rounded hover:border-primary/30 transition-colors space-y-1.5"
                >
                  {/* Header */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-[8px] font-mono tracking-widest uppercase ${
                            MEMORY_TYPE_COLORS[memory.memory_type] || 'text-primary/50'
                          }`}
                        >
                          {memory.memory_type.replace(/_/g, ' ')}
                        </span>
                        <Zap className="w-2.5 h-2.5 text-primary/40" />
                      </div>
                      <p className="font-mono text-[9px] text-primary/80 tracking-wider uppercase mt-0.5 line-clamp-1">
                        {memory.title}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-[8px] font-mono text-primary/50">
                        {(memory.similarity_score * 100).toFixed(0)}%
                      </div>
                      <div className="text-[7px] font-mono text-primary/30">
                        ({memory.recall_count} recalls)
                      </div>
                    </div>
                  </div>

                  {/* Content preview */}
                  <p className="text-[8px] font-mono text-primary/60 leading-relaxed line-clamp-2">
                    {memory.content}
                  </p>

                  {/* Metadata */}
                  <div className="flex items-center justify-between pt-1.5 border-t border-primary/5">
                    <div className="flex items-center gap-2">
                      {memory.emotional_signature?.primary_emotion && (
                        <span className="text-[7px] px-1 py-0.5 bg-primary/10 text-primary/60 rounded">
                          {memory.emotional_signature.primary_emotion} ({memory.emotional_signature.intensity}/10)
                        </span>
                      )}
                      {memory.narrative_significance > 0.7 && (
                        <TrendingUp className="w-2.5 h-2.5 text-yellow-400" />
                      )}
                    </div>
                    {memory.related_characters?.length > 0 && (
                      <span className="text-[7px] font-mono text-primary/40">
                        {memory.related_characters.length} character(s)
                      </span>
                    )}
                  </div>

                  {/* Related memories */}
                  {memory.similarity_matches?.length > 0 && (
                    <div className="text-[7px] font-mono text-primary/40 pt-1">
                      Related: {memory.similarity_matches.length} similar memories
                    </div>
                  )}
                </motion.div>
              ))
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}