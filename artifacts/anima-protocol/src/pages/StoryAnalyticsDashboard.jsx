import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { Loader, BarChart3, TrendingUp, RefreshCw } from "lucide-react";
import { motion } from "framer-motion";
import EmotionalClimatePanel from "@/components/analytics/EmotionalClimatePanel";
import NarrativeToneChart from "@/components/analytics/NarrativeToneChart";

export default function StoryAnalyticsDashboard() {
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get("session");

  const [climateData, setClimateData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [session, setSession] = useState(null);

  useEffect(() => {
    if (sessionId) {
      loadDashboard();
    }
  }, [sessionId]);

  const loadDashboard = async () => {
    setLoading(true);
    try {
      const [sessionData, climateResult] = await Promise.all([
        base44.entities.ChatSession.list("-updated_date", 1).then(sessions =>
          sessions?.find(s => s.id === sessionId)
        ),
        base44.functions.invoke("analyzeEmotionalClimate", { session_id: sessionId }),
      ]);

      setSession(sessionData);
      if (climateResult?.data) {
        setClimateData(climateResult.data);
      }
    } catch (err) {
      console.error("Error loading dashboard:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadDashboard();
    setRefreshing(false);
  };

  if (!sessionId) {
    return (
      <div className="flex-1 min-h-0 bg-background flex items-center justify-center p-4">
        <div className="text-center space-y-4">
          <BarChart3 className="w-12 h-12 text-primary/20 mx-auto" />
          <h2 className="font-mono text-lg text-primary/60 tracking-widest uppercase">
            No Session Selected
          </h2>
          <p className="text-[10px] font-mono text-primary/30 max-w-sm">
            Open a chat session from the sidebar to view its analytics dashboard.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex-1 min-h-0 bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <Loader className="w-8 h-8 text-primary/60 animate-spin mx-auto" />
          <p className="font-mono text-[10px] text-primary/40 tracking-widest uppercase animate-pulse">
            Initializing analytics...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-background p-4 sm:p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-2"
        >
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="font-mono text-2xl sm:text-3xl text-primary glow-text tracking-[0.2em] uppercase">
                // Story Analytics
              </h1>
              {session && (
                <p className="text-[10px] font-mono text-primary/50 mt-1 tracking-widest">
                  {session.title || "Untitled Session"}
                </p>
              )}
            </div>
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className={`p-2 border border-primary/20 hover:border-primary/50 text-primary/40 hover:text-primary transition-all disabled:opacity-50 ${
                refreshing ? "animate-spin" : ""
              }`}
            >
              <RefreshCw className="w-5 h-5" />
            </button>
          </div>
        </motion.div>

        {/* Main Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: Emotional Climate */}
          <div className="lg:col-span-1">
            <EmotionalClimatePanel
              sessionId={sessionId}
              climateData={climateData}
              loading={false}
            />
          </div>

          {/* Right: Tone Chart */}
          <div className="lg:col-span-2">
            <NarrativeToneChart sessionId={sessionId} />
          </div>
        </div>

        {/* Recent Events */}
        {climateData?.recent_events?.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="border border-primary/20 bg-black/30 rounded p-4 space-y-3"
          >
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-primary/60" />
              <h2 className="font-mono text-sm text-primary/80 tracking-widest uppercase">
                Recent Narrative Events
              </h2>
            </div>

            <div className="space-y-2 max-h-64 overflow-y-auto">
              {climateData.recent_events.slice(0, 8).map((event, idx) => (
                <motion.div
                  key={idx}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.05 }}
                  className="p-2.5 bg-black/40 border border-primary/10 rounded flex items-start gap-2"
                >
                  <div className="flex-shrink-0">
                    <span className="inline-block px-1.5 py-0.5 bg-primary/10 border border-primary/20 rounded text-[7px] font-mono text-primary/60 tracking-widest uppercase">
                      {event.category}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[9px] font-mono text-primary/80 font-semibold truncate">
                      {event.subject}
                    </p>
                    <p className="text-[8px] font-mono text-primary/50 line-clamp-2 mt-0.5">
                      {event.fact}
                    </p>
                  </div>
                  {event.importance && (
                    <span className={`text-[7px] font-mono flex-shrink-0 tracking-widest uppercase ${
                      event.importance === 'critical' ? 'text-red-400' :
                      event.importance === 'high' ? 'text-yellow-400' :
                      event.importance === 'medium' ? 'text-cyan-400' :
                      'text-primary/40'
                    }`}>
                      {event.importance}
                    </span>
                  )}
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}

        {/* Footer Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
          {[
            { label: "Total Characters", value: climateData?.emotional_climate?.total_characters || 0 },
            { label: "Avg Intensity", value: `${climateData?.emotional_climate?.average_intensity || 0}/10` },
            { label: "Dominant Mood", value: climateData?.emotional_climate?.dominant_emotion?.toUpperCase() || "—" },
            { label: "Recent Events", value: climateData?.recent_events?.length || 0 },
          ].map((stat, idx) => (
            <motion.div
              key={idx}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 + idx * 0.05 }}
              className="p-3 border border-primary/15 bg-black/40 rounded"
            >
              <p className="text-[8px] font-mono text-primary/40 tracking-widest uppercase mb-1">
                {stat.label}
              </p>
              <p className="text-lg font-mono text-primary/80 font-bold">{stat.value}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}