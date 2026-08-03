import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { Calendar, ChevronLeft, ChevronRight, Loader, AlertCircle, Clock } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const SEASONS = {
  spring: { label: "Spring", color: "#51cf66", emoji: "🌱", description: "Growth and renewal" },
  summer: { label: "Summer", color: "#ffd43b", emoji: "☀️", description: "Warmth and abundance" },
  autumn: { label: "Autumn", color: "#ff922b", emoji: "🍂", description: "Harvest and change" },
  winter: { label: "Winter", color: "#74c0fc", emoji: "❄️", description: "Cold and reflection" },
};

const WEATHER_ICONS = {
  clear: "☀️",
  cloudy: "☁️",
  rainy: "🌧️",
  snowy: "❄️",
  stormy: "⛈️",
};

export default function WorldCalendarDashboard() {
  const { sessionId } = useParams();
  const [calendar, setCalendar] = useState(null);
  const [worldEvents, setWorldEvents] = useState([]);
  const [characters, setCharacters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(null);
  const [expandedEvent, setExpandedEvent] = useState(null);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 10000); // Auto-refresh every 10s
    return () => clearInterval(interval);
  }, [sessionId]);

  const loadData = async () => {
    try {
      const [calendarData, eventsData, characterData] = await Promise.all([
        sessionId
          ? base44.entities.Calendar.filter({ session_id: sessionId }, "-updated_date", 1)
          : base44.entities.Calendar.list("-updated_date", 1),
        sessionId
          ? base44.entities.WorldState.filter({ session_id: sessionId }, "-created_date", 50)
          : base44.entities.WorldState.list("-created_date", 50),
        base44.entities.Character.list("-created_date", 100),
      ]);

      if (calendarData && calendarData.length > 0) {
        setCalendar(calendarData[0]);
      }
      setWorldEvents(eventsData || []);
      setCharacters(characterData || []);
    } catch (err) {
      console.error("Error loading calendar data:", err);
    } finally {
      setLoading(false);
    }
  };

  const getTotalDaysInSeason = () => 90;

  const getProgressPercentage = () => {
    if (!calendar) return 0;
    const dayOfSeason = calendar.day_of_season || 1;
    const totalDays = getTotalDaysInSeason();
    return (dayOfSeason / totalDays) * 100;
  };

  const getSeasonalDescription = () => {
    if (!calendar || !calendar.seasonal_description) {
      const season = SEASONS[calendar?.current_season] || SEASONS.spring;
      return season.description;
    }
    return calendar.seasonal_description;
  };

  const getUpcomingEvents = () => {
    if (!worldEvents) return [];
    return worldEvents
      .filter((e) => e.category === "event" || e.importance)
      .sort((a, b) => new Date(b.created_date) - new Date(a.created_date))
      .slice(0, 8);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[100dvh] bg-background">
        <div className="text-center space-y-3">
          <Loader className="w-8 h-8 text-primary animate-spin mx-auto" />
          <p className="font-mono text-[10px] text-primary/40 tracking-widest uppercase">
            Loading world calendar...
          </p>
        </div>
      </div>
    );
  }

  if (!calendar) {
    return (
      <div className="flex items-center justify-center h-[100dvh] bg-background">
        <div className="text-center space-y-4">
          <AlertCircle className="w-8 h-8 text-primary/30 mx-auto" />
          <p className="font-mono text-[10px] text-primary/40 tracking-widest uppercase">
            No calendar data found. Start a session to begin tracking time.
          </p>
        </div>
      </div>
    );
  }

  const seasonData = SEASONS[calendar.current_season] || SEASONS.spring;
  const progressPercent = getProgressPercentage();

  return (
    <div className="min-h-[100dvh] bg-background p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="max-w-6xl mx-auto space-y-1">
        <div className="flex items-center gap-3">
          <Calendar className="w-5 h-5 text-primary" />
          <h1 className="font-mono text-primary glow-text tracking-[0.2em] uppercase text-lg sm:text-xl">
            // World Calendar
          </h1>
        </div>
        <p className="text-[9px] font-mono text-primary/30">
          Track temporal progression and narrative events
        </p>
      </div>

      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Calendar Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="lg:col-span-2 border border-primary/20 bg-black/40 rounded overflow-hidden space-y-0"
        >
          {/* Seasonal Header */}
          <div
            className="px-6 py-6 relative overflow-hidden"
            style={{
              background: `linear-gradient(135deg, ${seasonData.color}15 0%, ${seasonData.color}05 100%)`,
              borderBottom: `2px solid ${seasonData.color}40`,
            }}
          >
            {/* Seasonal backdrop */}
            <div
              className="absolute inset-0 opacity-10 mix-blend-overlay"
              style={{ background: seasonData.color }}
            />

            <div className="relative z-10 space-y-4">
              {/* Seasonal Icon & Name */}
              <div className="flex items-center gap-4">
                <div className="text-4xl">{seasonData.emoji}</div>
                <div>
                  <h2 className="font-mono text-2xl font-bold text-primary tracking-wider">
                    {seasonData.label}
                  </h2>
                  <p className="text-[10px] font-mono text-primary/60 tracking-widest uppercase mt-1">
                    {getSeasonalDescription()}
                  </p>
                </div>
              </div>

              {/* Current Date Info */}
              <div className="grid grid-cols-2 gap-4 pt-2">
                <div>
                  <p className="text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-1">
                    Day of Season
                  </p>
                  <p className="text-2xl font-mono font-bold text-primary">
                    {calendar.day_of_season || 1}
                    <span className="text-primary/40 text-sm ml-1">/ 90</span>
                  </p>
                </div>
                <div>
                  <p className="text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-1">
                    Total Days Elapsed
                  </p>
                  <p className="text-2xl font-mono font-bold text-primary">{calendar.days_elapsed || 0}</p>
                </div>
              </div>

              {/* Progress Bar */}
              <div className="space-y-2 pt-2">
                <p className="text-[9px] font-mono text-primary/40 tracking-widest uppercase">
                  Seasonal Progress
                </p>
                <div className="h-2 bg-black/40 border border-primary/20 rounded overflow-hidden">
                  <motion.div
                    className="h-full"
                    style={{ backgroundColor: seasonData.color }}
                    initial={{ width: 0 }}
                    animate={{ width: `${progressPercent}%` }}
                    transition={{ duration: 1 }}
                  />
                </div>
                <p className="text-[8px] font-mono text-primary/30">{Math.round(progressPercent)}% complete</p>
              </div>
            </div>
          </div>

          {/* Weather & Atmospheric Info */}
          <div className="px-6 py-4 border-b border-primary/10 bg-black/20">
            <div className="flex items-center gap-4">
              <div>
                <p className="text-[9px] font-mono text-primary/40 tracking-widest uppercase">Weather</p>
                <p className="text-lg font-mono font-bold text-primary mt-0.5">
                  {WEATHER_ICONS[calendar.weather] || "?"} {calendar.weather}
                </p>
              </div>
              <div className="flex-1 pl-4 border-l border-primary/10">
                <p className="text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-1">
                  Atmospheric Notes
                </p>
                <p className="text-[10px] font-mono text-primary/70 leading-relaxed">
                  {calendar.seasonal_description || "A moment of quiet contemplation."}
                </p>
              </div>
            </div>
          </div>

          {/* Time Accumulation Info */}
          <div className="px-6 py-4 bg-black/20">
            <div className="flex items-center gap-3">
              <Clock className="w-4 h-4 text-primary/60" />
              <div className="flex-1">
                <p className="text-[9px] font-mono text-primary/40 tracking-widest uppercase">
                  Accumulated Hours
                </p>
                <p className="text-[10px] font-mono text-primary/70 mt-0.5">
                  {calendar.accumulated_hours || 0} hours toward next in-game day
                </p>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Seasonal Calendar Grid */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="border border-primary/20 bg-black/40 rounded p-4"
        >
          <p className="text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-4">
            Seasonal Calendar
          </p>

          {/* Mini Calendar Grid */}
          <div className="space-y-1 mb-4">
            {/* Days of week headers */}
            <div className="grid grid-cols-7 gap-1 mb-2">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
                <div key={day} className="text-center text-[8px] font-mono text-primary/40">
                  {day}
                </div>
              ))}
            </div>

            {/* Day cells */}
            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: getTotalDaysInSeason() }).map((_, idx) => {
                const dayNum = idx + 1;
                const isCurrentDay = dayNum === (calendar.day_of_season || 1);
                return (
                  <button
                    key={idx}
                    onClick={() => setSelectedDate(dayNum)}
                    className={`
                      aspect-square text-[8px] font-mono rounded transition-all
                      ${
                        isCurrentDay
                          ? "bg-primary text-black font-bold border border-primary"
                          : dayNum < (calendar.day_of_season || 1)
                          ? "bg-primary/20 text-primary/60 border border-primary/20 hover:bg-primary/30"
                          : "bg-black/40 text-primary/40 border border-primary/10 hover:bg-primary/5"
                      }
                    `}
                  >
                    {dayNum}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Legend */}
          <div className="space-y-1.5 pt-4 border-t border-primary/10">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded bg-primary" />
              <span className="text-[8px] font-mono text-primary/60">Current day</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded bg-primary/20" />
              <span className="text-[8px] font-mono text-primary/60">Past days</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded bg-black/40" />
              <span className="text-[8px] font-mono text-primary/60">Future days</span>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Events Timeline */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="max-w-6xl mx-auto border border-primary/20 bg-black/40 rounded p-6"
      >
        <p className="text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-4">
          Narrative Events ({getUpcomingEvents().length})
        </p>

        <div className="space-y-2 max-h-96 overflow-y-auto">
          {getUpcomingEvents().length === 0 ? (
            <p className="text-center text-[9px] font-mono text-primary/30 py-8">No events recorded</p>
          ) : (
            getUpcomingEvents().map((event) => (
              <motion.button
                key={event.id}
                onClick={() => setExpandedEvent(expandedEvent === event.id ? null : event.id)}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                className={`w-full text-left p-3 border rounded transition-all ${
                  expandedEvent === event.id
                    ? "bg-primary/10 border-primary/40"
                    : "bg-black/20 border-primary/15 hover:border-primary/30"
                }`}
              >
                <div className="flex items-start gap-3">
                  <div
                    className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0"
                    style={{
                      backgroundColor:
                        event.importance === "critical"
                          ? "#ff6b6b"
                          : event.importance === "major"
                          ? "#ffd43b"
                          : "#74c0fc",
                    }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-mono font-semibold text-primary/80 truncate">
                      {event.subject}
                    </p>
                    <p className="text-[9px] font-mono text-primary/40 truncate mt-0.5">
                      {event.fact}
                    </p>
                  </div>
                  <span className="text-[8px] font-mono text-primary/30 flex-shrink-0">
                    {event.importance || "minor"}
                  </span>
                </div>

                {/* Expanded details */}
                <AnimatePresence>
                  {expandedEvent === event.id && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="mt-2 pt-2 border-t border-primary/10"
                    >
                      <p className="text-[9px] font-mono text-primary/60 leading-relaxed">
                        {event.fact}
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.button>
            ))
          )}
        </div>
      </motion.div>
    </div>
  );
}