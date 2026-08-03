import { useEffect, useState } from "react";
import { Zap, TrendingUp, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const categoryIcons = {
  event: "⚡",
  character_fact: "👤",
  item: "📦",
  location: "📍",
  relationship: "❤️",
  secret: "🔐",
  rule: "⚖️",
};

const categoryColors = {
  weather: "border-blue-400/30 bg-blue-400/5 text-blue-400",
  resource: "border-yellow-400/30 bg-yellow-400/5 text-yellow-400",
  political: "border-purple-400/30 bg-purple-400/5 text-purple-400",
  environmental: "border-green-400/30 bg-green-400/5 text-green-400",
  event: "border-cyan-400/30 bg-cyan-400/5 text-cyan-400",
};

export default function WorldStateMonitor({ worldEvents, messageCount }) {
  const [activeEvents, setActiveEvents] = useState([]);
  const [dismissedEvents, setDismissedEvents] = useState(new Set());

  useEffect(() => {
    if (worldEvents && worldEvents.length > 0) {
      const newEvents = worldEvents.filter(e => !dismissedEvents.has(e.id));
      setActiveEvents(newEvents);
    }
  }, [worldEvents, dismissedEvents]);

  if (activeEvents.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2 mb-4">
      <div className="flex items-center gap-2 px-3 py-1.5 border border-primary/15 bg-primary/5 rounded">
        <TrendingUp className="w-3 h-3 text-primary/50" />
        <span className="font-mono text-[9px] text-primary/40 tracking-widest uppercase">
          World Evolution ({activeEvents.length} active)
        </span>
      </div>

      <AnimatePresence>
        {activeEvents.map((event) => {
          const colorClass = categoryColors[event.category] || categoryColors.event;

          return (
            <motion.div
              key={event.id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className={`border rounded p-3 space-y-1.5 ${colorClass}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-base leading-none">
                      {categoryIcons[event.category] || "📌"}
                    </span>
                    <span className="font-mono text-[10px] font-semibold tracking-wider uppercase truncate">
                      {event.subject}
                    </span>
                  </div>
                  <p className="font-mono text-[9px] leading-relaxed opacity-80">
                    {event.description}
                  </p>
                  {event.importance && (
                    <span className="inline-block mt-1 text-[8px] font-mono tracking-widest uppercase opacity-60">
                      [{event.importance}]
                    </span>
                  )}
                </div>
                <button
                  onClick={() => setDismissedEvents(new Set([...dismissedEvents, event.id]))}
                  className="flex-shrink-0 text-current opacity-40 hover:opacity-100 transition-opacity"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}