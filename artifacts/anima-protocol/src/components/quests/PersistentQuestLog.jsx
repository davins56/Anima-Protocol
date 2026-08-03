import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useConfirm } from "@/lib/ConfirmDialog";
import { ChevronDown, Check, X, AlertCircle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function PersistentQuestLog({ sessionId, characterId }) {
  const confirm = useConfirm();
  const [quests, setQuests] = useState([]);
  const [expandedQuestId, setExpandedQuestId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [updatingQuestId, setUpdatingQuestId] = useState(null);

  useEffect(() => {
    if (!sessionId) return;
    loadQuests();

    // Subscribe to quest updates
    const unsubscribe = base44.entities.Quest.subscribe((event) => {
      if (event.data?.session_id === sessionId) {
        loadQuests();
      }
    });

    return unsubscribe;
  }, [sessionId]);

  const loadQuests = async () => {
    try {
      const data = await base44.entities.Quest.filter({
        session_id: sessionId,
        status: { $in: ["available", "active"] },
      }, "-created_date", 50);
      setQuests(data || []);
    } catch (err) {
      console.error("Error loading quests:", err);
    }
  };

  const handleToggleObjective = async (questId, objectiveId) => {
    const quest = quests.find((q) => q.id === questId);
    if (!quest) return;

    setUpdatingQuestId(questId);
    try {
      const updatedObjectives = quest.objectives.map((obj) =>
        obj.id === objectiveId ? { ...obj, completed: !obj.completed } : obj
      );

      const allCompleted = updatedObjectives.every((obj) => obj.completed);

      await base44.entities.Quest.update(questId, {
        objectives: updatedObjectives,
        status: allCompleted ? "completed" : quest.status,
      });

      // Reload to reflect changes
      loadQuests();
    } catch (err) {
      console.error("Error updating objective:", err);
    } finally {
      setUpdatingQuestId(null);
    }
  };

  const handleAbandonQuest = async (questId) => {
    const ok = await confirm({
      title: "Abandon this quest?",
      message: "The quest will be marked as abandoned.",
      confirmLabel: "Abandon",
    });
    if (!ok) return;

    try {
      await base44.entities.Quest.update(questId, { status: "abandoned" });
      setQuests((prev) => prev.filter((q) => q.id !== questId));
    } catch (err) {
      console.error("Error abandoning quest:", err);
    }
  };

  const getProgress = (quest) => {
    if (!quest.objectives || quest.objectives.length === 0) return 0;
    const completed = quest.objectives.filter((obj) => obj.completed).length;
    return (completed / quest.objectives.length) * 100;
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

  if (quests.length === 0) {
    return (
      <div className="border border-primary/15 bg-primary/5 rounded p-3 text-center">
        <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase">
          No active quests
        </p>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="border border-primary/20 bg-black/40 rounded overflow-hidden"
    >
      {/* Header */}
      <div className="px-3 py-2 border-b border-primary/15 bg-primary/10">
        <p className="font-mono text-[9px] text-primary tracking-widest uppercase font-semibold">
          📋 Quest Log ({quests.length})
        </p>
      </div>

      {/* Quests List */}
      <div className="space-y-1.5 p-2 max-h-96 overflow-y-auto">
        {quests.map((quest) => {
          const progress = getProgress(quest);
          const isExpanded = expandedQuestId === quest.id;

          return (
            <motion.div
              key={quest.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="border border-primary/20 bg-black/30 rounded overflow-hidden"
            >
              {/* Quest Header */}
              <button
                onClick={() => setExpandedQuestId(isExpanded ? null : quest.id)}
                className="w-full flex items-start justify-between px-3 py-2 hover:bg-primary/5 transition-colors text-left"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5">
                    <p className="font-mono text-[9px] font-semibold text-primary truncate">
                      {quest.title}
                    </p>
                    <span
                      className={`text-[8px] font-mono tracking-widest uppercase flex-shrink-0 ${getDifficultyColor(
                        quest.difficulty
                      )}`}
                    >
                      {quest.difficulty}
                    </span>
                  </div>

                  {/* Progress Bar */}
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-black/60 rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${progress}%` }}
                        className="h-full bg-gradient-to-r from-primary to-cyan-400"
                      />
                    </div>
                    <span className="text-[8px] font-mono text-primary/60 flex-shrink-0">
                      {Math.round(progress)}%
                    </span>
                  </div>
                </div>

                <ChevronDown
                  className={`w-3 h-3 text-primary/40 ml-2 flex-shrink-0 transition-transform ${
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
                    className="border-t border-primary/10 bg-black/60 px-3 py-2 space-y-2"
                  >
                    {/* Description */}
                    {quest.description && (
                      <p className="font-mono text-[8px] text-primary/60 leading-relaxed">
                        {quest.description}
                      </p>
                    )}

                    {/* Objectives */}
                    <div className="space-y-1">
                      <p className="font-mono text-[8px] text-primary/40 tracking-widest uppercase">
                        Objectives
                      </p>
                      {quest.objectives?.map((obj) => (
                        <div
                          key={obj.id}
                          className="flex items-start gap-2 p-1.5 bg-black/40 border border-primary/10 rounded"
                        >
                          <button
                            onClick={() => handleToggleObjective(quest.id, obj.id)}
                            disabled={updatingQuestId === quest.id}
                            className={`flex-shrink-0 mt-0.5 transition-colors disabled:opacity-50 ${
                              obj.completed
                                ? "text-green-400"
                                : "text-primary/40 hover:text-primary"
                            }`}
                          >
                            {obj.completed ? (
                              <Check className="w-3 h-3" />
                            ) : (
                              <AlertCircle className="w-3 h-3" />
                            )}
                          </button>
                          <span
                            className={`font-mono text-[8px] leading-relaxed flex-1 ${
                              obj.completed
                                ? "text-primary/40 line-through"
                                : "text-primary/70"
                            }`}
                          >
                            {obj.description}
                          </span>
                        </div>
                      ))}
                    </div>

                    {/* Rewards */}
                    {quest.rewards && (
                      <div className="space-y-1 pt-1 border-t border-primary/10">
                        <p className="font-mono text-[8px] text-primary/40 tracking-widest uppercase">
                          Rewards
                        </p>
                        <div className="font-mono text-[8px] text-cyan-400 space-y-0.5">
                          {quest.rewards.xp > 0 && (
                            <p>✨ {quest.rewards.xp} XP</p>
                          )}
                          {quest.rewards.items?.length > 0 && (
                            <p>📦 {quest.rewards.items.length} item(s)</p>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex gap-1.5 pt-2 border-t border-primary/10">
                      <button
                        onClick={() => handleAbandonQuest(quest.id)}
                        disabled={updatingQuestId === quest.id}
                        className="flex-1 px-2 py-1 border border-red-400/30 text-red-400/60 hover:text-red-400 hover:bg-red-400/5 text-[8px] font-mono tracking-widest uppercase transition-colors disabled:opacity-50"
                      >
                        <X className="w-3 h-3 mx-auto" />
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </div>

      {/* Summary */}
      {quests.length > 0 && (
        <div className="px-3 py-1.5 border-t border-primary/15 bg-primary/5">
          <p className="font-mono text-[8px] text-primary/50 text-center">
            {quests.filter((q) => q.status === "active").length} active •{" "}
            {quests.reduce((sum, q) => sum + (q.objectives?.filter((o) => o.completed).length || 0), 0)} /{" "}
            {quests.reduce((sum, q) => sum + (q.objectives?.length || 0), 0)} objectives
          </p>
        </div>
      )}
    </motion.div>
  );
}