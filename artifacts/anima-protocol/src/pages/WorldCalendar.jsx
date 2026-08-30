import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { ArrowLeft, Calendar, Cloud, Wind, Flame, Snowflake, Sparkles, Loader, ChevronLeft, ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

const SEASONS = {
  spring: { icon: Wind, color: "text-green-400", desc: "Awakening • Growth • Renewal" },
  summer: { icon: Flame, color: "text-yellow-400", desc: "Peak • Abundance • Intensity" },
  autumn: { icon: Cloud, color: "text-orange-400", desc: "Transition • Harvest • Decline" },
  winter: { icon: Snowflake, color: "text-cyan-400", desc: "Rest • Hardship • Introspection" }
};

export default function WorldCalendar() {
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get("session");

  const [sessions, setSessions] = useState([]);
  const [selectedSession, setSelectedSession] = useState(sessionId || "");
  const [calendar, setCalendar] = useState(null);
  const [events, setEvents] = useState([]);
  const [storypoints, setStorypoints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [selectedDate, setSelectedDate] = useState(null);

  useEffect(() => {
    loadSessions();
  }, []);

  useEffect(() => {
    if (selectedSession) {
      loadCalendarData();
    }
  }, [selectedSession]);

  const loadSessions = async () => {
    const data = await base44.entities.ChatSession.list("-updated_date", 100);
    setSessions(data || []);
    if (!selectedSession && data?.length > 0) {
      setSelectedSession(data[0].id);
    }
  };

  const loadCalendarData = async () => {
    setLoading(true);
    const [cal, lore, points] = await Promise.all([
      base44.entities.Calendar.filter({ session_id: selectedSession }),
      base44.entities.WorldState.filter({ session_id: selectedSession, is_active: true }, "-created_date", 100),
      base44.entities.Storypoint.filter({ session_id: selectedSession }, "order", 100)
    ]);

    if (cal?.length > 0) {
      setCalendar(cal[0]);
    }
    setEvents(lore || []);
    setStorypoints(points || []);
    setLoading(false);
  };

  const handleGenerateEvents = async () => {
    if (!selectedSession || !calendar) return;
    setGenerating(true);
    try {
      const result = await base44.functions.invoke("suggestWorldEvents", {
        session_id: selectedSession
      });
      if (result?.data?.suggestions) {
        // Show suggestions in a list or modal
        toast.success(`Generated ${result.data.suggestions.length} event suggestions`);
      }
    } catch (err) {
      console.error("Error generating events:", err);
    } finally {
      setGenerating(false);
    }
  };

  const handleUpdateSeason = async () => {
    if (!selectedSession || !calendar) return;
    setLoading(true);
    try {
      const result = await base44.functions.invoke("updateSeasonalContext", {
        session_id: selectedSession,
        user_message: "Time passes in the world...",
        ai_response: "The seasons turn.",
        message_index: 0
      });
      if (result?.data?.calendar) {
        setCalendar(result.data.calendar);
      }
    } catch (err) {
      console.error("Error updating season:", err);
    } finally {
      setLoading(false);
    }
  };

  if (!selectedSession) {
    return (
      <div className="flex-1 min-h-0 bg-background scanline flex items-center justify-center">
        <div className="text-center space-y-4">
          <Calendar className="w-12 h-12 text-primary/20 mx-auto" />
          <p className="font-mono text-primary/40 text-sm tracking-[0.3em] uppercase">Select a session</p>
        </div>
      </div>
    );
  }

  const SeasonIcon = calendar ? SEASONS[calendar.current_season]?.icon : Calendar;
  const seasonData = calendar ? SEASONS[calendar.current_season] : {};

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-background scanline">
      {/* Header */}
      <div className="border-b border-primary/20 bg-black/60 backdrop-blur-md px-6 py-4 sticky top-0 z-30">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-4 flex-1 min-w-0">
            <Link to="/" className="text-primary/40 hover:text-primary transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div className="min-w-0">
              <h1 className="font-mono text-primary glow-text tracking-[0.2em] uppercase text-lg flex items-center gap-2">
                <Calendar className="w-5 h-5 flex-shrink-0" />
                <span className="truncate">// World Calendar</span>
              </h1>
              <p className="text-[10px] font-mono text-primary/30 tracking-widest uppercase mt-0.5">
                {calendar ? `Day ${calendar.day_of_season} of ${calendar.current_season}` : "No calendar data"}
              </p>
            </div>
          </div>

          <select
            value={selectedSession}
            onChange={(e) => setSelectedSession(e.target.value)}
            className="bg-black/60 border border-primary/20 text-primary/70 font-mono text-xs px-3 py-2 focus:outline-none focus:border-primary/50"
          >
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title || "Untitled"}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="max-w-6xl mx-auto p-6 pb-24 lg:pb-6 space-y-8">
        {loading ? (
          <div className="text-center py-12 font-mono text-primary/30 animate-pulse">Loading calendar...</div>
        ) : !calendar ? (
          <div className="text-center py-12">
            <Calendar className="w-12 h-12 text-primary/10 mx-auto mb-3" />
            <p className="font-mono text-primary/20 text-sm">No calendar data for this session</p>
          </div>
        ) : (
          <>
            {/* Current Season Display */}
            <div className="border border-primary/20 bg-black/40 p-8 space-y-4">
              <div className="flex items-center gap-4">
                <SeasonIcon className={`w-12 h-12 ${seasonData.color}`} />
                <div className="flex-1">
                  <h2 className={`font-mono text-2xl tracking-[0.2em] uppercase ${seasonData.color}`}>
                    {calendar.current_season}
                  </h2>
                  <p className="font-mono text-primary/50 text-sm mt-1">{seasonData.desc}</p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4 pt-4 border-t border-primary/10">
                <div>
                  <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase">Days Elapsed</p>
                  <p className="font-mono text-lg text-primary mt-1">{calendar.days_elapsed}</p>
                </div>
                <div>
                  <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase">Day of Season</p>
                  <p className="font-mono text-lg text-primary mt-1">{calendar.day_of_season}/90</p>
                </div>
                <div>
                  <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase">Weather</p>
                  <p className="font-mono text-lg text-primary mt-1 capitalize">{calendar.weather}</p>
                </div>
              </div>

              {calendar.seasonal_description && (
                <div className="pt-4 border-t border-primary/10">
                  <p className="text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-2">Atmospheric</p>
                  <p className="font-mono text-primary/70 text-sm leading-relaxed italic">
                    {calendar.seasonal_description}
                  </p>
                </div>
              )}

              <div className="flex gap-3 pt-4">
                <button
                  onClick={handleUpdateSeason}
                  disabled={loading}
                  className="flex-1 px-4 py-2 bg-primary/10 border border-primary/40 text-primary hover:bg-primary/20 disabled:opacity-50 font-mono text-xs tracking-widest uppercase transition-all hud-corner"
                >
                  {loading ? "Updating..." : "Advance Season"}
                </button>
                <button
                  onClick={handleGenerateEvents}
                  disabled={generating}
                  className="flex-1 px-4 py-2 bg-purple-500/10 border border-purple-400/40 text-purple-400 hover:bg-purple-500/20 disabled:opacity-50 font-mono text-xs tracking-widest uppercase transition-all flex items-center justify-center gap-2"
                >
                  {generating ? (
                    <>
                      <Loader className="w-3 h-3 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3 h-3" />
                      Generate Events
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Timeline of Events */}
            <div className="space-y-4">
              <h2 className="font-mono text-sm text-primary/70 tracking-wider uppercase flex items-center gap-2">
                <Sparkles className="w-4 h-4" />
                World Events & Milestones
              </h2>

              {events.length === 0 && storypoints.length === 0 ? (
                <div className="text-center py-12 border border-primary/15 bg-black/40">
                  <p className="font-mono text-primary/20 text-sm">No events recorded yet</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {/* Storypoints as milestones */}
                  {storypoints.map((point, idx) => (
                    <div
                      key={`story-${point.id}`}
                      className="border-l-4 border-yellow-400/50 bg-yellow-400/5 p-3 space-y-1"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h3 className="font-mono text-[10px] text-yellow-400 tracking-wider uppercase">
                            {point.title}
                          </h3>
                          <p className="font-mono text-[9px] text-primary/40 mt-0.5">Narrative Milestone #{idx + 1}</p>
                        </div>
                      </div>
                      <p className="font-mono text-[9px] text-primary/60 leading-relaxed">
                        {point.summary}
                      </p>
                    </div>
                  ))}

                  {/* World Events */}
                  {events.map((event) => {
                    const categoryColor = {
                      event: "text-purple-400/60 border-purple-400/30",
                      location: "text-green-400/60 border-green-400/30",
                      character_fact: "text-cyan-400/60 border-cyan-400/30",
                      relationship: "text-rose-400/60 border-rose-400/30",
                      secret: "text-red-400/60 border-red-400/30",
                      item: "text-yellow-400/60 border-yellow-400/30",
                      rule: "text-blue-400/60 border-blue-400/30"
                    };

                    return (
                      <div
                        key={event.id}
                        className={`border-l-2 ${categoryColor[event.category] || "border-primary/20"} bg-black/40 p-3 space-y-1 hover:border-opacity-100 transition-all cursor-pointer`}
                        onClick={() => setSelectedDate(event.id)}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1">
                            <h3 className="font-mono text-[10px] text-primary/80 tracking-wider uppercase">
                              {event.subject}
                            </h3>
                            <p className={`font-mono text-[8px] mt-0.5 capitalize ${categoryColor[event.category]?.split(" ")[0]}`}>
                              {event.category}
                            </p>
                          </div>
                          <span className={`font-mono text-[8px] tracking-widest uppercase ${
                            event.importance === "critical" ? "text-red-400" :
                            event.importance === "high" ? "text-yellow-400" :
                            "text-primary/40"
                          }`}>
                            {event.importance}
                          </span>
                        </div>
                        <p className="font-mono text-[9px] text-primary/60 leading-relaxed line-clamp-2">
                          {event.fact}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Season Progression Chart */}
            <div className="space-y-3">
              <h2 className="font-mono text-sm text-primary/70 tracking-wider uppercase">Season Progress</h2>
              <div className="border border-primary/15 bg-black/40 p-4">
                <div className="space-y-2">
                  {["spring", "summer", "autumn", "winter"].map((season) => {
                    const isActive = season === calendar.current_season;
                    const progress = isActive ? (calendar.day_of_season / 90) * 100 : season === "winter" ? 0 : 100;
                    const seasonColor = SEASONS[season].color;

                    return (
                      <div key={season} className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className={`font-mono text-[9px] tracking-widest uppercase ${seasonColor}`}>
                            {season}
                          </span>
                          <span className="font-mono text-[8px] text-primary/40">
                            {Math.round(progress)}%
                          </span>
                        </div>
                        <div className="w-full bg-black/60 border border-primary/10 h-2">
                          <div
                            className={`h-full ${isActive ? "bg-gradient-to-r from-primary/60 to-primary/20" : "bg-primary/20"} transition-all`}
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}