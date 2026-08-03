// @ts-check
import { motion } from "framer-motion";

/**
 * @param {{ quest?: any, onAccept: (quest: any) => void, onReject: (title: string) => void }} props
 */
export default function QuestDetectionMessage({ quest, onAccept, onReject }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="flex justify-center my-2"
    >
      <div className="max-w-[75%] px-3 py-2 border border-yellow-400/30 bg-black/60 rounded text-center space-y-1.5">
        <p className="font-mono text-[9px] text-yellow-400 tracking-widest uppercase">
          ⚡ Quest Available
        </p>
        <p className="font-mono text-[9px] text-yellow-400/80 font-semibold">
          {quest.title || quest.name}
        </p>
        {quest.description && (
          <p className="font-mono text-[8px] text-yellow-400/60 leading-relaxed">
            {quest.description}
          </p>
        )}
        <div className="flex items-center justify-center gap-2 pt-1">
          <button
            onClick={() => onAccept(quest)}
            className="px-3 py-0.5 bg-yellow-400/20 border border-yellow-400/40 text-yellow-400 hover:bg-yellow-400/30 text-[8px] font-mono tracking-widest uppercase transition-colors"
          >
            Accept
          </button>
          <button
            onClick={() => onReject(quest.title || quest.name)}
            className="px-3 py-0.5 border border-yellow-400/15 text-yellow-400/50 hover:text-yellow-400/70 text-[8px] font-mono tracking-widest uppercase transition-colors"
          >
            Dismiss
          </button>
        </div>
      </div>
    </motion.div>
  );
}