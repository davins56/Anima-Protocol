import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { Loader, Sparkles, CheckCircle2, Circle } from "lucide-react";
import { motion } from "framer-motion";

const difficultyColors = {
  trivial: "text-green-400 border-green-400/30 bg-green-400/5",
  easy: "text-cyan-400 border-cyan-400/30 bg-cyan-400/5",
  moderate: "text-yellow-400 border-yellow-400/30 bg-yellow-400/5",
  hard: "text-orange-400 border-orange-400/30 bg-orange-400/5",
  legendary: "text-red-400 border-red-400/30 bg-red-400/5",
};

const statusColors = {
  available: "border-primary/20 bg-black/40",
  active: "border-cyan-400/40 bg-cyan-400/5",
  completed: "border-green-400/40 bg-green-400/5",
  failed: "border-red-400/40 bg-red-400/5",
  abandoned: "border-primary/15 bg-primary/5",
};

export default function QuestLog() {
  const { sessionId } = useParams();
  const [quests, setQuests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    if (sessionId) {
      loadQuests();
    }
  }, [sessionId]);

  const loadQuests = async () => {
    setLoading(true);
    try {
      const query = sessionId ? { session_id: sessionId } : {};
      const data = await base44.entities.Quest.filter(query, "-created_date", 100);
      setQuests(data || []);
    } catch (err) {
      console.error("Error loading quests:", err);
    } finally {
      setLoading(false);
    }
  };

  const filteredQuests = filter === "all" ? quests : quests.filter((q) => q.status === filter);

  if (loading) {
    return (
      <div className="flex items-center justify-center flex-1 min-h-0 bg-background">
        <div className="text-center">
          <Loader className="w-8 h-8 text-primary/60 animate-spin mx-auto mb-3" />
          <p className="font-mono text-[10px] text-primary/40 tracking-widest uppercase">
            Loading quest log...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-background p-6 lg:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="font-mono text-4xl text-primary tracking-wider glow-text uppercase flex items-center justify-center gap-3">
            <Sparkles className="w-8 h-8" />
            // Quest Log
          </h1>
          <p className="font-mono text-[10px] text-primary/40 tracking-widest">
            {quests.length} QUESTS RECORDED
          </p>
        </div>

        {/* Filter Tabs */}
        <div className="flex gap-2 flex-wrap justify-center">
          {["all", "available", "active", "completed", "failed", "abandoned"].map((status) => (
            <button
              key={status}
              onClick={() => setFilter(status)}
              className={`px-3 py-1.5 font-mono text-[9px] tracking-widest uppercase border transition-all ${
                filter === status
                  ? "bg-primary/10 border-primary/40 text-primary"
                  : "border-primary/20 text-primary/40 hover:text-primary/60 hover:border-primary/30"
              }`}
            >
              {status}
            </button>
          ))}
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Total", value: quests.length, color: "text-primary" },
            { label: "Active", value: quests.filter((q) => q.status === "active").length, color: "text-cyan-400" },
            { label: "Completed", value: quests.filter((q) => q.status === "completed").length, color: "text-green-400" },
            { label: "Available", value: quests.filter((q) => q.status === "available").length, color: "text-yellow-400" },
          ].map((stat) => (
            <div key={stat.label} className="p-3 border border-primary/15 bg-black/40 rounded text-center">
              <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase mb-1">
                {stat.label}
              </p>
              <p className={`font-mono text-2xl font-semibold ${stat.color}`}>{stat.value}</p>
            </div>
          ))}
        </div>

        {/* Quests List */}
        <div className="space-y-3">
          {filteredQuests.length === 0 ? (
            <div className="p-6 border border-primary/15 bg-black/40 rounded text-center">
              <p className="font-mono text-[10px] text-primary/30 tracking-widest uppercase">
                No quests in this category
              </p>
            </div>
          ) : (
            filteredQuests.map((quest, idx) => (
              <motion.div
                key={quest.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.05 }}
                className={`p-4 border rounded transition-all ${statusColors[quest.status]}`}
              >
                {/* Header */}
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`font-mono text-[9px] font-semibold px-2 py-0.5 border rounded ${difficultyColors[quest.difficulty]}`}>
                        {quest.difficulty}
                      </span>
                      <span className={`font-mono text-[9px] tracking-widest uppercase ${
                        quest.status === "active"
                          ? "text-cyan-400"
                          : quest.status === "completed"
                          ? "text-green-400"
                          : "text-primary/50"
                      }`}>
                        {quest.status}
                      </span>
                    </div>
                    <h3 className="font-mono text-sm font-semibold text-primary mb-1">
                      {quest.title}
                    </h3>
                    <p className="font-mono text-[9px] text-primary/60 leading-relaxed">
                      {quest.description.slice(0, 150)}...
                    </p>
                  </div>
                  {quest.rewards?.xp && (
                    <div className="text-right flex-shrink-0">
                      <p className="font-mono text-[9px] text-primary/40 mb-1">Reward</p>
                      <p className="font-mono text-sm font-semibold text-cyan-400">+{quest.rewards.xp} XP</p>
                    </div>
                  )}
                </div>

                {/* Objectives Progress */}
                {quest.objectives && quest.objectives.length > 0 && (
                  <div className="mb-3 p-2 bg-black/30 rounded">
                    <div className="flex items-center gap-2 mb-2">
                      <p className="font-mono text-[8px] text-primary/40 tracking-widest uppercase flex-1">
                        Objectives
                      </p>
                      <span className="font-mono text-[9px] text-primary/60">
                        {quest.objectives.filter((o) => o.completed).length}/{quest.objectives.length}
                      </span>
                    </div>
                    <div className="w-full bg-black/60 h-1.5 rounded overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-primary to-cyan-400 transition-all"
                        style={{ width: `${(quest.objectives.filter((o) => o.completed).length / quest.objectives.length) * 100}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Quest Details */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[9px]">
                  {quest.required_locations && quest.required_locations.length > 0 && (
                    <div>
                      <p className="font-mono text-primary/40 tracking-widest uppercase mb-1">Locations</p>
                      <p className="font-mono text-primary/60">{quest.required_locations.join(", ")}</p>
                    </div>
                  )}
                  {quest.related_characters && quest.related_characters.length > 0 && (
                    <div>
                      <p className="font-mono text-primary/40 tracking-widest uppercase mb-1">Characters</p>
                      <p className="font-mono text-primary/60">{quest.related_characters.join(", ")}</p>
                    </div>
                  )}
                </div>

                {/* Timestamps */}
                {(quest.started_at || quest.completed_at) && (
                  <div className="mt-3 pt-3 border-t border-primary/10 text-[8px] text-primary/40 font-mono">
                    {quest.started_at && (
                      <p>Started: {new Date(quest.started_at).toLocaleDateString()}</p>
                    )}
                    {quest.completed_at && (
                      <p>Completed: {new Date(quest.completed_at).toLocaleDateString()}</p>
                    )}
                  </div>
                )}
              </motion.div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}