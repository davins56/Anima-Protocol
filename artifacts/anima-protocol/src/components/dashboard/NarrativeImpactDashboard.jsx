import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { base44 } from "@/api/base44Client";
import { Zap, Target, Users, TrendingUp, ChevronDown, ChevronUp, AlertCircle } from "lucide-react";

export default function NarrativeImpactDashboard({ sessionId, characterId, characters, messages = [] }) {
  const [expanded, setExpanded] = useState(true);
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(false);
  const [influenceScores, setInfluenceScores] = useState({});
  const [questStatus, setQuestStatus] = useState([]);

  useEffect(() => {
    if (!sessionId) return;
    loadDashboardData();
  }, [sessionId, messages.length]);

  const loadDashboardData = async () => {
    setLoading(true);
    try {
      const [evolutionRes, questRes] = await Promise.all([
        base44.functions.invoke("worldEvolutionOrchestrator", { session_id: sessionId, force: false }),
        base44.functions.invoke("getActiveQuests", { session_id: sessionId }),
      ]);

      if (evolutionRes?.data?.evolution) {
        setMetrics(evolutionRes.data.evolution);
      }

      if (questRes?.data?.quests) {
        setQuestStatus(questRes.data.quests);
      }

      // Calculate influence scores for visible characters
      if (characterId && characters.length > 0) {
        const scores = {};
        for (const char of characters.slice(0, 5)) {
          try {
            const res = await base44.functions.invoke("calculateInfluenceScores", {
              character_id: char.id,
              session_id: sessionId,
            });
            if (res?.data?.influence_score) {
              scores[char.id] = res.data.influence_score;
            }
          } catch {}
        }
        setInfluenceScores(scores);
      }
    } catch (err) {
      console.error("Dashboard load error:", err);
    } finally {
      setLoading(false);
    }
  };

  if (!sessionId) return null;

  const worldChanges = metrics?.world_changes || [];
  const messageCount = messages?.length || 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="border border-primary/20 bg-black/40 rounded overflow-hidden"
    >
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 sm:px-4 py-2.5 sm:py-3 bg-primary/5 border-b border-primary/10 hover:bg-primary/10 transition-colors"
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Zap className="w-4 h-4 text-primary flex-shrink-0" />
          <span className="font-mono text-[9px] sm:text-xs text-primary tracking-widest uppercase">
            Narrative Impact
          </span>
          <span className="font-mono text-[8px] text-primary/40 ml-auto sm:ml-2">
            {messageCount} messages
          </span>
        </div>
        {expanded ? (
          <ChevronUp className="w-3.5 h-3.5 text-primary/50 flex-shrink-0 ml-1" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 text-primary/50 flex-shrink-0 ml-1" />
        )}
      </button>

      {/* Content */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="space-y-3 sm:space-y-4 p-3 sm:p-4 text-[9px] sm:text-[10px] font-mono"
          >
            {/* World Evolution Metrics */}
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-primary/60 tracking-widest uppercase">
                <TrendingUp className="w-3.5 h-3.5" />
                <span>World Evolution</span>
              </div>

              {loading ? (
                <div className="text-primary/30 italic">Loading metrics...</div>
              ) : worldChanges.length > 0 ? (
                <div className="space-y-1.5 bg-black/40 border border-primary/10 rounded p-2 max-h-32 overflow-y-auto">
                  {worldChanges.slice(0, 4).map((change, i) => (
                    <div key={i} className="flex items-start gap-1.5 text-primary/70">
                      <span className="text-primary/40 flex-shrink-0">→</span>
                      <span className="leading-tight">
                        <span className="text-primary/80">[{change.type.replace(/_/g, " ")}]</span>
                        {" " + (change.affected_entity || change.description || "World shift")}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-primary/30">No world changes detected yet</div>
              )}
            </div>

            {/* Quest Status */}
            {questStatus.length > 0 && (
              <div className="space-y-2 pt-2 border-t border-primary/10">
                <div className="flex items-center gap-2 text-primary/60 tracking-widest uppercase">
                  <Target className="w-3.5 h-3.5" />
                  <span>Active Quests ({questStatus.length})</span>
                </div>
                <div className="space-y-1 bg-black/40 border border-primary/10 rounded p-2 max-h-32 overflow-y-auto">
                  {questStatus.map((quest, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-primary/80 truncate font-mono text-[8px] sm:text-[9px]">
                          {quest.title || `Quest ${i + 1}`}
                        </div>
                        {quest.objectives && (
                          <div className="text-primary/40 text-[8px] mt-0.5">
                            {quest.objectives.filter(o => o.completed).length}/{quest.objectives.length} objectives
                          </div>
                        )}
                      </div>
                      <div className="flex-shrink-0 w-6 h-1 bg-primary/10 rounded-full overflow-hidden">
                        <motion.div
                          className="h-full bg-primary/60"
                          initial={{ width: 0 }}
                          animate={{ width: quest.objectives ? `${(quest.objectives.filter(o => o.completed).length / quest.objectives.length) * 100}%` : 0 }}
                          transition={{ duration: 0.4 }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Character Influence Scores */}
            {Object.keys(influenceScores).length > 0 && (
              <div className="space-y-2 pt-2 border-t border-primary/10">
                <div className="flex items-center gap-2 text-primary/60 tracking-widest uppercase">
                  <Users className="w-3.5 h-3.5" />
                  <span>Influence Scores</span>
                </div>
                <div className="space-y-1.5 bg-black/40 border border-primary/10 rounded p-2">
                  {characters
                    .filter(c => influenceScores[c.id] !== undefined)
                    .slice(0, 4)
                    .map((char) => {
                      const score = influenceScores[char.id] || 0;
                      const normalized = Math.min(100, Math.max(0, (score / 100) * 100));
                      return (
                        <div key={char.id} className="space-y-0.5">
                          <div className="flex items-center justify-between">
                            <span className="text-primary/70 truncate text-[8px] sm:text-[9px]">
                              {char.name}
                            </span>
                            <span className="text-primary/50 text-[8px] ml-1 flex-shrink-0">
                              {Math.round(score)}
                            </span>
                          </div>
                          <div className="w-full h-1 bg-primary/10 rounded-full overflow-hidden">
                            <motion.div
                              className="h-full bg-gradient-to-r from-primary/40 to-primary/80"
                              initial={{ width: 0 }}
                              animate={{ width: `${normalized}%` }}
                              transition={{ duration: 0.5 }}
                            />
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}

            {/* Impact Summary */}
            <div className="pt-2 border-t border-primary/10 text-primary/50 text-[8px] space-y-1">
              <p>
                Your narrative choices shift the world. {messageCount} messages have influenced {worldChanges.length} world elements.
              </p>
              {loading && (
                <div className="flex items-center gap-1.5 text-primary/40 animate-pulse">
                  <AlertCircle className="w-3 h-3" />
                  Updating metrics...
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}