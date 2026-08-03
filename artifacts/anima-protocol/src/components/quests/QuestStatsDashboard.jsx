import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { BarChart3, TrendingUp, Award, Zap } from "lucide-react";
import { motion } from "framer-motion";

export default function QuestStatsDashboard({ sessionId, characterId }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStats();
  }, [sessionId, characterId]);

  const loadStats = async () => {
    try {
      const result = await base44.functions.invoke("generateQuestStatistics", {
        session_id: sessionId,
        character_id: characterId,
      });
      if (result?.data?.stats) {
        setStats(result.data.stats);
      }
    } catch (err) {
      console.error("Error loading quest stats:", err);
    } finally {
      setLoading(false);
    }
  };

  if (loading || !stats) return null;

  const statCards = [
    { label: "Total Quests", value: stats.total_quests, icon: Award },
    { label: "Completed", value: stats.completed_quests, icon: TrendingUp },
    { label: "Total XP", value: stats.total_xp, icon: Zap },
    { label: "Completion %", value: `${stats.completion_rate}%`, icon: BarChart3 },
  ];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="border border-primary/20 bg-black/30 rounded p-4 space-y-4"
    >
      <div className="flex items-center gap-2">
        <BarChart3 className="w-4 h-4 text-primary/60" />
        <span className="text-[9px] font-mono text-primary/40 tracking-widest uppercase">
          Quest Statistics
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {statCards.map((card) => {
          const Icon = card.icon;
          return (
            <motion.div
              key={card.label}
              layout
              className="p-3 border border-primary/15 bg-primary/5 rounded text-center"
            >
              <Icon className="w-3.5 h-3.5 text-primary/50 mx-auto mb-1" />
              <p className="text-[10px] font-mono text-primary/90 font-semibold">
                {card.value}
              </p>
              <p className="text-[8px] text-primary/40 mt-0.5">{card.label}</p>
            </motion.div>
          );
        })}
      </div>

      {stats.recent_quests && stats.recent_quests.length > 0 && (
        <div className="pt-3 border-t border-primary/10 space-y-2">
          <p className="text-[8px] font-mono text-primary/30 tracking-widest uppercase">
            Recent Activity
          </p>
          <div className="space-y-1">
            {stats.recent_quests.slice(0, 3).map((quest, idx) => (
              <div key={idx} className="flex items-center justify-between text-[9px]">
                <span className="text-primary/60">{quest.title}</span>
                <span className="text-green-400/70">+{quest.xp_earned} XP</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}