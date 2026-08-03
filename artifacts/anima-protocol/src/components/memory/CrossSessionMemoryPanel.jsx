import { useState, useEffect } from 'react';
import { ChevronDown, Brain, Heart, Zap, BookOpen } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { base44 } from '@/api/base44Client';

const MEMORY_TYPE_ICONS = {
  relationship_milestone: { icon: Heart, color: 'text-pink-400', label: 'Relationship' },
  shared_event: { icon: BookOpen, color: 'text-blue-400', label: 'Shared Events' },
  character_development: { icon: Brain, color: 'text-purple-400', label: 'Growth' },
  interaction_pattern: { icon: Zap, color: 'text-yellow-400', label: 'Patterns' },
  personal_growth: { icon: Heart, color: 'text-green-400', label: 'Personal' },
  conflict_resolution: { icon: Zap, color: 'text-red-400', label: 'Conflicts' },
};

export default function CrossSessionMemoryPanel({ characterId, sessionId }) {
  const [expanded, setExpanded] = useState(false);
  const [memories, setMemories] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedType, setSelectedType] = useState(null);

  useEffect(() => {
    if (expanded && characterId && !memories.length) {
      loadMemories();
    }
  }, [expanded, characterId]);

  const loadMemories = async () => {
    setLoading(true);
    try {
      const result = await base44.entities.CrossSessionMemory.filter({
        character_id: characterId,
      }, '-relevance_score', 20);
      setMemories(result || []);
    } catch (err) {
      console.error('Failed to load memories:', err);
    } finally {
      setLoading(false);
    }
  };

  const filteredMemories = selectedType
    ? memories.filter(m => m.memory_type === selectedType)
    : memories;

  if (!characterId) return null;

  const memoryGroups = memories.reduce((acc, mem) => {
    if (!acc[mem.memory_type]) acc[mem.memory_type] = [];
    acc[mem.memory_type].push(mem);
    return acc;
  }, {});

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
          <Brain className="w-4 h-4 text-primary/60" />
          <span className="font-mono text-[9px] text-primary/60 tracking-widest uppercase">
            Long-Term Memories ({memories.length})
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
            className="border-t border-primary/10 max-h-96 overflow-y-auto p-3 space-y-3"
          >
            {loading ? (
              <div className="text-center py-4 font-mono text-[9px] text-primary/40 tracking-widest uppercase animate-pulse">
                Retrieving memories...
              </div>
            ) : memories.length === 0 ? (
              <div className="text-center py-4 font-mono text-[9px] text-primary/30 tracking-widest uppercase">
                No memories formed yet
              </div>
            ) : (
              <>
                {/* Memory Type Filter */}
                <div className="flex flex-wrap gap-1 pb-2 border-b border-primary/10">
                  <button
                    onClick={() => setSelectedType(null)}
                    className={`px-2 py-1 text-[8px] font-mono tracking-widest rounded transition-colors ${
                      !selectedType
                        ? 'bg-primary/20 text-primary'
                        : 'bg-primary/5 text-primary/50 hover:text-primary/70'
                    }`}
                  >
                    All
                  </button>
                  {Object.entries(memoryGroups).map(([type, mems]) => {
                    const config = MEMORY_TYPE_ICONS[type];
                    const Icon = config?.icon;
                    return (
                      <button
                        key={type}
                        onClick={() => setSelectedType(type)}
                        className={`flex items-center gap-1 px-2 py-1 text-[8px] font-mono tracking-widest rounded transition-colors ${
                          selectedType === type
                            ? `bg-primary/20 text-primary ${config?.color || 'text-primary'}`
                            : 'bg-primary/5 text-primary/50 hover:text-primary/70'
                        }`}
                      >
                        {Icon && <Icon className="w-3 h-3" />}
                        {config?.label || type.replace(/_/g, ' ')} ({mems.length})
                      </button>
                    );
                  })}
                </div>

                {/* Memory List */}
                <div className="space-y-2">
                  {filteredMemories.length === 0 ? (
                    <div className="text-center py-3 font-mono text-[8px] text-primary/30 tracking-widest uppercase">
                      No memories of this type
                    </div>
                  ) : (
                    filteredMemories.map((memory) => {
                      const config = MEMORY_TYPE_ICONS[memory.memory_type];
                      const Icon = config?.icon;
                      return (
                        <motion.div
                          key={memory.id}
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          className="p-2.5 border border-primary/10 bg-black/40 rounded space-y-1 hover:border-primary/20 transition-colors"
                        >
                          {/* Title */}
                          <div className="flex items-center gap-2">
                            {Icon && <Icon className={`w-3.5 h-3.5 ${config?.color}`} />}
                            <p className="font-mono text-[9px] text-primary/80 tracking-wider uppercase flex-1 line-clamp-1">
                              {memory.subject}
                            </p>
                            <span className="text-[8px] font-mono text-primary/40">
                              ×{memory.reinforcement_count || 1}
                            </span>
                          </div>

                          {/* Description */}
                          <p className="text-[8px] font-mono text-primary/60 leading-relaxed">
                            {memory.description}
                          </p>

                          {/* Metadata */}
                          <div className="flex items-center justify-between pt-1 border-t border-primary/5">
                            <div className="flex items-center gap-2">
                              {memory.emotional_weight && (
                                <span className="text-[7px] font-mono text-primary/40">
                                  Emotional: {memory.emotional_weight}/10
                                </span>
                              )}
                              {memory.relationship_impact !== undefined && memory.relationship_impact !== 0 && (
                                <span
                                  className={`text-[7px] font-mono ${
                                    memory.relationship_impact > 0 ? 'text-green-400' : 'text-red-400'
                                  }`}
                                >
                                  {memory.relationship_impact > 0 ? '+' : ''}{memory.relationship_impact}
                                </span>
                              )}
                            </div>
                            {memory.tags && memory.tags.length > 0 && (
                              <div className="flex gap-1 flex-wrap justify-end">
                                {memory.tags.slice(0, 2).map((tag, idx) => (
                                  <span
                                    key={idx}
                                    className="text-[7px] px-1 py-0.5 bg-primary/10 text-primary/50 rounded"
                                  >
                                    {tag}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </motion.div>
                      );
                    })
                  )}
                </div>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}