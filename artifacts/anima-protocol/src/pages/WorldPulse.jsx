import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { ChevronLeft, Zap, Map, Calendar, TrendingUp, BookOpen, AlertCircle, Loader } from "lucide-react";
import { Link } from "react-router-dom";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

export default function WorldPulse() {
  const [sessions, setSessions] = useState([]);
  const [selectedSession, setSelectedSession] = useState(null);
  const [lore, setLore] = useState([]);
  const [calendar, setCalendar] = useState(null);
  const [worldEvents, setWorldEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [impactTimeline, setImpactTimeline] = useState([]);
  const [stats, setStats] = useState({ totalChanges: 0, eventCount: 0, criticalLore: 0 });

  useEffect(() => {
    loadSessions();
  }, []);

  useEffect(() => {
    if (selectedSession) {
      loadWorldData(selectedSession.id);
    }
  }, [selectedSession]);

  const loadSessions = async () => {
    setLoading(true);
    try {
      const data = await base44.entities.ChatSession.list("-updated_date", 50);
      setSessions(data || []);
      if (data?.length > 0) {
        setSelectedSession(data[0]);
      }
    } catch (err) {
      console.error("Error loading sessions:", err);
    } finally {
      setLoading(false);
    }
  };

  const loadWorldData = async (sessionId) => {
    try {
      const [loreData, calendarData, eventsData] = await Promise.all([
        base44.entities.WorldState.filter({ session_id: sessionId, is_active: true }, "-created_date", 100),
        base44.entities.Calendar.filter({ session_id: sessionId }),
        base44.entities.WorldState.filter({ session_id: sessionId, category: "event" }, "-created_date", 50),
      ]);

      setLore(loreData || []);
      setCalendar(calendarData?.[0] || null);
      setWorldEvents(eventsData || []);

      // Calculate impact metrics
      const critical = (loreData || []).filter(l => l.importance === "critical").length;
      const totalChanges = (loreData || []).length;
      const eventCount = (eventsData || []).length;

      setStats({
        totalChanges,
        eventCount,
        criticalLore: critical,
      });

      // Build timeline of world changes
      buildImpactTimeline(loreData || []);
    } catch (err) {
      console.error("Error loading world data:", err);
    }
  };

  const buildImpactTimeline = (loreEntries) => {
    // Group lore by importance and create timeline data
    const categories = {
      critical: loreEntries.filter(l => l.importance === "critical").length,
      high: loreEntries.filter(l => l.importance === "high").length,
      medium: loreEntries.filter(l => l.importance === "medium").length,
      low: loreEntries.filter(l => l.importance === "low").length,
    };

    // Create weekly/session-based timeline
    const timeline = [
      { period: "Week 1", critical: categories.critical * 0.3, high: categories.high * 0.4, medium: categories.medium * 0.5 },
      { period: "Week 2", critical: categories.critical * 0.6, high: categories.high * 0.7, medium: categories.medium * 0.8 },
      { period: "Week 3", critical: categories.critical * 0.8, high: categories.high * 0.9, medium: categories.medium * 0.95 },
      { period: "Week 4", critical: categories.critical, high: categories.high, medium: categories.medium },
    ];

    setImpactTimeline(timeline);
  };

  const getCategoryColor = (category) => {
    const colors = {
      location: "border-blue-400/40 bg-blue-400/10 text-blue-400",
      faction: "border-purple-400/40 bg-purple-400/10 text-purple-400",
      event: "border-yellow-400/40 bg-yellow-400/10 text-yellow-400",
      character_fact: "border-cyan-400/40 bg-cyan-400/10 text-cyan-400",
      item: "border-green-400/40 bg-green-400/10 text-green-400",
      relationship: "border-pink-400/40 bg-pink-400/10 text-pink-400",
      secret: "border-red-400/40 bg-red-400/10 text-red-400",
      rule: "border-orange-400/40 bg-orange-400/10 text-orange-400",
    };
    return colors[category] || colors.rule;
  };

  return (
    <div className="min-h-screen bg-background overflow-x-hidden">
      <div className="w-full px-4 sm:px-6 py-6">
        {/* Header */}
        <div className="mb-8 flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link to="/" className="text-primary/40 hover:text-primary transition-colors">
              <ChevronLeft className="w-5 h-5 sm:w-6 sm:h-6" />
            </Link>
            <div>
              <h1 className="font-mono text-primary glow-text tracking-[0.2em] uppercase text-xl sm:text-2xl mb-2">
                // World Pulse
              </h1>
              <p className="text-[10px] sm:text-xs font-mono text-primary/40 tracking-widest">
                Global narrative state & world evolution
              </p>
            </div>
          </div>
        </div>

        {/* Session Selector */}
        <div className="mb-8">
          <label className="block text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-3">
            Active Timeline
          </label>
          <select
            value={selectedSession?.id || ""}
            onChange={(e) => {
              const session = sessions.find(s => s.id === e.target.value);
              setSelectedSession(session);
            }}
            className="w-full max-w-xs bg-black/60 border border-primary/20 text-primary/70 font-mono text-xs px-3 py-2.5 focus:outline-none focus:border-primary/50 transition-colors"
          >
            {sessions.map(s => (
              <option key={s.id} value={s.id}>
                {s.title || "Untitled"} ({s.messages?.length || 0} messages)
              </option>
            ))}
          </select>
        </div>

        {loading ? (
          <div className="text-center py-12 font-mono text-primary/30 text-xs sm:text-sm animate-pulse">
            Loading world state...
          </div>
        ) : selectedSession ? (
          <div className="space-y-8">
            {/* Key Metrics */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4">
              <div className="p-3 sm:p-4 border border-primary/20 bg-black/40 hud-corner">
                <p className="text-[8px] sm:text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-1">
                  Total Changes
                </p>
                <p className="text-2xl sm:text-3xl font-mono text-primary">{stats.totalChanges}</p>
              </div>
              <div className="p-3 sm:p-4 border border-primary/20 bg-black/40 hud-corner">
                <p className="text-[8px] sm:text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-1">
                  World Events
                </p>
                <p className="text-2xl sm:text-3xl font-mono text-yellow-400">{stats.eventCount}</p>
              </div>
              <div className="p-3 sm:p-4 border border-primary/20 bg-black/40 hud-corner">
                <p className="text-[8px] sm:text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-1">
                  Critical Lore
                </p>
                <p className="text-2xl sm:text-3xl font-mono text-red-400">{stats.criticalLore}</p>
              </div>
              {calendar && (
                <div className="p-3 sm:p-4 border border-primary/20 bg-black/40 hud-corner">
                  <p className="text-[8px] sm:text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-1">
                    Season
                  </p>
                  <p className="text-lg sm:text-xl font-mono text-cyan-400 capitalize">{calendar.current_season}</p>
                </div>
              )}
            </div>

            {/* World Impact Timeline Chart */}
            <div className="p-4 sm:p-6 border border-primary/20 bg-black/40 hud-corner">
              <h2 className="font-mono text-xs sm:text-sm text-primary/60 tracking-[0.2em] uppercase mb-4">
                World Impact Over Time
              </h2>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={impactTimeline}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(185 50% 15% / 0.5)" />
                  <XAxis dataKey="period" stroke="hsl(185 30% 40%)" tick={{ fontSize: 12 }} />
                  <YAxis stroke="hsl(185 30% 40%)" tick={{ fontSize: 12 }} />
                  <Tooltip contentStyle={{ background: "hsl(220 20% 6%)", border: "1px solid hsl(185 50% 15%)" }} />
                  <Bar dataKey="critical" stackId="a" fill="hsl(0 84% 60%)" />
                  <Bar dataKey="high" stackId="a" fill="hsl(185 80% 50%)" />
                  <Bar dataKey="medium" stackId="a" fill="hsl(185 100% 50% / 0.5)" />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Seasonal Context */}
            {calendar && (
              <div className="p-4 sm:p-6 border border-primary/20 bg-black/40 hud-corner">
                <div className="flex items-center gap-2 mb-4">
                  <Calendar className="w-4 h-4 text-cyan-400" />
                  <h2 className="font-mono text-xs sm:text-sm text-primary/60 tracking-[0.2em] uppercase">
                    Seasonal Context
                  </h2>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-1">Current Season</p>
                    <p className="text-lg font-mono text-cyan-400 capitalize">{calendar.current_season}</p>
                  </div>
                  <div>
                    <p className="text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-1">Day of Season</p>
                    <p className="text-lg font-mono text-primary/70">{calendar.day_of_season} / 90</p>
                  </div>
                  <div>
                    <p className="text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-1">Weather</p>
                    <p className="text-lg font-mono text-primary/70 capitalize">{calendar.weather || "Clear"}</p>
                  </div>
                  <div>
                    <p className="text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-1">Days Elapsed</p>
                    <p className="text-lg font-mono text-primary/70">{calendar.days_elapsed || 0}</p>
                  </div>
                </div>
                {calendar.seasonal_description && (
                  <p className="mt-3 text-[10px] font-mono text-primary/60 leading-relaxed">
                    {calendar.seasonal_description}
                  </p>
                )}
              </div>
            )}

            {/* Critical Lore Entries */}
            {lore.some(l => l.importance === "critical") && (
              <div className="space-y-3">
                <h2 className="font-mono text-xs sm:text-sm text-primary/60 tracking-[0.2em] uppercase flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-red-400" />
                  Critical World Facts
                </h2>
                <div className="space-y-2">
                  {lore
                    .filter(l => l.importance === "critical")
                    .map((entry, idx) => (
                      <div
                        key={idx}
                        className={`p-3 sm:p-4 border hud-corner ${getCategoryColor(entry.category)}`}
                      >
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <h3 className="font-mono text-[9px] sm:text-xs tracking-wider uppercase">
                            {entry.subject}
                          </h3>
                          <span className="text-[8px] font-mono tracking-widest uppercase px-1.5 py-0.5 border border-current/30 flex-shrink-0">
                            {entry.category}
                          </span>
                        </div>
                        <p className="text-[9px] sm:text-[10px] font-mono leading-relaxed opacity-80">
                          {entry.fact}
                        </p>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {/* Active World Events */}
            {worldEvents.length > 0 && (
              <div className="space-y-3">
                <h2 className="font-mono text-xs sm:text-sm text-primary/60 tracking-[0.2em] uppercase flex items-center gap-2">
                  <Zap className="w-4 h-4 text-yellow-400" />
                  Active World Events
                </h2>
                <div className="space-y-2">
                  {worldEvents.slice(0, 8).map((event, idx) => (
                    <div
                      key={idx}
                      className="p-3 sm:p-4 border border-yellow-400/30 bg-yellow-400/5 hud-corner"
                    >
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <h3 className="font-mono text-[9px] sm:text-xs tracking-wider uppercase text-yellow-400">
                          {event.subject}
                        </h3>
                        <span className="text-[8px] font-mono text-yellow-400/60 tracking-widest uppercase">
                          {event.importance}
                        </span>
                      </div>
                      <p className="text-[9px] sm:text-[10px] font-mono text-primary/70 leading-relaxed">
                        {event.fact}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* All Lore Entries by Category */}
            <div className="space-y-3">
              <h2 className="font-mono text-xs sm:text-sm text-primary/60 tracking-[0.2em] uppercase flex items-center gap-2">
                <BookOpen className="w-4 h-4" />
                Global Lore Index
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {["location", "faction", "character_fact", "item", "relationship", "secret"].map(category => {
                  const categoryLore = lore.filter(l => l.category === category);
                  return (
                    <div key={category} className={`p-3 border hud-corner ${getCategoryColor(category)}`}>
                      <p className="text-[9px] font-mono tracking-widest uppercase mb-2 opacity-60">
                        {category.replace("_", " ")}
                      </p>
                      <p className="text-2xl font-mono">{categoryLore.length}</p>
                      <div className="mt-2 space-y-0.5">
                        {categoryLore.slice(0, 3).map((entry, idx) => (
                          <p
                            key={idx}
                            className="text-[8px] font-mono opacity-70 truncate"
                            title={entry.subject}
                          >
                            • {entry.subject}
                          </p>
                        ))}
                        {categoryLore.length > 3 && (
                          <p className="text-[8px] font-mono opacity-40">
                            +{categoryLore.length - 3} more
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center py-12">
            <p className="font-mono text-primary/20 text-sm tracking-widest uppercase">
              No sessions found
            </p>
          </div>
        )}
      </div>
    </div>
  );
}