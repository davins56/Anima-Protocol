import { useState, useEffect, useRef } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { Zap, ChevronDown, Check, X, Loader, AlertTriangle, Sparkles, ChevronLeft, ChevronRight, ArrowLeft } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import useEmblaCarousel from 'embla-carousel-react';

export default function NarrativeProgress() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get("session");

  const [sessions, setSessions] = useState([]);
  const [selectedSession, setSelectedSession] = useState(sessionId || "");
  const [loading, setLoading] = useState(true);
  const [generatingEvents, setGeneratingEvents] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [expandedEvent, setExpandedEvent] = useState(null);
  const [injecting, setInjecting] = useState(null);

  useEffect(() => {
    loadSessions();
  }, []);

  useEffect(() => {
    if (selectedSession) {
      loadSuggestions();
    }
  }, [selectedSession]);

  const loadSessions = async () => {
    setLoading(true);
    const data = await base44.entities.ChatSession.list("-updated_date", 50);
    setSessions(data || []);
    if (!selectedSession && data?.length > 0) {
      setSelectedSession(data[0].id);
    }
    setLoading(false);
  };

  const loadSuggestions = async () => {
    if (!selectedSession) return;
    setGeneratingEvents(true);
    try {
      const result = await base44.functions.invoke("suggestWorldEvents", {
        session_id: selectedSession,
      });
      setSuggestions(result?.data?.suggestions || []);
    } catch (err) {
      console.error("Error loading suggestions:", err);
      setSuggestions([]);
    } finally {
      setGeneratingEvents(false);
    }
  };

  const handleInjectEvent = async (event) => {
    if (!selectedSession) return;
    setInjecting(event.title);

    try {
      // Fetch the session
      const sessionData = sessions.find(s => s.id === selectedSession);
      if (!sessionData) return;

      // Create a system event message
      const eventMessage = {
        role: "system",
        character_name: "World Event",
        content: `[WORLD EVENT: ${event.title}]\n\n${event.description}\n\n${event.narrative_hook}`,
        timestamp: new Date().toISOString(),
      };

      // Update session with the new event
      const updatedMessages = [...(sessionData.messages || []), eventMessage];
      await base44.entities.ChatSession.update(selectedSession, {
        messages: updatedMessages,
      });

      // Create a lore entry for this event
      await base44.entities.WorldState.create({
        session_id: selectedSession,
        category: "event",
        subject: event.title,
        fact: event.description,
        importance: event.urgency === "high" ? "critical" : "medium",
        is_active: true,
        source_message_index: updatedMessages.length - 1,
      });

      // Remove from suggestions
      setSuggestions(prev => prev.filter(e => e.title !== event.title));
      setExpandedEvent(null);

      // Refresh sessions
      await loadSessions();
    } catch (err) {
      console.error("Error injecting event:", err);
    } finally {
      setInjecting(null);
    }
  };

  const handleRejectEvent = (eventTitle) => {
    setSuggestions(prev => prev.filter(e => e.title !== eventTitle));
  };

  const currentSession = sessions.find(s => s.id === selectedSession);
  const messageCount = currentSession?.messages?.length || 0;

  const EventCarousel = ({ suggestions, getEventTypeColor, expandedEvent, setExpandedEvent, injecting, onInject, onReject }) => {
  const [emblaRef, emblaApi] = useEmblaCarousel({ loop: false, align: "start" });
  const [canScrollPrev, setCanScrollPrev] = useState(false);
  const [canScrollNext, setCanScrollNext] = useState(false);

  const onSelect = () => {
    if (!emblaApi) return;
    setCanScrollPrev(emblaApi.canScrollPrev());
    setCanScrollNext(emblaApi.canScrollNext());
  };

  useEffect(() => {
    if (!emblaApi) return;
    onSelect();
    emblaApi.on('select', onSelect);
  }, [emblaApi]);

  return (
    <div className="relative">
      <div className="overflow-hidden" ref={emblaRef}>
        <div className="flex gap-3 sm:gap-4 touch-pan-y">
          {suggestions.map((event, idx) => (
            <div key={event.title} className="flex-[0_0_100%] sm:flex-[0_0_50%] lg:flex-[0_0_33.333%] min-w-0">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className={`border transition-all h-full ${getEventTypeColor(event.event_type)}`}
              >
                <button
                  onClick={() => setExpandedEvent(expandedEvent === event.title ? null : event.title)}
                  className="w-full p-3 sm:p-4 text-left flex items-start gap-2 hover:brightness-110 transition-all"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start gap-1.5 mb-1">
                      <h3 className="font-mono text-xs sm:text-sm tracking-wider uppercase truncate line-clamp-2">
                        {event.title}
                      </h3>
                      {event.urgency === "high" && (
                        <AlertTriangle className="w-3 h-3 flex-shrink-0 mt-0.5" />
                      )}
                    </div>
                    <div className="flex items-center gap-1 flex-wrap">
                      <span className="text-[7px] sm:text-[8px] font-mono opacity-70">
                        {event.event_type}
                      </span>
                      <span className="text-[7px] sm:text-[8px] font-mono opacity-50">•</span>
                      <span className="text-[7px] sm:text-[8px] font-mono opacity-70">
                        {event.impact_scale}
                      </span>
                    </div>
                  </div>
                  <ChevronDown
                    className={`w-3 h-3 flex-shrink-0 transition-transform ${
                      expandedEvent === event.title ? "rotate-180" : ""
                    }`}
                  />
                </button>

                <AnimatePresence>
                  {expandedEvent === event.title && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="border-t border-current/20 px-3 sm:px-4 py-2.5 sm:py-3 space-y-2"
                    >
                      <div>
                        <p className="text-[8px] font-mono opacity-60 tracking-widest uppercase mb-0.5">Description</p>
                        <p className="text-[9px] font-mono opacity-80 leading-relaxed line-clamp-3">
                          {event.description}
                        </p>
                      </div>

                      <div>
                        <p className="text-[8px] font-mono opacity-60 tracking-widest uppercase mb-0.5">Intro</p>
                        <p className="text-[9px] font-mono opacity-80 leading-relaxed line-clamp-2">
                          {event.narrative_hook}
                        </p>
                      </div>

                      <div className="flex gap-1.5 pt-1">
                        <button
                          onClick={() => onReject(event.title)}
                          className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 border border-red-900/30 text-red-900 hover:text-red-400 hover:border-red-400/40 font-mono text-[8px] tracking-widest uppercase transition-all"
                        >
                          <X className="w-2.5 h-2.5" />
                          <span className="hidden sm:inline">Reject</span>
                        </button>
                        <button
                          onClick={() => onInject(event)}
                          disabled={injecting === event.title}
                          className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 bg-primary/10 border border-primary/40 text-primary hover:bg-primary/20 disabled:opacity-50 font-mono text-[8px] tracking-widest uppercase transition-all"
                        >
                          {injecting === event.title ? (
                            <Loader className="w-2.5 h-2.5 animate-spin" />
                          ) : (
                            <Check className="w-2.5 h-2.5" />
                          )}
                          <span className="hidden sm:inline">Inject</span>
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            </div>
          ))}
        </div>
      </div>

      {/* Navigation */}
      {(canScrollPrev || canScrollNext) && (
        <div className="flex gap-2 mt-3 justify-end">
          <button
            onClick={() => emblaApi?.scrollPrev()}
            disabled={!canScrollPrev}
            className="p-1.5 border border-primary/20 text-primary/40 hover:text-primary hover:border-primary/40 disabled:opacity-20 transition-all"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => emblaApi?.scrollNext()}
            disabled={!canScrollNext}
            className="p-1.5 border border-primary/20 text-primary/40 hover:text-primary hover:border-primary/40 disabled:opacity-20 transition-all"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
};

const getEventTypeColor = (type) => {
    const colors = {
      environmental: "border-green-400/40 bg-green-400/10 text-green-400",
      social: "border-blue-400/40 bg-blue-400/10 text-blue-400",
      supernatural: "border-purple-400/40 bg-purple-400/10 text-purple-400",
      personal: "border-pink-400/40 bg-pink-400/10 text-pink-400",
      external: "border-orange-400/40 bg-orange-400/10 text-orange-400",
      temporal: "border-yellow-400/40 bg-yellow-400/10 text-yellow-400",
    };
    return colors[type] || colors.external;
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-background overflow-x-hidden">
      <div className="w-full px-3 sm:px-6 py-4 sm:py-6">
        {/* Header */}
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="font-mono text-primary glow-text tracking-[0.2em] uppercase text-lg sm:text-2xl mb-2">
              // Narrative Dashboard
            </h1>
            <p className="text-[10px] sm:text-xs font-mono text-primary/40 tracking-widest">
              Monitor story progress and inject world-shaping events
            </p>
          </div>
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-1.5 px-3 py-2 border border-primary/20 hover:border-primary/40 text-primary/60 hover:text-primary font-mono text-[9px] tracking-widest uppercase transition-all flex-shrink-0"
            title="Back to chat"
          >
            <ArrowLeft className="w-3 h-3" />
            <span className="hidden sm:inline">Back</span>
          </button>
        </div>

        {loading ? (
          <div className="text-center py-12 font-mono text-primary/30 text-xs sm:text-sm animate-pulse">
            Loading sessions...
          </div>
        ) : (
          <div className="space-y-6">
            {/* Session Selector */}
            <div>
              <label className="block text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-2">
                Active Session
              </label>
              <select
                value={selectedSession}
                onChange={(e) => {
                  setSelectedSession(e.target.value);
                  setSuggestions([]);
                }}
                className="w-full bg-black/60 border border-primary/20 text-primary/70 font-mono text-xs px-3 py-2.5 focus:outline-none focus:border-primary/50"
              >
                {sessions.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.title || "Untitled"} ({s.messages?.length || 0} messages)
                  </option>
                ))}
              </select>
            </div>

            {currentSession && (
              <>
                {/* Progress Stats */}
                <div className="grid grid-cols-3 gap-2 sm:gap-4">
                  <div className="p-3 sm:p-4 border border-primary/20 bg-black/40">
                    <p className="text-[9px] font-mono text-primary/40 tracking-widest uppercase">Messages</p>
                    <p className="text-lg sm:text-2xl font-mono text-primary mt-1">{messageCount}</p>
                  </div>
                  <div className="p-3 sm:p-4 border border-primary/20 bg-black/40">
                    <p className="text-[9px] font-mono text-primary/40 tracking-widest uppercase">Duration</p>
                    <p className="text-lg sm:text-2xl font-mono text-primary mt-1">
                      {Math.ceil(messageCount / 2)} min
                    </p>
                  </div>
                  <div className="p-3 sm:p-4 border border-primary/20 bg-black/40">
                    <p className="text-[9px] font-mono text-primary/40 tracking-widest uppercase">Events</p>
                    <p className="text-lg sm:text-2xl font-mono text-primary mt-1">{suggestions.length}</p>
                  </div>
                </div>

                {/* Event Suggestions */}
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="font-mono text-xs text-primary/60 tracking-[0.2em] uppercase">
                      Suggested World Events
                    </h2>
                    <button
                      onClick={loadSuggestions}
                      disabled={generatingEvents}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-primary/10 border border-primary/40 text-primary hover:bg-primary/20 disabled:opacity-50 font-mono text-[9px] tracking-widest uppercase transition-all"
                    >
                      {generatingEvents ? (
                        <>
                          <Loader className="w-3 h-3 animate-spin" />
                          <span className="hidden sm:inline">Generating</span>
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-3 h-3" />
                          <span className="hidden sm:inline">Generate</span>
                        </>
                      )}
                    </button>
                  </div>

                  {suggestions.length === 0 ? (
                    <div className="text-center py-8 text-primary/20">
                      <p className="font-mono text-[10px] tracking-widest uppercase">
                        {generatingEvents ? "Analyzing narrative..." : "No events suggested yet"}
                      </p>
                    </div>
                  ) : (
                    <EventCarousel 
                      suggestions={suggestions}
                      getEventTypeColor={getEventTypeColor}
                      expandedEvent={expandedEvent}
                      setExpandedEvent={setExpandedEvent}
                      injecting={injecting}
                      onInject={handleInjectEvent}
                      onReject={handleRejectEvent}
                    />
                  )}
                </div>
              </>
            )}
          </div>
        )}
        </div>
        </div>
        );
        }