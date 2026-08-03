import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { ChevronDown, Zap, Loader } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function ChoiceGenerator({
  sessionId,
  characterId,
  characterName,
  narrativeArcs,
  recentMessages,
  onChoiceSelected,
  isVisible = true,
}) {
  const [choices, setChoices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [selectedChoiceId, setSelectedChoiceId] = useState(null);

  useEffect(() => {
    if (isVisible && sessionId && characterId && narrativeArcs?.length > 0) {
      generateChoices();
    }
  }, [sessionId, characterId, narrativeArcs?.length, isVisible]);

  const generateChoices = async () => {
    setLoading(true);
    try {
      const result = await base44.functions.invoke("generateChoices", {
        session_id: sessionId,
        character_name: characterName,
        character_id: characterId,
        narrative_arcs: narrativeArcs.slice(0, 3),
        recent_context: (recentMessages || [])
          .slice(-5)
          .map((m) => `${m.character_name}: ${m.content}`)
          .join("\n"),
      });

      if (result?.data?.choices) {
        setChoices(result.data.choices);
        setExpanded(true);
      }
    } catch (err) {
      console.error("Choice generation error:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleChoiceSelect = async (choice) => {
    setSelectedChoiceId(choice.id);

    // Track the choice selection
    await base44.analytics.track({
      eventName: "narrative_choice_selected",
      properties: {
        session_id: sessionId,
        character_id: characterId,
        choice_title: choice.title,
        impact_scale: choice.impact_scale,
      },
    });

    // Trigger the callback
    if (onChoiceSelected) {
      onChoiceSelected(choice);
    }

    // Auto-collapse and reset
    setTimeout(() => {
      setSelectedChoiceId(null);
      setChoices([]);
      setExpanded(false);
    }, 2000);
  };

  if (!isVisible || choices.length === 0) {
    return null;
  }

  const impactColors = {
    minor: "border-cyan-400/30 bg-cyan-400/5 text-cyan-400",
    moderate: "border-yellow-400/30 bg-yellow-400/5 text-yellow-400",
    major: "border-red-400/30 bg-red-400/5 text-red-400",
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="border border-primary/20 bg-black/40 rounded overflow-hidden mb-4"
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-primary/5 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Zap className="w-3.5 h-3.5 text-primary/60" />
          <span className="font-mono text-[9px] text-primary/60 tracking-widest uppercase">
            Narrative Paths
          </span>
          {loading && <Loader className="w-2.5 h-2.5 text-primary/40 animate-spin" />}
        </div>
        <ChevronDown
          className={`w-3 h-3 text-primary/40 transition-transform ${
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
            className="px-4 py-3 border-t border-primary/10 space-y-2"
          >
            {choices.map((choice) => (
              <motion.button
                key={choice.id}
                onClick={() => handleChoiceSelect(choice)}
                disabled={selectedChoiceId && selectedChoiceId !== choice.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                whileHover={{ x: 4 }}
                className={`w-full text-left p-3 border rounded transition-all ${
                  selectedChoiceId === choice.id
                    ? "border-green-400/60 bg-green-400/10 text-green-400"
                    : impactColors[choice.impact_scale] || impactColors.minor
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-mono text-[10px] font-semibold tracking-widest uppercase mb-1">
                      {choice.title}
                    </p>
                    <p className="font-mono text-[9px] opacity-75 leading-relaxed">
                      {choice.description}
                    </p>
                  </div>
                  <span className="text-[8px] font-mono tracking-widest uppercase flex-shrink-0 px-2 py-1 border border-inherit opacity-60">
                    {choice.impact_scale}
                  </span>
                </div>

                {choice.consequence && (
                  <p className="font-mono text-[8px] mt-2 opacity-50 italic">
                    ⚡ {choice.consequence}
                  </p>
                )}
              </motion.button>
            ))}

            <button
              onClick={generateChoices}
              disabled={loading}
              className="w-full mt-2 py-1.5 border border-primary/20 text-primary/50 hover:text-primary/70 disabled:opacity-30 font-mono text-[9px] tracking-widest uppercase transition-all"
            >
              {loading ? "Regenerating..." : "Regenerate Paths"}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}