import { useState } from 'react';
import { CheckCircle2, Circle, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const difficultyColors = {
  trivial: 'text-green-400',
  easy: 'text-cyan-400',
  moderate: 'text-primary/60',
  hard: 'text-orange-400',
  legendary: 'text-red-400',
};

export default function QuestProgressCard({ quest, onComplete, onObjectiveToggle }) {
  const [expanded, setExpanded] = useState(false);

  const completed = quest.objectives?.filter(o => o.completed).length || 0;
  const total = quest.objectives?.length || 1;
  const progress = Math.round((completed / total) * 100);
  const isComplete = progress === 100;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`border rounded-lg overflow-hidden transition-all ${
        isComplete
          ? 'border-green-400/20 bg-green-900/10'
          : 'border-primary/20 bg-black/40 hover:border-primary/40'
      }`}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-4 text-left flex items-start justify-between gap-3"
      >
        <div className="flex-1 min-w-0">
          <p className={`font-mono text-[9px] tracking-widest uppercase ${
            isComplete ? 'text-green-400 line-through' : 'text-primary'
          }`}>
            {quest.title}
          </p>
          {quest.description && (
            <p className="text-[8px] text-primary/50 mt-1">{quest.description}</p>
          )}
        </div>

        {/* Difficulty Badge */}
        {quest.difficulty && (
          <span className={`text-[8px] font-mono ${difficultyColors[quest.difficulty] || 'text-primary/40'} uppercase whitespace-nowrap flex-shrink-0`}>
            {quest.difficulty}
          </span>
        )}

        <ChevronDown className={`w-4 h-4 text-primary/40 transition-transform flex-shrink-0 ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {/* Progress Bar */}
      <div className="px-4 pb-3 space-y-2">
        <div className="flex items-center justify-between text-[8px]">
          <span className="font-mono text-primary/50">{completed}/{total} objectives</span>
          <span className={`font-mono font-semibold ${isComplete ? 'text-green-400' : 'text-primary'}`}>
            {progress}%
          </span>
        </div>
        <div className={`h-1.5 border rounded-full overflow-hidden ${isComplete ? 'border-green-400/50' : 'border-primary/20'}`}>
          <motion.div
            animate={{ width: `${progress}%` }}
            className={`h-full transition-all ${
              isComplete
                ? 'bg-gradient-to-r from-green-400 to-green-500'
                : 'bg-gradient-to-r from-primary to-cyan-400'
            }`}
          />
        </div>
      </div>

      {/* Objectives List */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="border-t border-primary/10 bg-black/60 p-3 space-y-2"
          >
            {quest.objectives?.map(obj => (
              <button
                key={obj.id}
                onClick={() => onObjectiveToggle(obj.id)}
                className="w-full flex items-start gap-2 p-2 rounded hover:bg-primary/5 transition-all text-left"
              >
                {obj.completed ? (
                  <CheckCircle2 className="w-4 h-4 text-green-400 flex-shrink-0 mt-0.5" />
                ) : (
                  <Circle className="w-4 h-4 text-primary/40 flex-shrink-0 mt-0.5" />
                )}
                <span className={`text-[8px] font-mono ${obj.completed ? 'text-primary/40 line-through' : 'text-primary/70'}`}>
                  {obj.description}
                </span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Complete Button */}
      {!isComplete && (
        <div className="px-4 py-2 border-t border-primary/10 bg-black/40">
          <button
            onClick={onComplete}
            className="w-full px-3 py-1.5 bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 font-mono text-[8px] tracking-widest uppercase transition-all"
          >
            Mark Complete
          </button>
        </div>
      )}

      {isComplete && (
        <div className="px-4 py-2 border-t border-green-400/20 bg-green-900/20 text-center">
          <p className="font-mono text-[8px] text-green-400 tracking-widest uppercase">✓ Completed</p>
        </div>
      )}
    </motion.div>
  );
}