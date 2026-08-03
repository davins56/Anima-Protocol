import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Sparkles } from 'lucide-react';

export interface Memory {
  id?: string;
  category: string;
  fact: string;
  created_date?: string;
}

interface MemoryCrystalsProps {
  memories: Memory[];
  onClose: () => void;
}

export default function MemoryCrystals({ memories, onClose }: MemoryCrystalsProps) {
  const [selectedMemory, setSelectedMemory] = useState<Memory | null>(null);

  // Map categories to glowing aesthetic colors
  const getCategoryColor = (category: string) => {
    const cat = category.toLowerCase();
    if (cat.includes('emotion')) return 'from-rose-500/40 to-pink-600/10 border-rose-500/50 text-rose-300';
    if (cat.includes('relationship')) return 'from-purple-500/40 to-fuchsia-600/10 border-purple-500/50 text-purple-300';
    if (cat.includes('event') || cat.includes('milestone')) return 'from-amber-500/40 to-orange-600/10 border-amber-500/50 text-amber-300';
    return 'from-cyan-500/40 to-blue-600/10 border-cyan-500/50 text-cyan-300'; // Default/Preference
  };

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-black/90 backdrop-blur-xl p-6 font-mono">
      {/* Header */}
      <div className="flex items-center justify-between w-full max-w-5xl mx-auto mb-10 pt-4">
        <div>
          <h2 className="text-2xl font-sacred text-primary/90 flex items-center gap-3">
            <Sparkles className="w-5 h-5 opacity-70" /> Crystalline Log
          </h2>
          <p className="text-[10px] text-primary/50 tracking-[0.25em] uppercase mt-1">
            Persistent echoes of your shared journey
          </p>
        </div>
        <button onClick={onClose} className="p-2 text-primary/40 hover:text-primary transition-colors bg-white/5 rounded-full">
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Crystal Grid */}
      <div className="flex-1 w-full max-w-5xl mx-auto overflow-y-auto pb-20 custom-scrollbar">
        {memories.length === 0 ? (
          <div className="flex h-full items-center justify-center text-primary/30 text-xs tracking-widest uppercase">
            No memories crystallized yet.
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-8 px-4">
            <AnimatePresence>
              {memories.map((memory, index) => {
                const colors = getCategoryColor(memory.category);
                return (
                  <motion.div
                    key={memory.id || index}
                    layoutId={`crystal-${memory.id || index}`}
                    initial={{ opacity: 0, scale: 0.5, y: 20 }}
                    animate={{ 
                      opacity: 1, 
                      scale: 1, 
                      y: [0, -8, 0], // Floating animation
                    }}
                    transition={{ 
                      opacity: { duration: 0.4, delay: index * 0.05 },
                      scale: { duration: 0.4, delay: index * 0.05 },
                      y: { duration: 4, repeat: Infinity, ease: "easeInOut", delay: (index % 3) * 0.5 }
                    }}
                    onClick={() => setSelectedMemory(memory)}
                    className={`relative aspect-[3/4] cursor-pointer group flex items-center justify-center`}
                  >
                    {/* The Crystal Shape (CSS Diamond/Shard) */}
                    <div className={`absolute inset-0 bg-gradient-to-b ${colors} border border-opacity-50 transition-all duration-500 group-hover:brightness-150 group-hover:drop-shadow-[0_0_15px_rgba(0,229,229,0.4)]`}
                         style={{ clipPath: 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)' }} />
                    
                    {/* Inner Core Glow */}
                    <div className="absolute inset-4 bg-white/5 blur-md rounded-full" />
                    
                    <div className="relative z-10 text-center px-2">
                      <span className="text-[9px] uppercase tracking-widest opacity-80 mix-blend-screen drop-shadow-md">
                        {memory.category}
                      </span>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Expanded Memory Modal */}
      <AnimatePresence>
        {selectedMemory && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            onClick={() => setSelectedMemory(null)}
          >
            <motion.div layoutId={`crystal-${selectedMemory.id}`} className={`max-w-md w-full bg-black/80 border p-8 text-center space-y-4 rounded-xl shadow-2xl ${getCategoryColor(selectedMemory.category).replace('text-', 'shadow-')}`}>
              <div className="text-[10px] uppercase tracking-[0.3em] opacity-60">{selectedMemory.category}</div>
              <p className="text-sm leading-relaxed text-white/90">"{selectedMemory.fact}"</p>
              {selectedMemory.created_date && <div className="text-[9px] opacity-40 pt-4">{new Date(selectedMemory.created_date).toLocaleDateString()}</div>}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}