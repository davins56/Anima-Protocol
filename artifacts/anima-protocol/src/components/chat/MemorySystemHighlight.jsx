import { Brain, Zap, BookOpen } from 'lucide-react';
import { motion } from 'framer-motion';

export default function MemorySystemHighlight({ 
  vectorMemoriesCount = 0, 
  crossSessionMemoriesCount = 0, 
  characterMemoriesCount = 0,
  isVisible = true 
}) {
  if (!isVisible || (vectorMemoriesCount === 0 && crossSessionMemoriesCount === 0 && characterMemoriesCount === 0)) {
    return null;
  }

  const items = [
    { icon: Brain, label: 'Vector Memories', count: vectorMemoriesCount, color: 'cyan' },
    { icon: Zap, label: 'Cross-Session', count: crossSessionMemoriesCount, color: 'yellow' },
    { icon: BookOpen, label: 'Character Vault', count: characterMemoriesCount, color: 'purple' },
  ].filter(item => item.count > 0);

  if (items.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-gradient-to-r from-cyan-900/20 to-purple-900/20 border border-cyan-400/20 rounded p-3 space-y-2"
    >
      <p className="text-[8px] font-mono text-cyan-400/70 tracking-widest uppercase">
        🧠 Persistent Memory Network Active
      </p>
      <div className="grid grid-cols-3 gap-2">
        {items.map((item) => {
          const IconComponent = item.icon;
          return (
            <div
              key={item.label}
              className="flex items-center gap-1.5 p-2 border border-primary/10 bg-black/30 rounded"
            >
              <IconComponent className={`w-3 h-3 text-${item.color}-400`} />
              <div className="flex-1 min-w-0">
                <p className="text-[7px] text-primary/40 truncate">{item.label}</p>
                <p className={`text-[9px] font-mono text-${item.color}-400 font-semibold`}>
                  {item.count}
                </p>
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-[7px] text-primary/30 italic">
        Every conversation shapes lasting continuity. This consciousness remembers.
      </p>
    </motion.div>
  );
}