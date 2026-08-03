// @ts-check
import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Lightbulb, ChevronDown } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

/**
 * @param {{ activeQuests: any[], sessionId?: string }} props
 */
export default function QuestHintsPanel({ activeQuests, sessionId }) {
  const [hints, setHints] = useState(/** @type {Record<string, string>} */ ({}));
  const [expandedQuestId, setExpandedQuestId] = useState(/** @type {string | null} */ (null));
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (activeQuests.length > 0) {
      generateHints();
    }
  }, [activeQuests]);

  const generateHints = async () => {
    setLoading(true);
    try {
      const result = await base44.functions.invoke("generateQuestHints", {
        quests: activeQuests,
        session_id: sessionId,
      });
      if (result?.data?.hints) {
        setHints(result.data.hints);
      }
    } catch (err) {
      console.error("Error generating hints:", err);
    } finally {
      setLoading(false);
    }
  };

  if (activeQuests.length === 0 || loading) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="border border-cyan-400/30 bg-cyan-400/5 rounded p-3 space-y-2"
    >
      <div className="flex items-center gap-2">
        <Lightbulb className="w-4 h-4 text-cyan-400" />
        <span className="text-[9px] font-mono text-cyan-400 tracking-widest uppercase">
          Quest Hints
        </span>
      </div>

      <div className="space-y-1">
        {activeQuests.map((/** @type {any} */ quest) => (
          <button
            key={quest.id}
            onClick={() =>
              setExpandedQuestId(
                expandedQuestId === quest.id ? null : quest.id
              )
            }
            className="w-full flex items-center justify-between px-2.5 py-1.5 border border-cyan-400/15 bg-black/30 hover:bg-cyan-400/10 rounded transition-colors text-left"
          >
            <span className="text-[9px] font-mono text-cyan-400/80 truncate">
              {quest.title}
            </span>
            <ChevronDown
              className={`w-3 h-3 text-cyan-400/50 transition-transform flex-shrink-0 ${
                expandedQuestId === quest.id ? "rotate-180" : ""
              }`}
            />
          </button>
        ))}
      </div>

      <AnimatePresence>
        {expandedQuestId && hints[expandedQuestId] && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-2 p-2.5 border border-cyan-400/20 bg-black/40 rounded text-[9px] font-mono text-cyan-400/70 leading-relaxed"
          >
            {hints[expandedQuestId]}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}