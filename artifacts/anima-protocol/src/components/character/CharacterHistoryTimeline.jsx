import { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Calendar, MapPin, Heart, Zap, Loader, AlertCircle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { format } from "date-fns";

const TAG_ICONS = {
  relationship: "💝",
  betrayal: "💔",
  achievement: "🏆",
  trauma: "⚡",
  secret: "🔐",
  alliance: "🤝",
  conflict: "⚔️",
  personal: "🎭",
  "world-event": "🌍",
  evolution: "🦋",
};

const TAG_COLORS = {
  relationship: "border-pink-400/30 bg-pink-400/5 text-pink-400",
  betrayal: "border-red-400/30 bg-red-400/5 text-red-400",
  achievement: "border-green-400/30 bg-green-400/5 text-green-400",
  trauma: "border-red-400/30 bg-red-400/5 text-red-400",
  secret: "border-purple-400/30 bg-purple-400/5 text-purple-400",
  alliance: "border-blue-400/30 bg-blue-400/5 text-blue-400",
  conflict: "border-orange-400/30 bg-orange-400/5 text-orange-400",
  personal: "border-cyan-400/30 bg-cyan-400/5 text-cyan-400",
  "world-event": "border-yellow-400/30 bg-yellow-400/5 text-yellow-400",
  evolution: "border-lime-400/30 bg-lime-400/5 text-lime-400",
};

export default function CharacterHistoryTimeline({ characterId, characterName }) {
  const [memories, setMemories] = useState([]);
  const [locations, setLocations] = useState([]);
  const [emotionalStates, setEmotionalStates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);
  const [filterTag, setFilterTag] = useState("all");

  useEffect(() => {
    if (characterId) {
      loadTimelineData();
    }
  }, [characterId]);

  const loadTimelineData = async () => {
    setLoading(true);
    try {
      // Load memories
      const memoryData = await base44.entities.CharacterMemory.filter(
        { character_id: characterId },
        "-created_date",
        100
      );
      setMemories(memoryData || []);

      // Load all locations for linking
      const locData = await base44.entities.Location.list("-created_date", 100);
      setLocations(locData || []);

      // Load character emotional states
      const emotionalData = await base44.entities.CharacterEmotionalState.filter(
        { character_id: characterId },
        "-created_date",
        100
      );
      setEmotionalStates(emotionalData || []);
    } catch (err) {
      console.error("Error loading timeline data:", err);
    } finally {
      setLoading(false);
    }
  };

  const findRelatedLocation = (memoryText) => {
    // Find locations mentioned in memory text
    return locations.find(loc =>
      memoryText.toLowerCase().includes(loc.name.toLowerCase())
    ) || null;
  };

  const findRelatedEmotions = (memoryDate) => {
    // Find emotional states closest to this memory's date
    if (!memoryDate) return [];
    const memDate = new Date(memoryDate);
    return emotionalStates.filter(es => {
      const esDate = new Date(es.created_date);
      const dayDiff = Math.abs((memDate - esDate) / (1000 * 60 * 60 * 24));
      return dayDiff <= 3; // Within 3 days
    }).slice(0, 2);
  };

  const filteredMemories =
    filterTag === "all"
      ? memories
      : memories.filter(m => (m.tags || []).includes(filterTag));

  // Get all unique tags from memories
  const uniqueTags = Array.from(
    new Set(memories.flatMap(m => m.tags || []))
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center space-y-2">
          <Loader className="w-5 h-5 text-primary/60 animate-spin mx-auto" />
          <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase">
            Loading history...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h3 className="font-mono text-sm text-primary tracking-widest uppercase">
          Character History
        </h3>
        <p className="text-[9px] font-mono text-primary/40 mt-1">
          {filteredMemories.length} event{filteredMemories.length !== 1 ? "s" : ""} • Timeline of key moments
        </p>
      </div>

      {/* Filter Tags */}
      {uniqueTags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setFilterTag("all")}
            className={`px-2.5 py-1.5 border rounded font-mono text-[8px] tracking-widest uppercase transition-all ${
              filterTag === "all"
                ? "border-primary/60 bg-primary/10 text-primary"
                : "border-primary/15 bg-black/30 text-primary/50 hover:text-primary/70"
            }`}
          >
            All ({memories.length})
          </button>
          {uniqueTags.map(tag => (
            <button
              key={tag}
              onClick={() => setFilterTag(tag)}
              className={`px-2.5 py-1.5 border rounded font-mono text-[8px] tracking-widest uppercase transition-all ${
                filterTag === tag
                  ? `${TAG_COLORS[tag]} border-opacity-60`
                  : "border-primary/15 bg-black/30 text-primary/50 hover:text-primary/70"
              }`}
            >
              {TAG_ICONS[tag]} {tag}
            </button>
          ))}
        </div>
      )}

      {/* Timeline */}
      <div className="relative">
        {filteredMemories.length === 0 ? (
          <div className="p-4 text-center border border-primary/10 bg-black/30 rounded">
            <AlertCircle className="w-5 h-5 text-primary/30 mx-auto mb-2" />
            <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase">
              {memories.length === 0
                ? "No history yet"
                : "No events match this filter"}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Vertical Timeline Line */}
            <div className="absolute left-2.5 top-0 bottom-0 w-0.5 bg-gradient-to-b from-primary/60 via-primary/30 to-primary/0" />

            {filteredMemories.map((memory, idx) => {
              const relatedLocation = findRelatedLocation(memory.fact);
              const relatedEmotions = findRelatedEmotions(memory.created_date);
              const primaryTag = memory.tags?.[0] || memory.category;

              return (
                <motion.div
                  key={memory.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.05 }}
                  className="relative pl-10"
                >
                  {/* Timeline Dot */}
                  <div className="absolute -left-1.5 top-1.5 w-5 h-5 bg-black border-2 border-primary/60 rounded-full z-10 flex items-center justify-center">
                    <div className="w-1.5 h-1.5 bg-primary rounded-full" />
                  </div>

                  {/* Content Card */}
                  <motion.button
                    onClick={() => setExpandedId(expandedId === memory.id ? null : memory.id)}
                    className={`w-full text-left p-3 border rounded transition-all ${
                      expandedId === memory.id
                        ? "border-primary/40 bg-primary/10"
                        : "border-primary/20 bg-black/30 hover:border-primary/30 hover:bg-black/50"
                    }`}
                  >
                    {/* Header Row */}
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          {primaryTag && (
                            <span className={`px-2 py-0.5 border rounded text-[7px] font-mono tracking-widest uppercase ${TAG_COLORS[primaryTag] || "border-primary/20 text-primary/60"}`}>
                              {TAG_ICONS[primaryTag]} {primaryTag}
                            </span>
                          )}
                          {memory.created_date && (
                            <span className="text-[8px] font-mono text-primary/50 flex items-center gap-1">
                              <Calendar className="w-3 h-3" />
                              {format(new Date(memory.created_date), "MMM d, yyyy")}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Memory Text */}
                    <p className="text-[9px] font-mono text-primary/80 leading-relaxed mb-2 line-clamp-2">
                      {memory.fact}
                    </p>

                    {/* Metadata Row */}
                    <div className="flex items-center gap-3 flex-wrap text-[8px] font-mono text-primary/50">
                      {relatedLocation && (
                        <div className="flex items-center gap-1 px-2 py-1 border border-primary/15 bg-black/40 rounded">
                          <MapPin className="w-3 h-3" />
                          {relatedLocation.name}
                        </div>
                      )}
                      {relatedEmotions.length > 0 && (
                        <div className="flex items-center gap-1 px-2 py-1 border border-primary/15 bg-black/40 rounded">
                          <Heart className="w-3 h-3" />
                          {relatedEmotions.map(e => e.primary_emotion).join(", ")}
                        </div>
                      )}
                    </div>
                  </motion.button>

                  {/* Expanded Details */}
                  <AnimatePresence>
                    {expandedId === memory.id && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="mt-2 p-3 border border-primary/20 bg-black/50 rounded space-y-2"
                      >
                        {/* Full Memory Text */}
                        <div>
                          <p className="text-[8px] font-mono text-primary/50 tracking-widest uppercase mb-1">
                            Full Event
                          </p>
                          <p className="text-[9px] font-mono text-primary/80 leading-relaxed">
                            {memory.fact}
                          </p>
                        </div>

                        {/* All Tags */}
                        {memory.tags && memory.tags.length > 0 && (
                          <div>
                            <p className="text-[8px] font-mono text-primary/50 tracking-widest uppercase mb-1">
                              Tags
                            </p>
                            <div className="flex flex-wrap gap-1">
                              {memory.tags.map(tag => (
                                <span
                                  key={tag}
                                  className={`px-2 py-0.5 border rounded text-[7px] font-mono tracking-widest uppercase ${TAG_COLORS[tag] || "border-primary/20 text-primary/60"}`}
                                >
                                  {TAG_ICONS[tag]} {tag}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Related Emotions */}
                        {relatedEmotions.length > 0 && (
                          <div>
                            <p className="text-[8px] font-mono text-primary/50 tracking-widest uppercase mb-1">
                              Related Emotional State
                            </p>
                            <div className="space-y-1">
                              {relatedEmotions.map(emotion => (
                                <div key={emotion.id} className="p-2 border border-primary/15 bg-black/40 rounded text-[8px] font-mono">
                                  <div className="flex items-center justify-between mb-1">
                                    <span className="text-primary/70">
                                      <Zap className="w-2.5 h-2.5 inline mr-1" />
                                      {emotion.primary_emotion}
                                    </span>
                                    <span className="text-primary/50">
                                      Intensity: {emotion.intensity}/10
                                    </span>
                                  </div>
                                  {emotion.trigger && (
                                    <p className="text-primary/60">
                                      Trigger: {emotion.trigger}
                                    </p>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Location Context */}
                        {relatedLocation && (
                          <div>
                            <p className="text-[8px] font-mono text-primary/50 tracking-widest uppercase mb-1">
                              Location Context
                            </p>
                            <div className="p-2 border border-primary/15 bg-black/40 rounded text-[8px] font-mono space-y-1">
                              <div className="font-semibold text-primary/80 flex items-center gap-1.5">
                                <MapPin className="w-3 h-3" />
                                {relatedLocation.name}
                              </div>
                              {relatedLocation.description && (
                                <p className="text-primary/60">{relatedLocation.description}</p>
                              )}
                              <div className="text-primary/50 text-[7px]">
                                Category: {relatedLocation.category} • Significance: {relatedLocation.significance}
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Timestamp */}
                        <div className="text-[8px] font-mono text-primary/30 pt-1 border-t border-primary/10">
                          Added {memory.created_date ? format(new Date(memory.created_date), "PPP p") : "Recently"}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}