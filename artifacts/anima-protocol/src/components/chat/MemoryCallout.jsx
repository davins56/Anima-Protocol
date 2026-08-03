import { motion } from "framer-motion";
import { Zap } from "lucide-react";

/**
 * Visual callout that appears when AI references a prior memory.
 * Creates the magical "they remember me" moment.
 */
export default function MemoryCallout({ memory, isVisible }) {
  if (!isVisible || !memory) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -10, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -10 }}
      className="absolute -top-12 left-0 right-0 mx-auto w-fit px-3 py-1.5 bg-amber-500/20 border border-amber-400/50 rounded-full flex items-center gap-1.5 whitespace-nowrap"
    >
      <Zap className="w-3 h-3 text-amber-400" />
      <span className="font-mono text-[9px] text-amber-300 tracking-wider uppercase">
        💫 Memory: {memory.subject}
      </span>
    </motion.div>
  );
}