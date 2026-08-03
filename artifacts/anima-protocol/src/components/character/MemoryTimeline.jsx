import { motion } from "framer-motion";
import { Heart, Lock, Zap, Clock, Users } from "lucide-react";

const memoryTypeIcons = {
  personal: Zap,
  secret: Lock,
  interaction: Users,
  relationship: Heart,
  event: Clock,
  preference: Zap,
};

const memoryTypeColors = {
  personal: "border-blue-400/30 bg-blue-400/5 text-blue-400",
  secret: "border-red-400/30 bg-red-400/5 text-red-400",
  interaction: "border-cyan-400/30 bg-cyan-400/5 text-cyan-400",
  relationship: "border-pink-400/30 bg-pink-400/5 text-pink-400",
  event: "border-yellow-400/30 bg-yellow-400/5 text-yellow-400",
  preference: "border-green-400/30 bg-green-400/5 text-green-400",
};

export default function MemoryTimeline({ memories = [], relationships = [], characterName = "Character" }) {
  if (!memories.length && !relationships.length) {
    return (
      <div className="text-center py-12">
        <p className="font-mono text-primary/20 text-sm tracking-widest uppercase">
          No memories recorded yet
        </p>
      </div>
    );
  }

  // Combine and sort by creation date
  const allEvents = [
    ...memories.map((m, idx) => ({
      type: "memory",
      data: m,
      timestamp: m.created_date || new Date().toISOString(),
      id: `mem-${idx}`,
    })),
    ...relationships.map((r, idx) => ({
      type: "relationship",
      data: r,
      timestamp: r.created_date || new Date().toISOString(),
      id: `rel-${idx}`,
    })),
  ].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  return (
    <div className="space-y-4">
      {/* Timeline */}
      <div className="relative space-y-6">
        {/* Vertical line */}
        <div className="absolute left-7 top-12 bottom-0 w-0.5 bg-gradient-to-b from-primary/60 via-primary/30 to-primary/0" />

        {allEvents.map((event, idx) => {
          const isMemory = event.type === "memory";
          const isMilestone = !isMemory && event.data.score > 50;
          const Icon = isMemory
            ? memoryTypeIcons[event.data.category] || Clock
            : Heart;
          const colorClass = isMemory
            ? memoryTypeColors[event.data.category] || memoryTypeColors.personal
            : isMilestone
            ? "border-pink-400/40 bg-pink-400/10 text-pink-400"
            : "border-primary/20 bg-primary/5 text-primary/50";

          return (
            <motion.div
              key={event.id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: idx * 0.05 }}
              className="relative pl-20"
            >
              {/* Timeline dot */}
              <div className={`absolute left-0 w-16 flex items-center justify-center`}>
                <div className={`w-4 h-4 rounded-full border-2 ${colorClass} relative z-10`}>
                  <div className={`absolute inset-1.5 rounded-full bg-background`} />
                </div>
              </div>

              {/* Content card */}
              <div className={`p-4 border rounded space-y-2 transition-all hover:border-opacity-100 ${colorClass}`}>
                {/* Header */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Icon className="w-4 h-4 flex-shrink-0" />
                    <div>
                      <p className="font-mono text-xs tracking-wider uppercase">
                        {isMemory ? event.data.category : "Relationship"}
                      </p>
                      {isMemory && (
                        <p className="font-mono text-[9px] text-current/60 mt-0.5">
                          {event.data.tags?.slice(0, 2).join(" · ")}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Date badge */}
                  <span className="text-[8px] font-mono text-current/50 flex-shrink-0">
                    {new Date(event.timestamp).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                </div>

                {/* Content */}
                <p className="font-mono text-[10px] leading-relaxed text-current/80">
                  {isMemory ? event.data.fact : `Tier: ${event.data.tier} (${event.data.score}/100)`}
                </p>

                {/* Relationship specific info */}
                {!isMemory && (
                  <div className="pt-2 border-t border-current/20 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[8px] font-mono text-current/60">Affinity</span>
                      <div className="w-24 h-1 bg-current/20 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-current/60 transition-all"
                          style={{ width: `${(event.data.score / 100) * 100}%` }}
                        />
                      </div>
                    </div>
                    {event.data.last_delta !== 0 && (
                      <p className={`text-[8px] font-mono ${
                        event.data.last_delta > 0 ? "text-green-400" : "text-red-400"
                      }`}>
                        {event.data.last_delta > 0 ? "↑" : "↓"} {Math.abs(event.data.last_delta)} pts
                      </p>
                    )}
                  </div>
                )}

                {/* Interaction count for memories */}
                {isMemory && event.data.tags?.includes("interaction") && (
                  <div className="pt-2 border-t border-current/20">
                    <span className="text-[8px] font-mono text-current/60">
                      Reinforced through repeated interactions
                    </span>
                  </div>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Summary Stats */}
      {(memories.length > 0 || relationships.length > 0) && (
        <div className="mt-8 pt-6 border-t border-primary/10 grid grid-cols-3 gap-3">
          {memories.length > 0 && (
            <div className="p-3 border border-primary/15 bg-primary/5 text-center">
              <p className="font-mono text-[8px] text-primary/40 tracking-widest uppercase">
                Memories
              </p>
              <p className="font-mono text-lg text-primary mt-1">{memories.length}</p>
            </div>
          )}
          {relationships.length > 0 && (
            <div className="p-3 border border-primary/15 bg-primary/5 text-center">
              <p className="font-mono text-[8px] text-primary/40 tracking-widest uppercase">
                Relationships
              </p>
              <p className="font-mono text-lg text-primary mt-1">{relationships.length}</p>
            </div>
          )}
          {relationships.length > 0 && (
            <div className="p-3 border border-primary/15 bg-primary/5 text-center">
              <p className="font-mono text-[8px] text-primary/40 tracking-widest uppercase">
                Avg Affinity
              </p>
              <p className="font-mono text-lg text-primary mt-1">
                {Math.round(relationships.reduce((sum, r) => sum + (r.score || 0), 0) / relationships.length)}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}