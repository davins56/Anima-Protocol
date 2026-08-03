import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Loader, AlertCircle, X } from "lucide-react";

export default function MessageTagSuggestions({ message, characterIds, onApply }) {
  const [suggestions, setSuggestions] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!message || message.length < 3) {
      setSuggestions(null);
      return;
    }

    const analyzeTags = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await base44.functions.invoke("analyzeMessageTags", {
          message,
          character_ids: characterIds || [],
        });
        setSuggestions(res.data.suggestions);
      } catch (err) {
        setError(err.message);
      }
      setLoading(false);
    };

    const timer = setTimeout(analyzeTags, 500);
    return () => clearTimeout(timer);
  }, [message, characterIds]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-[10px] font-mono text-primary/40 py-2">
        <Loader className="w-3 h-3 animate-spin" />
        <span>Scanning narrative links...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 text-[10px] font-mono text-destructive/50 py-2">
        <AlertCircle className="w-3 h-3" />
        <span>Error analyzing tags</span>
      </div>
    );
  }

  if (!suggestions || (suggestions.characters.length === 0 && suggestions.memories.length === 0 && suggestions.storypoints.length === 0)) {
    return null;
  }

  return (
    <div className="space-y-2 py-3 border-t border-primary/10">
      {/* Characters */}
      {suggestions.characters.length > 0 && (
        <div>
          <p className="text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-1.5">Mentioned Characters</p>
          <div className="flex flex-wrap gap-2">
            {suggestions.characters.map((char) => (
              <button
                key={char.id}
                onClick={() => onApply({ type: "character", id: char.id, name: char.name })}
                className="text-[9px] font-mono px-2 py-1 bg-primary/10 border border-primary/30 text-primary/70 hover:text-primary hover:border-primary/60 transition-all rounded"
              >
                {char.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Memories */}
      {suggestions.memories.length > 0 && (
        <div>
          <p className="text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-1.5">Related Lore</p>
          <div className="space-y-1.5">
            {suggestions.memories.map((mem) => (
              <button
                key={mem.id}
                onClick={() => onApply({ type: "memory", id: mem.id, category: mem.category })}
                className="w-full text-left text-[9px] font-mono px-2 py-1.5 bg-primary/5 border border-primary/20 text-primary/70 hover:text-primary hover:border-primary/40 transition-all rounded line-clamp-2"
              >
                <span className="text-primary/50 text-[8px]">[{mem.category}]</span> {mem.fact}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Storypoints */}
      {suggestions.storypoints.length > 0 && (
        <div>
          <p className="text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-1.5">Connected Storypoints</p>
          <div className="space-y-1.5">
            {suggestions.storypoints.map((sp) => (
              <button
                key={sp.id}
                onClick={() => onApply({ type: "storypoint", id: sp.id, title: sp.title })}
                className="w-full text-left text-[9px] font-mono px-2 py-1.5 bg-primary/5 border border-primary/20 text-primary/70 hover:text-primary hover:border-primary/40 transition-all rounded line-clamp-2"
              >
                <span className="font-semibold">{sp.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}