import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { ChevronDown, BookOpen, CheckCircle2, Clock, Zap, Gift, X, AlertCircle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function QuestSidebar({ sessionId, characterId }) {
  const [quests, setQuests] = useState([]);
  const [expandedQuestId, setExpandedQuestId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ active: 0, completed: 0, abandoned: 0 });

  useEffect(() => {
    if (!sessionId) return;
    loadQuests();

    // Subscribe to real-time quest updates
    const unsubscribe = base44.entities.Quest.subscribe((event) => {
      if (event.data?.session_id === sessionId) {
        loadQuests();
      }
    });

    return unsubscribe;
  }, [sessionId]);

  const loadQuests = async () => {
    try {
      const data = await base44.entities.Quest.filter(
        { session_id: sessionId },
        "-created_date",
        100
      );
      
      setQuests(data || []);
      
      // Calculate stats
      const activeCount = data?.filter(q => q.status === "active").length || 0;
      const completedCount = data?.filter(q => q.status === "completed").length || 0;
      const abandonedCount = data?.filter(q => q.status === "abandoned").length || 0;
      
      setStats({ active: activeCount, completed: completedCount, abandoned: abandonedCount });
    } catch (err) {
      console.error("Error loading quests:", err);
    } finally {
      setLoading(false);
    }
  };

  const getQuestIcon = (difficulty) => {
    const icons = {
      trivial: "◇",
      easy: "◈",
      moderate: "◆",
      hard: "◆◆",
      legendary: "◆◆◆",
    };
    return icons[difficulty] || "◆";
  };

  const getDifficultyColor = (difficulty) => {
    const colors = {
      trivial: "text-slate-400",
      easy: "text-green-400",
      moderate: "text-blue-400",
      hard: "text-orange-400",
      legendary: "text-red-400",
    };
    return colors[difficulty] || "text-primary";
  };

  const getProgress = (quest) => {
    if (!quest.objectives?.length) return 0;
    const completed = quest.objectives.filter(obj => obj.completed).length;
    return Math.round((completed / quest.objectives.length) * 100);
  };

  const activeQuests = quests.filter(q => q.status === "active");
  const completedQuests = quests.filter(q => q.status === "completed");

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="h-full flex flex-col border-l border-primary/20 bg-black/60 backdrop-blur-sm overflow-hidden"
    >
      {/* Header */}
      <div className="flex-shrink-0 p-3 border-b border-primary/10 bg-primary/5">
        <div className="flex items-center gap-2 mb-2">
          <BookOpen className="w-4 h-4 text-primary/60" />
          <h2 className="font-mono text-xs text-primary/40 tracking-widest uppercase">
            Quest Log
          </h2>
        </div>
        <div className="grid grid-cols-3 gap-2 text-xs font-mono">
          <div className="text-center">
            <div className="text-primary/70 font-semibold">{stats.active}</div>
            <div className="text-primary/40">Active</div>
          </div>
          <div className="text-center">
            <div className="text-green-400 font-semibold">{stats.completed}</div>
            <div className="text-primary/40">Done</div>
          </div>
          <div className="text-center">
            <div className="text-primary/40 font-semibold">{stats.abandoned}</div>
            <div className="text-primary/40">Abandoned</div>
          </div>
        </div>
      </div>

      {/* Active Quests */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {loading ? (
          <div className="p-4 text-center">
            <div className="w-4 h-4 border-2 border-primary/20 border-t-primary rounded-full animate-spin mx-auto mb-2" />
            <p className="font-mono text-xs text-primary/30 tracking-widest">Loading...</p>
          </div>
        ) : activeQuests.length === 0 ? (
          <div className="p-4 text-center h-full flex items-center justify-center">
            <p className="font-mono text-xs text-primary/20">No active quests</p>
          </div>
        ) : (
          <div className="space-y-1 p-2">
            {activeQuests.map((quest) => {
              const progress = getProgress(quest);
              const isExpanded = expandedQuestId === quest.id;

              return (
                <motion.div
                  key={quest.id}
                  layout
                  className="border border-primary/20 bg-black/40 rounded overflow-hidden"
                >
                  {/* Quest Header */}
                  <button
                    onClick={() =>
                      setExpandedQuestId(isExpanded ? null : quest.id)
                    }
                    className="w-full px-2.5 py-2 hover:bg-primary/5 transition-colors text-left flex items-start justify-between gap-2"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-1">
                        <Clock className="w-3 h-3 text-primary/50 flex-shrink-0" />
                        <p className="font-mono text-xs text-primary/80 truncate uppercase tracking-wider">
                          {quest.title}
                        </p>
                      </div>

                      {/* Progress Bar */}
                      <div className="flex items-center gap-1.5">
                        <div className="flex-1 h-1 bg-black/60 rounded-full overflow-hidden">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${progress}%` }}
                            className="h-full bg-gradient-to-r from-primary to-cyan-400"
                          />
                        </div>
                        <span className="text-xs font-mono text-primary/60 flex-shrink-0">
                          {progress}%
                        </span>
                      </div>
                    </div>

                    <ChevronDown
                      className={`w-3 h-3 text-primary/40 flex-shrink-0 transition-transform ${
                        isExpanded ? "rotate-180" : ""
                      }`}
                    />
                  </button>

                  {/* Quest Details */}
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="border-t border-primary/10 bg-black/80 px-2.5 py-2 space-y-2"
                      >
                        {/* Difficulty & Description */}
                        <div className="flex items-start justify-between gap-2">
                          <span
                            className={`text-xs font-mono tracking-widest uppercase flex-shrink-0 ${getDifficultyColor(
                              quest.difficulty
                            )}`}
                          >
                            {quest.difficulty}
                          </span>
                        </div>

                        {quest.description && (
                          <p className="text-xs font-mono text-primary/60 leading-relaxed">
                            {quest.description}
                          </p>
                        )}

                        {/* Objectives */}
                        {quest.objectives?.length > 0 && (
                          <div className="space-y-1 pt-1 border-t border-primary/10">
                            <p className="text-xs font-mono text-primary/40 tracking-widest uppercase">
                              Objectives
                            </p>
                            {quest.objectives.map((obj) => (
                              <div
                                key={obj.id}
                                className="flex items-start gap-2 text-xs font-mono"
                              >
                                {obj.completed ? (
                                  <CheckCircle2 className="w-3 h-3 text-green-400 flex-shrink-0 mt-0.5" />
                                ) : (
                                  <AlertCircle className="w-3 h-3 text-primary/40 flex-shrink-0 mt-0.5" />
                                )}
                                <span
                                  className={
                                    obj.completed
                                      ? "text-primary/40 line-through"
                                      : "text-primary/70"
                                  }
                                >
                                  {obj.description}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Rewards */}
                        {quest.rewards && (
                          <div className="space-y-1 pt-1 border-t border-primary/10">
                            <div className="flex items-center gap-1.5">
                              <Gift className="w-3 h-3 text-cyan-400" />
                              <p className="text-xs font-mono text-primary/40 tracking-widest uppercase">
                                Rewards
                              </p>
                            </div>
                            <div className="space-y-0.5 text-xs font-mono text-cyan-400/80">
                              {quest.rewards.xp > 0 && (
                                <p>✨ +{quest.rewards.xp} XP</p>
                              )}
                              {quest.rewards.items?.length > 0 && (
                                <p>📦 {quest.rewards.items.length} item(s)</p>
                              )}
                            </div>
                          </div>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer - Completed Summary */}
      {completedQuests.length > 0 && (
        <div className="flex-shrink-0 p-2 border-t border-primary/10 bg-primary/5 text-xs font-mono">
          <p className="text-primary/40 text-center">
            <CheckCircle2 className="w-3 h-3 inline mr-1 text-green-400" />
            {completedQuests.length} quest{completedQuests.length !== 1 ? "s" : ""} completed
          </p>
        </div>
      )}
    </motion.div>
  );
}