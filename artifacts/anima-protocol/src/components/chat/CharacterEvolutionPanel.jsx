import { useState } from "react";
import { Loader, ChevronDown, Sparkles } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function CharacterEvolutionPanel({ character, evolution, loading, onApplyEvolution }) {
  const [expanded, setExpanded] = useState(false);

  if (!evolution) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        className="border border-purple-400/30 bg-purple-400/5 rounded overflow-hidden"
      >
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center justify-between px-3 py-2 hover:bg-purple-400/10 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5 text-purple-400" />
            <span className="font-mono text-[9px] text-purple-400 tracking-widest uppercase">
              {character?.name} Evolution
            </span>
          </div>
          <ChevronDown
            className={`w-3 h-3 text-purple-400 transition-transform ${
              expanded ? "rotate-180" : ""
            }`}
          />
        </button>

        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="px-3 py-3 border-t border-purple-400/20 space-y-2 max-h-60 overflow-y-auto"
            >
              {loading ? (
                <div className="flex items-center gap-2 py-2">
                  <Loader className="w-3 h-3 text-purple-400 animate-spin" />
                  <span className="font-mono text-[9px] text-purple-400/60">Analyzing growth...</span>
                </div>
              ) : (
                <>
                  {evolution.evolved_personality && (
                    <div className="p-2 bg-black/40 border border-purple-400/15 rounded">
                      <div className="font-mono text-[9px] text-purple-400 font-semibold mb-1">
                        Evolved Personality
                      </div>
                      <div className="text-purple-300/70 text-[8px] leading-relaxed">
                        {evolution.evolved_personality}
                      </div>
                    </div>
                  )}

                  {evolution.growth_areas?.length > 0 && (
                    <div className="p-2 bg-black/40 border border-purple-400/15 rounded">
                      <div className="font-mono text-[9px] text-purple-400 font-semibold mb-1">
                        Growth Areas
                      </div>
                      <ul className="text-purple-300/70 text-[8px] space-y-0.5">
                        {evolution.growth_areas.map((area, idx) => (
                          <li key={idx} className="ml-2">• {area}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {evolution.updated_motivations?.length > 0 && (
                    <div className="p-2 bg-black/40 border border-purple-400/15 rounded">
                      <div className="font-mono text-[9px] text-purple-400 font-semibold mb-1">
                        New Motivations
                      </div>
                      <ul className="text-purple-300/70 text-[8px] space-y-0.5">
                        {evolution.updated_motivations.map((mot, idx) => (
                          <li key={idx} className="ml-2">• {mot}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {evolution.new_vulnerabilities?.length > 0 && (
                    <div className="p-2 bg-black/40 border border-purple-400/15 rounded">
                      <div className="font-mono text-[9px] text-purple-400 font-semibold mb-1">
                        New Vulnerabilities
                      </div>
                      <ul className="text-purple-300/70 text-[8px] space-y-0.5">
                        {evolution.new_vulnerabilities.map((vuln, idx) => (
                          <li key={idx} className="ml-2">• {vuln}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <button
                    onClick={() => onApplyEvolution(evolution)}
                    className="w-full mt-2 py-1.5 border border-purple-400/30 bg-purple-400/10 text-purple-400 hover:bg-purple-400/20 transition-colors font-mono text-[9px] tracking-widest uppercase"
                  >
                    Apply Evolution
                  </button>
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </AnimatePresence>
  );
}