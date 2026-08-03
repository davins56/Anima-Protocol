// @ts-check
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, X } from 'lucide-react';

/**
 * @param {{ quest?: any, onDismiss?: () => void }} props
 */
export default function QuestDetectionNotice({ quest, onDismiss }) {
  if (!quest) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        className="flex items-start gap-3 p-3 border border-cyan-400/30 bg-cyan-400/10 rounded"
      >
        <CheckCircle2 className="w-4 h-4 text-cyan-400 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-[9px] font-mono text-cyan-400 tracking-widest uppercase mb-1">
            Quest Detected
          </p>
          <p className="text-[10px] font-mono text-cyan-300">
            {quest.title}
          </p>
          {quest.confidence && (
            <p className="text-[8px] font-mono text-cyan-400/60 mt-1">
              Confidence: {Math.round(quest.confidence * 100)}%
            </p>
          )}
        </div>
        {onDismiss && (
          <button
            onClick={onDismiss}
            className="text-cyan-400/50 hover:text-cyan-400 transition-colors flex-shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </motion.div>
    </AnimatePresence>
  );
}