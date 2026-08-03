import { motion, AnimatePresence } from "framer-motion";
import { ChevronRight, Sparkles } from "lucide-react";
import { useState } from "react";

export default function AdventureChoices({ 
  sessionId, 
  characterId, 
  choices = [], 
  onChoiceMade, 
  loading 
}) {
  const [selectedIdx, setSelectedIdx] = useState(null);

  if (!choices.length) return null;

  // Limit to 3 choices for adventure style
  const adventureChoices = choices.slice(0, 3);

  const handleSelect = async (choice, idx) => {
    setSelectedIdx(idx);
    
    if (onChoiceMade) {
      onChoiceMade(choice);
    }
  };

  return (
    <div className="space-y-4">
      {/* Adventure Header */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex items-center gap-2 mb-6"
      >
        <Sparkles className="w-4 h-4 text-primary/60" />
        <p className="font-mono text-[10px] text-primary/50 tracking-[0.3em] uppercase">
          What do you do?
        </p>
      </motion.div>

      {/* Choice Paths */}
      <div className="space-y-3">
        <AnimatePresence>
          {adventureChoices.map((choice, idx) => {
            const isSelected = selectedIdx === idx;
            const pathLetters = ["A", "B", "C"];
            
            return (
              <motion.button
                key={idx}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                transition={{ delay: idx * 0.1 }}
                onClick={() => handleSelect(choice, idx)}
                disabled={loading || selectedIdx !== null}
                className={`w-full group relative overflow-hidden transition-all ${
                  isSelected
                    ? "pointer-events-none"
                    : "hover:border-primary/50 hover:bg-primary/10"
                }`}
              >
                {/* Animated background on hover */}
                <div className="absolute inset-0 bg-gradient-to-r from-primary/0 via-primary/10 to-primary/0 opacity-0 group-hover:opacity-100 transition-opacity" />

                <div className={`relative p-4 border rounded transition-all ${
                  isSelected
                    ? "border-primary/60 bg-primary/10"
                    : "border-primary/20 bg-black/40"
                }`}>
                  <div className="flex items-start gap-4">
                    {/* Path Letter */}
                    <div className={`w-8 h-8 rounded border flex items-center justify-center flex-shrink-0 font-mono text-sm font-bold transition-all ${
                      isSelected
                        ? "border-primary/60 bg-primary/20 text-primary"
                        : "border-primary/30 bg-primary/5 text-primary/50 group-hover:border-primary/50 group-hover:bg-primary/10"
                    }`}>
                      {pathLetters[idx]}
                    </div>

                    {/* Choice Text */}
                    <div className="flex-1 text-left min-w-0">
                      <p className="font-mono text-sm tracking-wide leading-relaxed text-primary/90 mb-1">
                        {choice.text}
                      </p>
                      
                      {/* Consequence Hint */}
                      {choice.consequences && choice.consequences.length > 0 && (
                        <p className="text-[9px] font-mono text-primary/40 line-clamp-1">
                          → {choice.consequences[0].description}
                        </p>
                      )}
                    </div>

                    {/* Arrow Indicator */}
                    <ChevronRight className={`w-4 h-4 flex-shrink-0 transition-all ${
                      isSelected
                        ? "text-primary"
                        : "text-primary/20 group-hover:text-primary/60"
                    }`} />
                  </div>

                  {/* Selection Progress */}
                  {isSelected && (
                    <motion.div
                      initial={{ scaleX: 0 }}
                      animate={{ scaleX: 1 }}
                      className="absolute bottom-0 left-0 h-0.5 bg-primary origin-left"
                      transition={{ duration: 0.6 }}
                    />
                  )}
                </div>
              </motion.button>
            );
          })}
        </AnimatePresence>
      </div>

      {/* Processing State */}
      {selectedIdx !== null && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="pt-2 text-center"
        >
          <p className="font-mono text-[9px] text-primary/50 tracking-widest uppercase animate-pulse">
            Continuing your journey...
          </p>
        </motion.div>
      )}
    </div>
  );
}