import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Zap, TrendingUp, AlertCircle, Loader } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function WorldEvolutionStatus({ sessionId }) {
  const [evolutionData, setEvolutionData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [messagesSinceEvolution, setMessagesSinceEvolution] = useState(0);

  useEffect(() => {
    if (!sessionId) return;
    trackEvolution();
    
    const interval = setInterval(trackEvolution, 30000); // Check every 30s
    return () => clearInterval(interval);
  }, [sessionId]);

  const trackEvolution = async () => {
    try {
      const sessions = await base44.entities.ChatSession.list("-updated_date", 1);
      const session = sessions?.find(s => s.id === sessionId);
      
      if (!session) return;

      const messageCount = session.messages?.length || 0;
      const lastEvolution = session.last_world_evolution || 0;
      const msgSinceEvolution = messageCount - lastEvolution;

      setMessagesSinceEvolution(msgSinceEvolution);

      // Auto-trigger if threshold reached (5+ messages since evolution)
      if (msgSinceEvolution >= 5 && Math.random() < 0.3) {
        setLoading(true);
        const result = await base44.functions.invoke("worldEvolutionOrchestrator", {
          session_id: sessionId,
          force: false,
        });
        
        if (result?.data && !result?.data?.skipped) {
          setEvolutionData(result.data);
          // Clear after 8 seconds
          setTimeout(() => setEvolutionData(null), 8000);
        }
        setLoading(false);
      }
    } catch (err) {
      console.error("Error tracking evolution:", err);
    }
  };

  return (
    <AnimatePresence>
      {(loading || evolutionData) && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          className="border border-green-400/30 bg-green-400/5 rounded p-3 mb-4"
        >
          <div className="flex items-start gap-3">
            {loading ? (
              <>
                <Loader className="w-4 h-4 text-green-400 animate-spin flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="font-mono text-[9px] text-green-400 tracking-widest uppercase mb-1">
                    World Evolution Triggered
                  </p>
                  <p className="font-mono text-[8px] text-green-400/60">
                    Analyzing narrative progression...
                  </p>
                </div>
              </>
            ) : evolutionData ? (
              <>
                <Zap className="w-4 h-4 text-green-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <p className="font-mono text-[9px] text-green-400 tracking-widest uppercase">
                      World Evolution
                    </p>
                    {evolutionData.intensity_level > 2 && (
                      <span className="text-[8px] font-mono text-orange-400 px-1.5 py-0.5 border border-orange-400/30 bg-orange-400/10 rounded">
                        Intensity: {evolutionData.intensity_level}
                      </span>
                    )}
                  </div>
                  
                  {evolutionData.evolution?.world_changes && (
                    <div className="space-y-1.5 mb-2">
                      {evolutionData.evolution.world_changes.slice(0, 2).map((change, idx) => (
                        <p key={idx} className="font-mono text-[8px] text-green-400/70 leading-relaxed">
                          🌍 {change}
                        </p>
                      ))}
                    </div>
                  )}

                  {evolutionData.event?.title && (
                    <div className="p-2 border border-green-400/20 bg-black/30 rounded mt-2">
                      <p className="font-mono text-[9px] text-green-400 font-semibold mb-0.5">
                        ⚡ {evolutionData.event.title}
                      </p>
                      <p className="font-mono text-[8px] text-green-400/60">
                        {evolutionData.event.description?.slice(0, 100)}...
                      </p>
                    </div>
                  )}

                  <p className="font-mono text-[8px] text-green-400/40 mt-2">
                    Emotional average: {evolutionData.emotion_average}% • Progression: {evolutionData.session_state?.messages_processed} messages
                  </p>
                </div>
              </>
            ) : null}
          </div>

          {/* Progress bar for next evolution */}
          {!loading && messagesSinceEvolution > 0 && messagesSinceEvolution < 5 && (
            <div className="mt-2 h-1 bg-green-400/10 rounded overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-green-400/40 to-green-400 transition-all duration-500"
                style={{ width: `${(messagesSinceEvolution / 5) * 100}%` }}
              />
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}