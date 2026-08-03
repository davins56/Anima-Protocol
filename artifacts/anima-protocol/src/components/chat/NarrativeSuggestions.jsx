import { useState } from "react";
import { ChevronDown, Sparkles, Loader, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function NarrativeSuggestions({ worldElements, eventSuggestions, loading, onApplySuggestion }) {
  const [expandedSection, setExpandedSection] = useState(null);

  return (
    <div className="space-y-2 mb-4">
      {/* World-Building Discoveries */}
      <AnimatePresence>
        {worldElements.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="border border-cyan-400/30 bg-cyan-400/5 rounded"
          >
            <button
              onClick={() => setExpandedSection(expandedSection === "world" ? null : "world")}
              className="w-full flex items-center justify-between px-3 py-2 hover:bg-cyan-400/10 transition-colors"
            >
              <div className="flex items-center gap-2">
                <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                <span className="font-mono text-[9px] text-cyan-400 tracking-widest uppercase">
                  World Discoveries ({worldElements.length})
                </span>
              </div>
              <ChevronDown
                className={`w-3 h-3 text-cyan-400 transition-transform ${
                  expandedSection === "world" ? "rotate-180" : ""
                }`}
              />
            </button>
            {expandedSection === "world" && (
              <div className="px-3 py-2 border-t border-cyan-400/20 space-y-1.5 max-h-40 overflow-y-auto">
                {worldElements.map((elem, idx) => (
                  <div
                    key={idx}
                    className="p-2 bg-black/40 border border-cyan-400/15 rounded text-[9px] font-mono text-cyan-300/80"
                  >
                    <div className="font-semibold text-cyan-400">{elem.subject}</div>
                    <div className="text-cyan-300/60 mt-0.5">{elem.fact}</div>
                    <div className="text-cyan-400/50 text-[8px] mt-1">
                      [{elem.category}]
                    </div>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Event Suggestions */}
      <AnimatePresence>
        {eventSuggestions.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="border border-yellow-400/30 bg-yellow-400/5 rounded"
          >
            <button
              onClick={() => setExpandedSection(expandedSection === "events" ? null : "events")}
              className="w-full flex items-center justify-between px-3 py-2 hover:bg-yellow-400/10 transition-colors"
            >
              <div className="flex items-center gap-2">
                <Sparkles className="w-3.5 h-3.5 text-yellow-400" />
                <span className="font-mono text-[9px] text-yellow-400 tracking-widest uppercase">
                  Narrative Events ({eventSuggestions.length})
                </span>
              </div>
              <ChevronDown
                className={`w-3 h-3 text-yellow-400 transition-transform ${
                  expandedSection === "events" ? "rotate-180" : ""
                }`}
              />
            </button>
            {expandedSection === "events" && (
              <div className="px-3 py-2 border-t border-yellow-400/20 space-y-1.5 max-h-40 overflow-y-auto">
                {eventSuggestions.map((event, idx) => (
                  <div key={idx} className="p-2 bg-black/40 border border-yellow-400/15 rounded">
                    <div className="font-mono text-[9px] text-yellow-400 font-semibold">
                      {event.title}
                    </div>
                    <div className="text-yellow-300/70 text-[8px] mt-0.5 leading-relaxed">
                      {event.description}
                    </div>
                    {event.narrative_hook && (
                      <div className="text-yellow-400/50 text-[8px] mt-1 italic">
                        "{event.narrative_hook}"
                      </div>
                    )}
                    <button
                      onClick={() => onApplySuggestion(event)}
                      className="mt-1.5 text-[8px] px-2 py-1 border border-yellow-400/30 text-yellow-400 hover:bg-yellow-400/10 transition-colors font-mono"
                    >
                      Trigger Event
                    </button>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Loading State */}
      {loading && (
        <div className="p-2.5 border border-primary/20 bg-primary/5 rounded flex items-center gap-2">
          <Loader className="w-3 h-3 text-primary/60 animate-spin" />
          <span className="font-mono text-[9px] text-primary/50 tracking-widest uppercase">
            Analyzing narrative...
          </span>
        </div>
      )}
    </div>
  );
}