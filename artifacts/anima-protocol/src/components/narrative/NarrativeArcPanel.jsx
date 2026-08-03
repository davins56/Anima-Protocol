import { useState, useEffect } from "react";
import { ChevronDown, Loader, BookOpen, Zap } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const arcTypeLabels = {
  character_arc: "Character Arc",
  plot_arc: "Plot Arc",
  conflict: "Conflict",
  theme: "Theme",
  mystery: "Mystery",
};

const arcTypeColors = {
  character_arc: "border-pink-400/30 bg-pink-400/5 text-pink-400",
  plot_arc: "border-cyan-400/30 bg-cyan-400/5 text-cyan-400",
  conflict: "border-red-400/30 bg-red-400/5 text-red-400",
  theme: "border-purple-400/30 bg-purple-400/5 text-purple-400",
  mystery: "border-yellow-400/30 bg-yellow-400/5 text-yellow-400",
};

const statusLabels = {
  active: "🔥 Active",
  developing: "📈 Developing",
  resolved: "✓ Resolved",
  dormant: "💤 Dormant",
};

export default function NarrativeArcPanel({ arcs, loading }) {
  const [expandedArc, setExpandedArc] = useState(null);

  if (!arcs || arcs.length === 0) {
    return null;
  }

  // Group arcs by type
  const arcsByType = {};
  arcs.forEach(arc => {
    if (!arcsByType[arc.arc_type]) {
      arcsByType[arc.arc_type] = [];
    }
    arcsByType[arc.arc_type].push(arc);
  });

  return (
    <div className="space-y-3 mb-4">
      <div className="flex items-center gap-2 px-3 py-1.5 border border-primary/15 bg-primary/5 rounded">
        <BookOpen className="w-3 h-3 text-primary/50" />
        <span className="font-mono text-[9px] text-primary/40 tracking-widest uppercase">
          Persistent Narrative Arcs ({arcs.length})
        </span>
        {loading && <Loader className="w-2.5 h-2.5 text-primary/40 animate-spin ml-auto" />}
      </div>

      <AnimatePresence>
        {Object.entries(arcsByType).map(([typeKey, typeArcs]) => (
          <motion.div
            key={typeKey}
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className={`border rounded space-y-1.5 overflow-hidden ${arcTypeColors[typeKey]}`}
          >
            {/* Section Header */}
            <div className="px-3 py-2 border-b border-current border-opacity-20">
              <p className="font-mono text-[9px] font-semibold tracking-widest uppercase">
                {arcTypeLabels[typeKey]} ({typeArcs.length})
              </p>
            </div>

            {/* Arcs */}
            <div className="px-3 py-2 space-y-1.5">
              {typeArcs.map((arc) => (
                <motion.button
                  key={arc.id}
                  onClick={() => setExpandedArc(expandedArc === arc.id ? null : arc.id)}
                  className="w-full text-left transition-all"
                  whileHover={{ scale: 1.02 }}
                >
                  <div className="p-2 bg-black/20 rounded hover:bg-black/40 transition-colors cursor-pointer">
                    {/* Arc Header */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="font-mono text-[10px] font-semibold tracking-wider truncate">
                          {arc.title}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[8px] font-mono tracking-widest opacity-70">
                            {statusLabels[arc.status] || "Unknown"}
                          </span>
                          {arc.emotional_weight && (
                            <div className="text-[8px] font-mono opacity-60">
                              <div className="w-12 h-1.5 border border-current opacity-30 rounded">
                                <div
                                  className="h-full bg-current transition-all"
                                  style={{ width: `${(arc.emotional_weight / 10) * 100}%` }}
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                      <ChevronDown
                        className={`w-3 h-3 flex-shrink-0 transition-transform ${
                          expandedArc === arc.id ? "rotate-180" : ""
                        }`}
                      />
                    </div>

                    {/* Expanded Content */}
                    <AnimatePresence>
                      {expandedArc === arc.id && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          className="mt-2 pt-2 border-t border-current border-opacity-20 space-y-1.5"
                        >
                          {/* Description */}
                          <p className="font-mono text-[9px] leading-relaxed opacity-80">
                            {arc.description}
                          </p>

                          {/* Related Sessions */}
                          {arc.related_sessions && arc.related_sessions.length > 0 && (
                            <div>
                              <p className="text-[8px] font-mono tracking-widest uppercase opacity-60 mb-1">
                                Appears in {arc.related_sessions.length} session(s)
                              </p>
                            </div>
                          )}

                          {/* Key Characters */}
                          {arc.related_characters && arc.related_characters.length > 0 && (
                            <div>
                              <p className="text-[8px] font-mono tracking-widest uppercase opacity-60 mb-1">
                                Characters
                              </p>
                              <div className="flex flex-wrap gap-1">
                                {arc.related_characters.map((char) => (
                                  <span key={char} className="px-1.5 py-0.5 bg-black/30 rounded text-[8px] font-mono opacity-70">
                                    {char}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Last Referenced */}
                          {arc.last_referenced && (
                            <p className="text-[8px] font-mono opacity-50 mt-1">
                              Last referenced:{" "}
                              {new Date(arc.last_referenced).toLocaleDateString()}
                            </p>
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </motion.button>
              ))}
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}