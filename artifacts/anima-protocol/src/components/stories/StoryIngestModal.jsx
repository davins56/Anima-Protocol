import { useState } from "react";
import { X } from "lucide-react";
import { motion } from "framer-motion";
import SeriesLoreIngestion from "./SeriesLoreIngestion";

export default function StoryIngestModal({
  isOpen,
  sessionId,
  characterId,
  onClose,
  onIngestComplete,
}) {
  const [ingestComplete, setIngestComplete] = useState(false);

  if (!isOpen) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="w-full max-w-md bg-background border border-primary/30 hud-corner glow-border max-h-[80vh] overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-primary/20 bg-primary/5 flex-shrink-0">
          <h2 className="font-mono text-primary glow-text tracking-[0.2em] uppercase text-base">
            // Preload Series Lore
          </h2>
          <button
            onClick={() => {
              setIngestComplete(false);
              onClose();
            }}
            className="text-primary/30 hover:text-primary transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          <SeriesLoreIngestion
            sessionId={sessionId}
            characterId={characterId}
            onComplete={() => {
              setIngestComplete(true);
              setTimeout(() => {
                onIngestComplete?.();
                onClose();
              }, 1500);
            }}
          />
        </div>
      </motion.div>
    </motion.div>
  );
}