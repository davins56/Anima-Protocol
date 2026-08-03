import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Lightbulb, Loader, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function LocationDialogueHints({
  sessionId,
  characterId,
  characterName,
  currentLocation,
  recentContext,
  isVisible,
}) {
  const [hints, setHints] = useState([]);
  const [loading, setLoading] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (isVisible && currentLocation && characterId && !dismissed) {
      generateHints();
    }
  }, [isVisible, currentLocation, characterId, dismissed]);

  const generateHints = async () => {
    setLoading(true);
    try {
      const result = await base44.functions.invoke("generateLocationHints", {
        session_id: sessionId,
        character_id: characterId,
        current_location: currentLocation,
        recent_context: recentContext,
      });

      if (result?.data?.hints?.length > 0) {
        setHints(result.data.hints);
      }
    } catch (err) {
      console.error("Error generating location hints:", err);
    } finally {
      setLoading(false);
    }
  };

  if (!isVisible || dismissed || hints.length === 0) {
    return null;
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        className="border border-cyan-400/30 bg-cyan-400/5 rounded p-3 space-y-2 mb-3"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2 min-w-0">
            {loading ? (
              <Loader className="w-4 h-4 text-cyan-400 animate-spin flex-shrink-0 mt-0.5" />
            ) : (
              <Lightbulb className="w-4 h-4 text-cyan-400 flex-shrink-0 mt-0.5" />
            )}
            <div className="min-w-0">
              <p className="font-mono text-[9px] text-cyan-400 tracking-widest uppercase">
                {currentLocation} — Dialogue Hints
              </p>
              {!loading && hints.length > 0 && (
                <div className="space-y-1.5 mt-1.5">
                  {hints.map((hint, idx) => (
                    <p
                      key={idx}
                      className="text-[9px] font-mono text-cyan-300/70 italic leading-relaxed"
                    >
                      "{hint}"
                    </p>
                  ))}
                </div>
              )}
              {loading && (
                <p className="text-[8px] font-mono text-cyan-300/50 mt-1">
                  Generating contextual hints...
                </p>
              )}
            </div>
          </div>
          <button
            onClick={() => setDismissed(true)}
            className="text-cyan-400/50 hover:text-cyan-400 transition-colors flex-shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}