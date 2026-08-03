import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { ChevronDown, Loader, Sparkles, MapPin, Users } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const difficultyColors = {
  trivial: "text-green-400 border-green-400/30",
  easy: "text-cyan-400 border-cyan-400/30",
  moderate: "text-yellow-400 border-yellow-400/30",
  hard: "text-orange-400 border-orange-400/30",
  legendary: "text-red-400 border-red-400/30",
};

export default function QuestPanel({ sessionId, characterId }) {
  const [quests, setQuests] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expandedQuest, setExpandedQuest] = useState(null);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    if (sessionId) {
      loadQuests();
    }
  }, [sessionId]);

  const loadQuests = async () => {
    try {
      const data = await base44.entities.Quest.filter({ session_id: sessionId }, "-created_date", 20);
      setQuests(data || []);
    } catch (err) {
      console.error("Error loading quests:", err);
    }
  };

  const handleGenerateQuests = async () => {
    setGenerating(true);
    try {
      const result = await base44.functions.invoke("generateSessionQuests", {
        session_id: sessionId,
        character_id: characterId,
      });
      if (result?.data?.quests) {
        setQuests((prev) => [...prev, ...result.data.quests]);
      }
    } catch (err) {
      console.error("Error generating quests:", err);
    } finally {
      setGenerating(false);
    }
  };

  const handleActivateQuest = async (questId) => {
    try {
      await base44.entities.Quest.update(questId, { status: "active", started_at: new Date().toISOString() });
      setQuests((prev) => prev.map((q) => (q.id === questId ? { ...q, status: "active", started_at: new Date().toISOString() } : q)));
    } catch (err) {
      console.error("Error activating quest:", err);
    }
  };

  const activeQuests = quests.filter((q) => q.status === "active");
  const availableQuests = quests.filter((q) => q.status === "available");

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border border-primary/15 bg-primary/5 rounded">
        <div className="flex items-center gap-2">
          <Sparkles className="w-3.5 h-3.5 text-primary/60" />
          <span className="font-mono text-[9px] text-primary/40 tracking-widest uppercase">
            Quests ({quests.length})
          </span>
        </div>
        <button
          onClick={handleGenerateQuests}
          disabled={generating}
          className="text-[8px] font-mono text-primary/50 hover:text-primary/80 transition-colors disabled:opacity-50"
        >
          {generating ? "Generating..." : "New Quests"}
        </button>
      </div>

      {/* Active Quests */}
      {activeQuests.length > 0 && (
        <div className="space-y-2">
          <p className="text-[9px] font-mono text-primary/40 tracking-widest uppercase px-1">
            Active ({activeQuests.length})
          </p>
          {activeQuests.map((quest) => (
            <QuestCard key={quest.id} quest={quest} isExpanded={expandedQuest === quest.id} onToggle={() => setExpandedQuest(expandedQuest === quest.id ? null : quest.id)} />
          ))}
        </div>
      )}

      {/* Available Quests */}
      {availableQuests.length > 0 && (
        <div className="space-y-2">
          <p className="text-[9px] font-mono text-primary/40 tracking-widest uppercase px-1">
            Available ({availableQuests.length})
          </p>
          {availableQuests.map((quest) => (
            <QuestCard key={quest.id} quest={quest} isExpanded={expandedQuest === quest.id} onToggle={() => setExpandedQuest(expandedQuest === quest.id ? null : quest.id)} onActivate={() => handleActivateQuest(quest.id)} />
          ))}
        </div>
      )}

      {quests.length === 0 && !generating && (
        <div className="p-3 border border-primary/10 bg-black/30 rounded text-center">
          <p className="font-mono text-[9px] text-primary/30 tracking-widest uppercase">
            No quests yet
          </p>
          <button
            onClick={handleGenerateQuests}
            className="mt-2 text-[9px] font-mono text-primary/60 hover:text-primary transition-colors"
          >
            Generate quests
          </button>
        </div>
      )}
    </div>
  );
}

