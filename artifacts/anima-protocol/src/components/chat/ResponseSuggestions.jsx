import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { motion, AnimatePresence } from "framer-motion";
import { Loader, Sparkles } from "lucide-react";

export default function ResponseSuggestions({
  sessionId,
  characterId,
  recentMessages,
  characterEmotions,
  onSelectSuggestion,
  disabled,
}) {
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!sessionId || !characterId || recentMessages.length < 2) return;

    generateSuggestions();
  }, [sessionId, characterId, recentMessages.length]);

  const generateSuggestions = async () => {
    setLoading(true);
    try {
      const result = await base44.functions.invoke("generateResponseSuggestions", {
        session_id: sessionId,
        character_id: characterId,
        recent_messages: recentMessages.slice(-6),
        emotional_state: characterEmotions[characterId] || {},
      });

      setSuggestions(result?.data?.suggestions || []);
    } catch (err) {
      console.error("Error generating suggestions:", err);
      setSuggestions([]);
    } finally {
      setLoading(false);
    }
  };

  if (loading || suggestions.length === 0) {
    return null;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      className="flex flex-col gap-2 mb-2"
    >
      <div className="flex items-center gap-2 px-4 text-[8px] font-mono text-primary/40 tracking-widest uppercase">
        <Sparkles className="w-3 h-3" />
        <span>Suggested Responses</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 px-4">
        {suggestions.slice(0, 3).map((suggestion, idx) => (
          <motion.button
            key={idx}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.05 }}
            onClick={() => onSelectSuggestion(suggestion.text)}
            disabled={disabled}
            className="text-left px-3 py-2 border border-primary/20 bg-primary/5 hover:bg-primary/10 text-primary/70 hover:text-primary disabled:opacity-50 disabled:cursor-not-allowed font-mono text-[9px] leading-relaxed transition-all rounded"
            title={suggestion.reasoning}
          >
            {suggestion.text}
          </motion.button>
        ))}
      </div>
    </motion.div>
  );
}