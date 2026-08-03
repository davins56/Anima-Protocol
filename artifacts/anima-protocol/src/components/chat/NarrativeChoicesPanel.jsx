import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Loader, ChevronRight } from "lucide-react";

export default function NarrativeChoicesPanel({
  choices,
  loading,
  onSelectChoice,
  sessionId,
}) {
  const [selectedIdx, setSelectedIdx] = useState(null);

  if (!choices?.length && !loading) return null;

  return (
    <div className="border-t border-primary/20 bg-black/40 p-4 sm:p-6">
      <div className="mb-4">
        <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase">
          // Story Direction
        </p>
        <p className="font-mono text-[10px] text-primary/50 mt-1">
          {loading ? "Analyzing narrative..." : "Choose your path forward"}
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-4">
          <Loader className="w-4 h-4 text-primary/60 animate-spin" />
          <span className="font-mono text-[9px] text-primary/40 tracking-widest uppercase">
            Generating choices...
          </span>
        </div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-2 snap-x snap-mandatory">
          <AnimatePresence>
            {choices.map((choice, idx) => (
              <motion.button
                key={idx}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ delay: idx * 0.1 }}
                onClick={() => {
                  setSelectedIdx(idx);
                  onSelectChoice(choice);
                }}
                className={`flex-shrink-0 w-full sm:w-64 snap-start group relative border rounded overflow-hidden transition-all ${
                  selectedIdx === idx
                    ? "border-primary/60 bg-primary/20"
                    : "border-primary/25 bg-black/60 hover:border-primary/40 hover:bg-primary/10"
                }`}
              >
                {/* Background gradient */}
                <div className="absolute inset-0 bg-gradient-to-br from-primary/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />

                {/* Content */}
                <div className="relative p-4 sm:p-5 text-left flex flex-col gap-2.5">
                  {/* Number indicator */}
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[9px] text-primary/40 tracking-widest uppercase">
                      Choice {idx + 1}
                    </span>
                    <ChevronRight className="w-3.5 h-3.5 text-primary/40 group-hover:text-primary/70 transition-colors" />
                  </div>

                  {/* Title */}
                  <h3 className="font-mono text-sm font-semibold text-primary/90 leading-snug">
                    {choice.title || choice.text}
                  </h3>

                  {/* Description */}
                  {choice.description && (
                    <p className="font-mono text-[9px] text-primary/50 leading-relaxed line-clamp-2">
                      {choice.description}
                    </p>
                  )}

                  {/* Impact indicator */}
                  {choice.impact_scale && (
                    <div className="flex items-center gap-2 pt-1">
                      <span className={`font-mono text-[8px] tracking-widest uppercase px-2 py-0.5 border rounded ${
                        choice.impact_scale === "major"
                          ? "border-red-400/40 text-red-400/70 bg-red-400/5"
                          : choice.impact_scale === "moderate"
                            ? "border-yellow-400/40 text-yellow-400/70 bg-yellow-400/5"
                            : "border-cyan-400/40 text-cyan-400/70 bg-cyan-400/5"
                      }`}>
                        {choice.impact_scale} impact
                      </span>
                    </div>
                  )}
                </div>

                {/* Selection indicator */}
                {selectedIdx === idx && (
                  <motion.div
                    layoutId="selected"
                    className="absolute inset-0 border-2 border-primary/80 pointer-events-none"
                  />
                )}
              </motion.button>
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Info text */}
      {!loading && choices.length > 0 && (
        <p className="font-mono text-[8px] text-primary/20 mt-3 tracking-widest">
          Select a choice to branch the story in that direction
        </p>
      )}
    </div>
  );
}