function QuestCard({ quest, isExpanded, onToggle, onActivate }) {
  const completedObjectives = quest.objectives?.filter((o) => o.completed).length || 0;
  const totalObjectives = quest.objectives?.length || 0;
  const progressPercent = totalObjectives > 0 ? (completedObjectives / totalObjectives) * 100 : 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="border border-primary/15 bg-black/40 rounded overflow-hidden hover:bg-black/60 transition-colors"
    >
      <button
        onClick={onToggle}
        className="w-full p-3 flex items-start justify-between gap-2"
      >
        <div className="flex-1 text-left min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <p className={`font-mono text-[9px] font-semibold ${difficultyColors[quest.difficulty]} border px-1.5 py-0.5`}>
              {quest.difficulty}
            </p>
            <p className={`font-mono text-[9px] text-primary/40 ${quest.status === "active" ? "text-cyan-400" : ""}`}>
              {quest.status}
            </p>
          </div>
          <p className="font-mono text-xs text-primary font-semibold mb-2">
            {quest.title}
          </p>
          {quest.status === "active" && totalObjectives > 0 && (
            <div className="w-full bg-black/40 h-1.5 rounded overflow-hidden mb-2">
              <div
                className="h-full bg-gradient-to-r from-primary to-cyan-400 transition-all"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          )}
          <p className="font-mono text-[8px] text-primary/50">
            {completedObjectives}/{totalObjectives} objectives
          </p>
        </div>
        <ChevronDown
          className={`w-3 h-3 text-primary/40 flex-shrink-0 transition-transform ${isExpanded ? "rotate-180" : ""}`}
        />
      </button>

      {/* Expanded Content */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="px-3 py-3 border-t border-primary/10 bg-black/30 space-y-3"
          >
            {/* Description */}
            <p className="font-mono text-[9px] text-primary/60 leading-relaxed">
              {quest.description}
            </p>

            {/* Objectives */}
            {quest.objectives && quest.objectives.length > 0 && (
              <div className="space-y-1">
                <p className="font-mono text-[8px] text-primary/40 tracking-widest uppercase">Objectives</p>
                {quest.objectives.map((obj, idx) => (
                  <div key={idx} className="flex items-start gap-2 text-[9px]">
                    <span className={`mt-0.5 ${obj.completed ? "text-green-400" : "text-primary/40"}`}>
                      {obj.completed ? "✓" : "○"}
                    </span>
                    <span className={`font-mono ${obj.completed ? "text-primary/50 line-through" : "text-primary/60"}`}>
                      {obj.description}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Locations */}
            {quest.required_locations && quest.required_locations.length > 0 && (
              <div className="flex items-start gap-2">
                <MapPin className="w-3 h-3 text-primary/40 flex-shrink-0 mt-0.5" />
                <p className="font-mono text-[8px] text-primary/50">
                  {quest.required_locations.join(", ")}
                </p>
              </div>
            )}

            {/* Characters */}
            {quest.related_characters && quest.related_characters.length > 0 && (
              <div className="flex items-start gap-2">
                <Users className="w-3 h-3 text-primary/40 flex-shrink-0 mt-0.5" />
                <p className="font-mono text-[8px] text-primary/50">
                  {quest.related_characters.join(", ")}
                </p>
              </div>
            )}

            {/* Rewards */}
            {quest.rewards && (
              <div className="p-2 bg-primary/5 border border-primary/15 rounded space-y-1">
                <p className="font-mono text-[8px] text-primary/40 tracking-widest uppercase">Rewards</p>
                {quest.rewards.xp > 0 && (
                  <p className="font-mono text-[9px] text-cyan-400">+{quest.rewards.xp} XP</p>
                )}
                {quest.rewards.items && quest.rewards.items.length > 0 && (
                  <p className="font-mono text-[9px] text-yellow-400">{quest.rewards.items.join(", ")}</p>
                )}
              </div>
            )}

            {/* Action Buttons */}
            {quest.status === "available" && onActivate && (
              <button
                onClick={onActivate}
                className="w-full py-1.5 border border-primary/30 bg-primary/10 text-primary hover:bg-primary/20 font-mono text-[9px] tracking-widest uppercase transition-all"
              >
                Accept Quest
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}