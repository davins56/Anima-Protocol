import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { ChevronLeft, Loader, Zap, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
import SeasonalCalendar from "@/components/calendar/SeasonalCalendar";
import { motion } from "framer-motion";

export default function CalendarView() {
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get("session");

  const [sessions, setSessions] = useState([]);
  const [selectedSession, setSelectedSession] = useState(sessionId || "");
  const [calendar, setCalendar] = useState(null);
  const [worldEvents, setWorldEvents] = useState([]);
  const [upcomingEvents, setUpcomingEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [selectedDay, setSelectedDay] = useState(null);

  useEffect(() => {
    loadSessions();
  }, []);

  useEffect(() => {
    if (selectedSession) {
      loadSessionData();
    }
  }, [selectedSession]);

  const loadSessions = async () => {
    setLoading(true);
    try {
      const data = await base44.entities.ChatSession.list("-updated_date", 50);
      setSessions(data || []);
      if (!selectedSession && data?.length > 0) {
        setSelectedSession(data[0].id);
      }
    } catch (err) {
      console.error("Error loading sessions:", err);
    } finally {
      setLoading(false);
    }
  };

  const loadSessionData = async () => {
    setLoading(true);
    try {
      const [calData, loreData] = await Promise.all([
        base44.entities.Calendar.filter({ session_id: selectedSession }),
        base44.entities.WorldState.filter({
          session_id: selectedSession,
          category: "event",
        }, "-created_date", 50),
      ]);

      if (calData?.length > 0) {
        setCalendar(calData[0]);
      }
      setWorldEvents(loreData || []);
    } catch (err) {
      console.error("Error loading session data:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateEvents = async () => {
    if (!selectedSession) return;
    setGenerating(true);
    try {
      const result = await base44.functions.invoke("suggestWorldEvents", {
        session_id: selectedSession,
      });
      if (result?.data?.suggestions) {
        setUpcomingEvents(result.data.suggestions);
      }
    } catch (err) {
      console.error("Error generating events:", err);
    } finally {
      setGenerating(false);
    }
  };

  const handleInjectEvent = async (event) => {
    if (!selectedSession) return;
    try {
      // Create world state entry for the event
      await base44.entities.WorldState.create({
        session_id: selectedSession,
        category: "event",
        subject: event.title,
        fact: event.description,
        importance: event.urgency === "high" ? "critical" : "medium",
        is_active: true,
      });

      // Update seasonal context
      await base44.functions.invoke("updateSeasonalContext", {
        session_id: selectedSession,
        user_message: `[WORLD EVENT: ${event.title}]`,
        ai_response: event.narrative_hook,
        message_index: 0,
      });

      await loadSessionData();
      setUpcomingEvents(prev => prev.filter(e => e.title !== event.title));
    } catch (err) {
      console.error("Error injecting event:", err);
    }
  };

  const currentSession = sessions.find(s => s.id === selectedSession);

  return (
    <div className="flex-1 min-h-0 bg-background flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-primary/20 bg-black/60 backdrop-blur-md sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <Link to="/" className="text-primary/40 hover:text-primary transition-colors">
            <ChevronLeft className="w-5 h-5 sm:w-6 sm:h-6" />
          </Link>
          <div>
            <h1 className="font-mono text-primary glow-text tracking-[0.2em] uppercase text-lg sm:text-2xl">
              // World Calendar
            </h1>
            <p className="text-[9px] sm:text-[10px] font-mono text-primary/40 tracking-widest">
              Track seasonal cycles and narrative milestones
            </p>
          </div>
        </div>
      </div>

      {/* Session Selector */}
      <div className="px-4 sm:px-6 py-3 border-b border-primary/10 bg-black/40">
        <label className="block text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-2">
          Session
        </label>
        <select
          value={selectedSession}
          onChange={(e) => setSelectedSession(e.target.value)}
          className="w-full max-w-xs bg-black/60 border border-primary/20 text-primary/70 font-mono text-xs px-3 py-2 focus:outline-none focus:border-primary/50 transition-colors"
        >
          {sessions.map(s => (
            <option key={s.id} value={s.id}>
              {s.title || "Untitled"} ({s.messages?.length || 0} messages)
            </option>
          ))}
        </select>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <Loader className="w-6 h-6 text-primary/60 animate-spin mx-auto mb-3" />
              <p className="font-mono text-[10px] text-primary/40 tracking-widest uppercase">
                Loading calendar...
              </p>
            </div>
          </div>
        ) : (
          <div className="max-w-4xl space-y-6">
            {/* Calendar */}
            {calendar && (
              <SeasonalCalendar
                calendar={calendar}
                events={worldEvents}
                onDaySelect={setSelectedDay}
              />
            )}

            {/* Upcoming Events Section */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-4 border border-primary/20 bg-black/40"
            >
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-mono text-xs text-primary/60 tracking-[0.2em] uppercase">
                  Suggested Narrative Milestones
                </h2>
                <button
                  onClick={handleGenerateEvents}
                  disabled={generating}
                  className="flex items-center gap-2 px-3 py-1.5 border border-primary/30 text-primary/60 hover:text-primary hover:border-primary/60 disabled:opacity-50 font-mono text-[9px] tracking-widest uppercase transition-all"
                >
                  {generating ? (
                    <Loader className="w-3 h-3 animate-spin" />
                  ) : (
                    <RefreshCw className="w-3 h-3" />
                  )}
                  {generating ? "Generating" : "Generate"}
                </button>
              </div>

              {upcomingEvents.length === 0 ? (
                <p className="text-[10px] font-mono text-primary/30 tracking-widest uppercase py-4">
                  No suggestions yet. Click "Generate" to create narrative milestones.
                </p>
              ) : (
                <div className="space-y-2">
                  {upcomingEvents.map((event, idx) => (
                    <motion.div
                      key={idx}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="p-3 border border-primary/20 bg-primary/5 hover:bg-primary/10 transition-all"
                    >
                      <div className="flex items-start gap-3">
                        <Zap className="w-3 h-3 mt-1 flex-shrink-0 text-primary/60" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2 mb-1">
                            <h4 className="font-mono text-xs tracking-wider uppercase">
                              {event.title}
                            </h4>
                            <span className={`text-[8px] font-mono tracking-widest uppercase flex-shrink-0 ${
                              event.urgency === "high" ? "text-red-400" : "text-primary/60"
                            }`}>
                              {event.urgency}
                            </span>
                          </div>
                          <p className="text-[9px] font-mono text-primary/70 mb-2">
                            {event.description}
                          </p>
                          <div className="flex items-center gap-2 text-[8px] font-mono text-primary/50 mb-2">
                            <span>Type: {event.event_type}</span>
                            <span>•</span>
                            <span>Impact: {event.impact_scale}</span>
                          </div>
                          <button
                            onClick={() => handleInjectEvent(event)}
                            className="px-2.5 py-1 border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 font-mono text-[8px] tracking-widest uppercase transition-all"
                          >
                            Inject into Timeline
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </motion.div>
          </div>
        )}
      </div>
    </div>
  );
}