// @ts-check
import { motion, AnimatePresence } from "framer-motion";
import { MOODS } from "@/lib/moodDetector";

/**
 * Displays the current detected mood of the active character.
 * Animates whenever the mood changes.
 */
/**
 * @param {{ mood?: string }} props
 */
export default function MoodIndicator({ mood }) {
  const config = MOODS[/** @type {keyof typeof MOODS} */ (mood)] || MOODS.neutral;

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={mood}
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 4 }}
        transition={{ duration: 0.3 }}
        className="flex items-center gap-1.5"
      >
        <span
          className={`w-1.5 h-1.5 rounded-full ${config.dot} shadow-sm ${config.glow}`}
          style={{ boxShadow: config.glow ? `0 0 6px 1px var(--tw-shadow-color)` : "none" }}
        />
        <span className={`font-mono text-[9px] tracking-widest uppercase ${config.color}`}>
          {config.label}
        </span>
      </motion.div>
    </AnimatePresence>
  );
}