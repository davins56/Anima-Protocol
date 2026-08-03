import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Zap, Trophy, Clock } from "lucide-react";
import { motion } from "framer-motion";

export default function SpecialQuestPanel({ sessionId }) {
  const [specialQuests, setSpecialQuests] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSpecialQuests();
    const interval = setInterval(loadSpecialQuests, 3600000); // Refresh hourly
    return () => clearInterval(interval);
  }, [sessionId]);

  const loadSpecialQuests = async () => {
    try {
      const result = await base44.functions.invoke("generateSpecialQuests", {
        session_id: sessionId,
        type: "daily_weekly",
      });
      if (result?.data?.quests) {
        setSpecialQuests(result.data.quests);
      }
    } catch (err) {
      console.error("Error loading special quests:", err);
    } finally {
      setLoading(false);
    }
  };

  if (loading || specialQuests.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="border border-yellow-400/30 bg-yellow-400/5 rounded p-3 space-y-2"
    >
      <div className="flex items-center gap-2">
        <Trophy className="w-4 h-4 text-yellow-400" />
        <span className="text-[9px] font-mono text-yellow-400 tracking-widest uppercase">
          Special Challenges
        </span>
      </div>

      <div className="grid gap-2">
        {specialQuests.map((quest) => (
          <motion.div
            key={quest.id}
            layout
            className="p-2.5 border border-yellow-400/20 bg-black/30 hover:bg-yellow-400/10 rounded transition-colors"
          >
            <div className="flex items-start justify-between gap-2 mb-1">
              <div className="flex-1">
                <p className="text-[9px] font-mono text-yellow-400/90 font-semibold">
                  {quest.title}
                </p>
                <p className="text-[8px] text-yellow-400/60 mt-0.5">
                  {quest.description}
                </p>
              </div>
              <div className="flex items-center gap-1 px-2 py-1 bg-yellow-400/10 border border-yellow-400/20 rounded text-[8px] font-mono text-yellow-400 flex-shrink-0">
                <Zap className="w-2.5 h-2.5" />
                +{quest.bonus_xp}
              </div>
            </div>

            {quest.expires_in && (
              <div className="flex items-center gap-1 text-[8px] text-yellow-400/50">
                <Clock className="w-2.5 h-2.5" />
                {quest.expires_in}
              </div>
            )}
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}