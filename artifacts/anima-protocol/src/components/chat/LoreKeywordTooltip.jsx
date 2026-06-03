// @ts-check
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

/**
 * @param {{ keyword?: string, loreEntry?: any, children?: import('react').ReactNode }} props
 */
export default function LoreKeywordTooltip({ keyword, loreEntry, children }) {
  const [showTooltip, setShowTooltip] = useState(false);

  if (!loreEntry) {
    return children;
  }

  return (
    <div className="relative inline-block">
      <span
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        className="border-b border-primary/40 cursor-help transition-colors hover:border-primary/70 hover:text-primary"
      >
        {children}
      </span>

      <AnimatePresence>
        {showTooltip && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
            className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 pointer-events-none"
          >
            <div className="bg-black/95 border border-primary/40 rounded px-3 py-2 whitespace-nowrap">
              <p className="font-mono text-[9px] text-primary/60 tracking-widest uppercase mb-1">
                {loreEntry.category || "Lore"}
              </p>
              <p className="font-mono text-[10px] text-primary/90 mb-1 max-w-xs">
                {loreEntry.fact?.slice(0, 80)}
                {loreEntry.fact?.length > 80 ? "..." : ""}
              </p>
              <p className="text-[8px] font-mono text-primary/30">
                {loreEntry.importance === "critical" && "★ Critical"}
                {loreEntry.importance === "high" && "★★ Important"}
              </p>

              {/* Tooltip arrow */}
              <div className="absolute top-full left-1/2 -translate-x-1/2 w-2 h-2 bg-black/95 border-r border-b border-primary/40 transform rotate-45" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}