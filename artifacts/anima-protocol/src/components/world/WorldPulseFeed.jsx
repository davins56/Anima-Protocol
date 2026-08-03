import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Zap, TrendingUp, AlertCircle, Sparkles, X } from "lucide-react";

const PULSE_ICONS = {
  event: <Zap className="w-3 h-3" />,
  faction: <TrendingUp className="w-3 h-3" />,
  landmark: <Sparkles className="w-3 h-3" />,
  conflict: <AlertCircle className="w-3 h-3" />,
  discovery: <Sparkles className="w-3 h-3" />,
  default: <Zap className="w-3 h-3" />,
};

const PULSE_COLORS = {
  event: "border-cyan-400/30 bg-cyan-400/5 text-cyan-400",
  faction: "border-purple-400/30 bg-purple-400/5 text-purple-400",
  landmark: "border-yellow-400/30 bg-yellow-400/5 text-yellow-400",
  conflict: "border-red-400/30 bg-red-400/5 text-red-400",
  discovery: "border-green-400/30 bg-green-400/5 text-green-400",
  default: "border-primary/30 bg-primary/5 text-primary",
};

export default function WorldPulseFeed({ worldEvents = [], isVisible = true, onDismissEvent }) {
  const [displayedEvents, setDisplayedEvents] = useState([]);

  useEffect(() => {
    if (worldEvents && worldEvents.length > 0) {
      const newEvent = worldEvents[0];
      if (!displayedEvents.find(e => e.id === newEvent.id)) {
        setDisplayedEvents(prev => [newEvent, ...prev].slice(0, 8));
      }
    }
  }, [worldEvents]);

  if (!isVisible || displayedEvents.length === 0) {
    return null;
  }

  const handleDismiss = (eventId) => {
    setDisplayedEvents(prev => prev.filter(e => e.id !== eventId));
    onDismissEvent?.(eventId);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="border border-primary/20 bg-black/40 rounded p-3 sm:p-4 space-y-2"
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
          <span className="font-mono text-[9px] text-cyan-400 tracking-widest uppercase font-semibold">
            World Pulse
          </span>
        </div>
        <div className="flex-1 h-px bg-gradient-to-r from-cyan-400/30 to-transparent" />
        <span className="font-mono text-[8px] text-primary/40">
          {displayedEvents.length} Active
        </span>
      </div>

      {/* Events Feed */}
      <div className="space-y-1.5 max-h-64 overflow-y-auto">
        <AnimatePresence>
          {displayedEvents.map((event, idx) => {
            const eventType = event.type || event.category || "default";
            const colorClass = PULSE_COLORS[eventType] || PULSE_COLORS.default;
            const icon = PULSE_ICONS[eventType] || PULSE_ICONS.default;

            return (
              <motion.div
                key={event.id || idx}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                transition={{ delay: idx * 0.05 }}
                className={`group flex items-start gap-2 p-2 border rounded text-[9px] font-mono transition-all hover:border-opacity-60 ${colorClass}`}
              >
                {/* Icon */}
                <div className="flex-shrink-0 mt-0.5 opacity-60">
                  {icon}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-[9px] leading-tight mb-0.5">
                    {event.headline || event.title || "World Event"}
                  </p>
                  <p className="text-[8px] opacity-70 line-clamp-2 leading-tight">
                    {event.description || event.summary || ""}
                  </p>
                  {event.impact && (
                    <p className="text-[8px] opacity-60 mt-0.5">
                      💫 {event.impact}
                    </p>
                  )}
                </div>

                {/* Dismiss Button */}
                <button
                  onClick={() => handleDismiss(event.id)}
                  className="flex-shrink-0 opacity-0 group-hover:opacity-100 text-current/40 hover:text-current/70 transition-all p-0.5"
                  title="Dismiss"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {/* Footer Stats */}
      <div className="flex items-center justify-between gap-2 pt-2 border-t border-primary/10 text-[8px] text-primary/40">
        <span>Latest updates from world state</span>
        <span>Live</span>
      </div>
    </motion.div>
  );
}