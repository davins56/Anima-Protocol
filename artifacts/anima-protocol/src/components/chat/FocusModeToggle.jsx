// @ts-check
import { Maximize2, Minimize2 } from "lucide-react";
import { motion } from "framer-motion";

/**
 * @param {{ isFocusMode?: boolean, onToggle?: () => void }} props
 */
export default function FocusModeToggle({ isFocusMode, onToggle }) {
  return (
    <motion.button
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      onClick={onToggle}
      className={`p-2 sm:p-3 border rounded transition-all ${
        isFocusMode
          ? "bg-primary/20 border-primary/60 text-primary"
          : "border-primary/20 text-primary/40 hover:text-primary hover:border-primary/50"
      }`}
      title={isFocusMode ? "Exit Focus Mode" : "Enter Focus Mode"}
    >
      {isFocusMode ? (
        <Minimize2 className="w-4 sm:w-5 h-4 sm:h-5" />
      ) : (
        <Maximize2 className="w-4 sm:w-5 h-4 sm:h-5" />
      )}
    </motion.button>
  );
}