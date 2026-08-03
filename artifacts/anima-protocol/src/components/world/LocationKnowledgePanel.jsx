import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { MapPin, Clock, Users, Sparkles, ChevronDown, Loader } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function LocationKnowledgePanel({ sessionId, characterId, characterName }) {
  const [locations, setLocations] = useState([]);
  const [characterLocations, setCharacterLocations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expandedLocation, setExpandedLocation] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  useEffect(() => {
    if (sessionId) {
      loadLocationData();
    }
  }, [sessionId, characterId]);

  const loadLocationData = async () => {
    setLoading(true);
    try {
      // Fetch all locations for session
      const locs = await base44.asServiceRole.entities.Location.filter(
        { session_id: sessionId },
        "-created_date",
        100
      );
      setLocations(locs || []);

      // Load character's location knowledge if available
      if (characterId) {
        const charMemories = await base44.entities.CharacterMemory.filter(
          { character_id: characterId, category: "location_knowledge" },
          "-created_date",
          50
        );
        setCharacterLocations(charMemories || []);
      }

      setLastUpdated(new Date());
    } catch (err) {
      console.error("Error loading location data:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleExtractLocations = async () => {
    setLoading(true);
    try {
      // Fetch recent messages
      const sessions = await base44.asServiceRole.entities.ChatSession.list("-updated_date", 1);
      const session = sessions.find((s) => s.id === sessionId);

      if (!session || !session.messages) {
        setLoading(false);
        return;
      }

      // Extract locations using LLM function
      const result = await base44.functions.invoke("extractLocationContext", {
        session_id: sessionId,
        messages: session.messages.slice(-30),
      });

      if (result?.data?.character_locations && characterId) {
        // Save location knowledge for character
        const locationsForChar = result.data.character_locations[characterName] || [];
        for (const loc of locationsForChar) {
          await base44.entities.CharacterMemory.create({
            character_id: characterId,
            category: "location_knowledge",
            fact: `At ${loc.location}: ${loc.context}`,
            session_context: sessionId,
          });
        }
      }

      await loadLocationData();
    } catch (err) {
      console.error("Error extracting locations:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3 mb-4">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border border-primary/15 bg-primary/5 rounded">
        <div className="flex items-center gap-2">
          <MapPin className="w-4 h-4 text-primary/60" />
          <span className="font-mono text-[9px] text-primary/40 tracking-widest uppercase">
            Location Knowledge ({locations.length} discovered)
          </span>
        </div>
        <button
          onClick={handleExtractLocations}
          disabled={loading}
          className="flex items-center gap-1 px-2.5 py-1 border border-primary/25 text-primary/50 hover:text-primary/80 font-mono text-[8px] tracking-widest uppercase transition-all disabled:opacity-30"
        >
          {loading ? (
            <Loader className="w-3 h-3 animate-spin" />
          ) : (
            <Sparkles className="w-3 h-3" />
          )}
          Extract
        </button>
      </div>

      {/* Locations List */}
      {locations.length > 0 ? (
        <div className="space-y-1.5 max-h-64 overflow-y-auto">
          {locations.map((loc) => {
            const charKnowledge = characterLocations.filter(
              (mem) => mem.fact.includes(loc.name)
            );
            const isExpanded = expandedLocation === loc.id;

            return (
              <motion.div
                key={loc.id}
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                className="border border-primary/15 bg-black/30 rounded overflow-hidden"
              >
                <button
                  onClick={() => setExpandedLocation(isExpanded ? null : loc.id)}
                  className="w-full flex items-center justify-between p-3 hover:bg-primary/10 transition-colors"
                >
                  <div className="flex items-start gap-2 min-w-0 text-left">
                    <span className="text-xl flex-shrink-0">{loc.icon_emoji || "📍"}</span>
                    <div className="min-w-0">
                      <p className="font-mono text-[10px] text-primary/80 tracking-wider truncate">
                        {loc.name}
                      </p>
                      <p className="text-[9px] text-primary/30 truncate mt-0.5">
                        {loc.description?.slice(0, 50)}...
                      </p>
                      <div className="flex items-center gap-2 mt-1 text-[8px] text-primary/40">
                        <Clock className="w-2.5 h-2.5" />
                        <span>{new Date(loc.updated_date).toLocaleDateString()}</span>
                      </div>
                    </div>
                  </div>
                  <ChevronDown
                    className={`w-4 h-4 text-primary/40 flex-shrink-0 transition-transform ${
                      isExpanded ? "rotate-180" : ""
                    }`}
                  />
                </button>

                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="border-t border-primary/10 px-3 py-2 bg-black/50 space-y-2"
                    >
                      {/* Full Description */}
                      <div>
                        <p className="text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-1">
                          Description
                        </p>
                        <p className="text-[9px] font-mono text-primary/70 leading-relaxed">
                          {loc.description}
                        </p>
                      </div>

                      {/* Character Knowledge */}
                      {charKnowledge.length > 0 && characterId && (
                        <div>
                          <p className="text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-1">
                            {characterName}'s Memories Here
                          </p>
                          <div className="space-y-1">
                            {charKnowledge.map((mem, idx) => (
                              <div
                                key={idx}
                                className="p-1.5 bg-black/40 border-l-2 border-primary/30 text-[8px] font-mono text-primary/60"
                              >
                                {mem.fact}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Metadata */}
                      <div className="flex items-center gap-3 text-[8px] font-mono text-primary/40">
                        <span className="px-1.5 py-0.5 border border-primary/20 bg-black/30 rounded">
                          {loc.category}
                        </span>
                        <span>{loc.significance}</span>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>
      ) : (
        <div className="text-center py-8 border border-primary/15 bg-black/30 rounded">
          <MapPin className="w-8 h-8 text-primary/20 mx-auto mb-2" />
          <p className="font-mono text-[9px] text-primary/30 tracking-widest uppercase">
            No locations discovered yet
          </p>
          <button
            onClick={handleExtractLocations}
            disabled={loading}
            className="mt-3 px-3 py-1.5 border border-primary/25 text-primary/50 hover:text-primary/80 font-mono text-[8px] tracking-widest uppercase transition-all disabled:opacity-30"
          >
            Extract from Chat
          </button>
        </div>
      )}

      {/* Last Updated */}
      {lastUpdated && (
        <p className="text-[8px] font-mono text-primary/25">
          Updated: {lastUpdated.toLocaleTimeString()}
        </p>
      )}
    </div>
  );
}