import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { ChevronLeft, ChevronRight, Loader, Zap } from "lucide-react";
import { motion } from "framer-motion";

const SEASONS = {
  spring: { emoji: "🌱", color: "text-green-400", bg: "bg-green-400/10" },
  summer: { emoji: "☀️", color: "text-yellow-400", bg: "bg-yellow-400/10" },
  autumn: { emoji: "🍂", color: "text-orange-400", bg: "bg-orange-400/10" },
  winter: { emoji: "❄️", color: "text-cyan-400", bg: "bg-cyan-400/10" },
};

const WEATHER = {
  clear: "☀️ Clear",
  cloudy: "☁️ Cloudy",
  rainy: "🌧️ Rainy",
  snowy: "❄️ Snowy",
  stormy: "⛈️ Stormy",
};

export default function IntegratedWorldCalendar() {
  const { sessionId } = useParams();
  const [calendar, setCalendar] = useState(null);
  const [worldEvents, setWorldEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    loadCalendarData();
    const interval = setInterval(loadCalendarData, 5000); // Sync every 5 seconds
    return () => clearInterval(interval);
  }, [sessionId]);

  const loadCalendarData = async () => {
    try {
      const cals = await base44.entities.Calendar.filter(
        sessionId ? { session_id: sessionId } : {}
      );
      if (cals?.length > 0) {
        setCalendar(cals[0]);
      }

      const events = await base44.entities.WorldState.filter(
        sessionId ? { session_id: sessionId, importance: "critical" } : { importance: "critical" },
        "-created_date",
        20
      );
      setWorldEvents(events || []);
      setLoading(false);
    } catch (err) {
      console.error("Error loading calendar data:", err);
      setLoading(false);
    }
  };

  const handleAdvanceDay = async () => {
    if (!calendar || !sessionId) return;
    setSyncing(true);
    try {
      await base44.functions.invoke("updateSeasonalContext", {
        session_id: sessionId,
        user_message: "[Manual day advancement]",
        ai_response: "[Day advanced]",
        message_index: 0,
      });
      await loadCalendarData();
    } catch (err) {
      console.error("Error advancing day:", err);
    } finally {
      setSyncing(false);
    }
  };

  const seasonData = calendar ? SEASONS[calendar.current_season] : null;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-center">
          <Loader className="w-8 h-8 text-primary/60 animate-spin mx-auto mb-3" />
          <p className="font-mono text-[10px] text-primary/40 tracking-widest uppercase">
            Loading world calendar...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-6 lg:p-8">
      <div className="max-w-6xl mx-auto space-y-8">
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="font-mono text-4xl text-primary tracking-wider glow-text uppercase">
            // World Calendar
          </h1>
          <p className="font-mono text-[10px] text-primary/40 tracking-widest">
            {calendar ? "TRACKING NARRATIVE TIME & SEASONS" : "AWAITING CHRONOLOGICAL DATA"}
          </p>
        </div>

        {calendar && (
          <>
            {/* Main Calendar Card */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className={`border ${seasonData.color} border-opacity-30 ${seasonData.bg} rounded-lg p-8 space-y-6`}
            >
              {/* Season Display */}
              <div className="text-center space-y-3">
                <div className="text-6xl">{seasonData.emoji}</div>
                <h2 className={`font-mono text-3xl tracking-wider uppercase ${seasonData.color}`}>
                  {calendar.current_season}
                </h2>
                {calendar.seasonal_description && (
                  <p className="font-mono text-[10px] text-primary/60 max-w-2xl mx-auto leading-relaxed">
                    {calendar.seasonal_description}
                  </p>
                )}
              </div>

              {/* Calendar Stats Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="p-4 bg-black/40 border border-primary/20 rounded text-center">
                  <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase mb-1">
                    Days Elapsed
                  </p>
                  <p className="font-mono text-2xl text-primary">{calendar.days_elapsed}</p>
                </div>

                <div className="p-4 bg-black/40 border border-primary/20 rounded text-center">
                  <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase mb-1">
                    Day of Season
                  </p>
                  <p className="font-mono text-2xl text-primary">{calendar.day_of_season}/90</p>
                </div>

                <div className="p-4 bg-black/40 border border-primary/20 rounded text-center">
                  <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase mb-1">
                    Weather
                  </p>
                  <p className="font-mono text-xl text-primary">
                    {WEATHER[calendar.weather] || calendar.weather}
                  </p>
                </div>

                <div className="p-4 bg-black/40 border border-primary/20 rounded text-center">
                  <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase mb-1">
                    Season Progress
                  </p>
                  <div className="w-full bg-black/40 h-2 rounded overflow-hidden mt-2">
                    <div
                      className="h-full bg-gradient-to-r from-primary to-cyan-400"
                      style={{ width: `${(calendar.day_of_season / 90) * 100}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Controls */}
              <div className="flex justify-center">
                <button
                  onClick={handleAdvanceDay}
                  disabled={syncing}
                  className="px-6 py-2 border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50 font-mono text-xs tracking-widest uppercase transition-all flex items-center gap-2"
                >
                  {syncing ? <Loader className="w-3 h-3 animate-spin" /> : <ChevronRight className="w-3 h-3" />}
                  {syncing ? "Advancing..." : "Advance Day"}
                </button>
              </div>
            </motion.div>

            {/* World Events Timeline */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="space-y-4"
            >
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-yellow-400" />
                <h3 className="font-mono text-primary tracking-widest uppercase text-sm">
                  Critical World Events ({worldEvents.length})
                </h3>
              </div>

              <div className="space-y-3">
                {worldEvents.length === 0 ? (
                  <div className="p-6 border border-primary/15 bg-black/40 rounded text-center">
                    <p className="font-mono text-[10px] text-primary/40 tracking-widest uppercase">
                      No critical events recorded
                    </p>
                  </div>
                ) : (
                  worldEvents.map((event, idx) => (
                    <motion.div
                      key={event.id}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: idx * 0.05 }}
                      className="p-4 border border-primary/20 bg-black/40 rounded hover:bg-black/60 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="font-mono text-[9px] text-primary/60 tracking-widest uppercase">
                              {event.category}
                            </span>
                            <span className={`font-mono text-[8px] px-2 py-0.5 rounded border ${
                              event.importance === "critical"
                                ? "border-red-400/50 text-red-400"
                                : "border-primary/30 text-primary/50"
                            }`}>
                              {event.importance}
                            </span>
                          </div>
                          <h4 className="font-mono text-sm text-primary font-semibold mb-1">
                            {event.subject}
                          </h4>
                          <p className="font-mono text-[9px] text-primary/60 leading-relaxed">
                            {event.fact.slice(0, 100)}...
                          </p>
                        </div>
                        <div className="text-[9px] font-mono text-primary/40 flex-shrink-0">
                          {new Date(event.created_date).toLocaleDateString()}
                        </div>
                      </div>
                    </motion.div>
                  ))
                )}
              </div>
            </motion.div>

            {/* Seasonal Cycle Info */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="grid grid-cols-1 md:grid-cols-4 gap-4"
            >
              {Object.entries(SEASONS).map(([season, data]) => (
                <div
                  key={season}
                  className={`p-4 border rounded transition-all ${
                    calendar.current_season === season
                      ? `${data.color} border-opacity-60 ${data.bg}`
                      : "border-primary/15 bg-black/40 text-primary/40"
                  }`}
                >
                  <div className="text-3xl mb-2">{data.emoji}</div>
                  <p className="font-mono text-xs tracking-widest uppercase font-semibold capitalize mb-1">
                    {season}
                  </p>
                  <p className="font-mono text-[9px] text-opacity-60">
                    {season === "spring" && "Growth & renewal"}
                    {season === "summer" && "Peak activity"}
                    {season === "autumn" && "Transition & harvest"}
                    {season === "winter" && "Dormancy & hardship"}
                  </p>
                </div>
              ))}
            </motion.div>
          </>
        )}
      </div>
    </div>
  );
}