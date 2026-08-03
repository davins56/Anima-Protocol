import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Sparkles, BookOpen, Heart, Loader, ChevronDown } from "lucide-react";

export default function SessionSummary({ sessionId, characterId }) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (sessionId && expanded) {
      loadSummary();
    }
  }, [sessionId, expanded]);

  const loadSummary = async () => {
    setLoading(true);
    try {
      const [lore, evolution] = await Promise.all([
        base44.functions.invoke("extractLore", {
          session_id: sessionId,
          extract_summary: true,
        }).catch(() => ({ data: { facts: [] } })),
        characterId
          ? base44.functions.invoke("trackCharacterEvolution", {
              character_id: characterId,
              session_id: sessionId,
            }).catch(() => ({ data: { current_state: null, changes: [] } }))
          : Promise.resolve({ data: { current_state: null, changes: [] } }),
      ]);

      const facts = lore?.data?.facts || [];
      const evolution_data = evolution?.data || {};

      // Group lore by importance
      const critical = facts.filter(f => f.importance === "critical").slice(0, 3);
      const other = facts.filter(f => f.importance !== "critical").slice(0, 2);

      setSummary({
        key_facts: [...critical, ...other],
        character_state: evolution_data.current_state,
        recent_changes: evolution_data.changes?.slice(0, 3) || [],
      });
    } catch (err) {
      console.error("Error loading session summary:", err);
    } finally {
      setLoading(false);
    }
  };

  if (!summary && !expanded) return null;

  return (
    <div className="border-t border-primary/10 bg-primary/5 mt-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-3 py-2 flex items-center justify-between hover:bg-primary/10 transition-colors text-left"
      >
        <div className="flex items-center gap-1.5">
          <Sparkles className="w-3 h-3 text-primary/50 flex-shrink-0" />
          <span className="font-mono text-xs text-primary/50 tracking-widest uppercase">Summary</span>
        </div>
        <ChevronDown
          className={`w-3 h-3 text-primary/30 transition-transform ${expanded ? "rotate-180" : ""}`}
        />
      </button>

      {expanded && (
        <div className="px-3 py-2 space-y-2 border-t border-primary/10">
          {loading ? (
            <div className="flex items-center gap-1.5 py-2">
              <Loader className="w-2.5 h-2.5 text-primary/30 animate-spin" />
              <p className="font-mono text-xs text-primary/30 tracking-widest">Loading...</p>
            </div>
          ) : summary ? (
            <>
              {/* Key Lore Facts */}
              {summary.key_facts?.length > 0 && (
                <div>
                  <p className="font-mono text-xs text-primary/40 tracking-widest uppercase mb-1">
                    Key Facts
                  </p>
                  <div className="space-y-1">
                    {summary.key_facts.slice(0, 3).map((fact, idx) => (
                      <div
                        key={idx}
                        className="text-xs font-mono text-primary/50 leading-relaxed pl-2 border-l border-primary/20 py-0.5"
                      >
                        <span className="text-primary/70">{fact.subject}:</span> {fact.fact.slice(0, 40)}...
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Character State */}
              {summary.character_state && (
                <div>
                  <div className="flex items-center gap-1.5 mb-1">
                    <Heart className="w-2.5 h-2.5 text-primary/40" />
                    <p className="font-mono text-xs text-primary/40 tracking-widest uppercase">Emotional</p>
                  </div>
                  <div className="px-2 py-1 bg-black/40 border border-primary/10">
                    <p className="font-mono text-xs text-primary/60 uppercase tracking-wider">
                      {summary.character_state.emotion || "Neutral"}
                    </p>
                    {summary.character_state.intensity && (
                      <div className="w-full h-0.5 bg-primary/10 mt-0.5 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary/50"
                          style={{ width: `${(summary.character_state.intensity / 10) * 100}%` }}
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Recent Changes */}
              {summary.recent_changes?.length > 0 && (
                <div>
                  <p className="font-mono text-xs text-primary/40 tracking-widest uppercase mb-1">
                    Evolution
                  </p>
                  <div className="space-y-0.5">
                    {summary.recent_changes.map((change, idx) => (
                      <p
                        key={idx}
                        className="text-xs font-mono text-primary/40 leading-relaxed italic"
                      >
                        • {change}
                      </p>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}