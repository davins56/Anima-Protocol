import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { X, MapPin, Users, Zap, BookOpen } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function InteractiveWorldMap({ sessionId }) {
  const [locations, setLocations] = useState([]);
  const [selectedLocation, setSelectedLocation] = useState(null);
  const [mapDimensions, setMapDimensions] = useState({ width: 800, height: 600 });
  const [loading, setLoading] = useState(true);
  const [loreEntries, setLoreEntries] = useState([]);
  const [events, setEvents] = useState([]);
  const [characters, setCharacters] = useState([]);

  useEffect(() => {
    loadMapData();
  }, [sessionId]);

  const loadMapData = async () => {
    setLoading(true);
    try {
      const [locData, loreData, eventData, charData] = await Promise.all([
        base44.entities.Location.list("-created_date", 100),
        base44.entities.WorldState.filter({ session_id: sessionId, is_active: true }, "-created_date", 50),
        base44.functions.invoke("autoEvolveWorldState", { session_id: sessionId, message_count: 1, recent_messages: [] }).then(r => r?.data?.world_events || []),
        base44.entities.Character.list("-created_date", 100),
      ]);
      setLocations(locData || []);
      setLoreEntries(loreData || []);
      setEvents(eventData || []);
      setCharacters(charData || []);
    } catch (err) {
      console.error("Error loading map data:", err);
    } finally {
      setLoading(false);
    }
  };

  const getLocationLore = (locId) => {
    return loreEntries.filter((e) => e.subject?.toLowerCase().includes(locations.find(l => l.id === locId)?.name?.toLowerCase() || ""));
  };

  const getLocationEvents = (locId) => {
    const loc = locations.find(l => l.id === locId);
    return events.filter((e) => e.subject?.toLowerCase().includes(loc?.name?.toLowerCase() || ""));
  };

  const getLocationCharacters = (locId) => {
    const loc = locations.find(l => l.id === locId);
    // Simple heuristic: match characters mentioned in lore for this location
    const locLore = getLocationLore(locId);
    return characters.filter(c => 
      locLore.some(l => l.fact?.toLowerCase().includes(c.name?.toLowerCase() || ""))
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-primary/20 border-t-primary rounded-full animate-spin mx-auto mb-2" />
          <p className="font-mono text-[9px] text-primary/30 tracking-widest uppercase">Loading map...</p>
        </div>
      </div>
    );
  }

  if (locations.length === 0) {
    return (
      <div className="flex items-center justify-center h-96 p-4">
        <p className="font-mono text-[9px] text-primary/20 tracking-widest uppercase text-center">No locations discovered yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Map Canvas */}
      <div className="border border-primary/20 bg-black/40 rounded overflow-hidden" style={{ aspectRatio: "4/3" }}>
        <svg
          viewBox="0 0 1000 750"
          className="w-full h-full bg-gradient-to-b from-blue-950 to-black/60"
          style={{
            backgroundImage: "radial-gradient(circle at 20% 50%, hsl(200 80% 20% / 0.2) 0%, transparent 50%)",
          }}
        >
          {/* Grid overlay */}
          <defs>
            <pattern id="grid" width="100" height="100" patternUnits="userSpaceOnUse">
              <path d="M 100 0 L 0 0 0 100" fill="none" stroke="hsl(185 100% 50% / 0.05)" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width="1000" height="750" fill="url(#grid)" />

          {/* Locations */}
          {locations.map((loc) => (
            <g
              key={loc.id}
              className="cursor-pointer"
              onClick={() => setSelectedLocation(loc)}
            >
              {/* Location glow */}
              <circle
                cx={loc.x_coord * 10}
                cy={loc.y_coord * 10}
                r="25"
                fill={loc.color_hex || "#60A5FA"}
                opacity="0.15"
                className="hover:opacity-30 transition-opacity"
              />

              {/* Location marker */}
              <circle
                cx={loc.x_coord * 10}
                cy={loc.y_coord * 10}
                r="12"
                fill={loc.color_hex || "#60A5FA"}
                stroke="hsl(185 100% 50%)"
                strokeWidth="2"
                className="hover:r-15 transition-all"
              />

              {/* Location icon */}
              <text
                x={loc.x_coord * 10}
                y={loc.y_coord * 10}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize="14"
                className="pointer-events-none select-none"
              >
                {loc.icon_emoji || "📍"}
              </text>

              {/* Location label */}
              {selectedLocation?.id === loc.id && (
                <g>
                  <rect
                    x={loc.x_coord * 10 - 60}
                    y={loc.y_coord * 10 - 45}
                    width="120"
                    height="40"
                    rx="4"
                    fill="hsl(220 20% 6%)"
                    stroke={loc.color_hex || "#60A5FA"}
                    strokeWidth="1"
                    opacity="0.95"
                  />
                  <text
                    x={loc.x_coord * 10}
                    y={loc.y_coord * 10 - 25}
                    textAnchor="middle"
                    fontSize="12"
                    fill="hsl(185 100% 80%)"
                    className="font-mono font-bold"
                  >
                    {loc.name}
                  </text>
                  <text
                    x={loc.x_coord * 10}
                    y={loc.y_coord * 10 - 10}
                    textAnchor="middle"
                    fontSize="10"
                    fill="hsl(185 30% 50%)"
                  >
                    {loc.category}
                  </text>
                </g>
              )}
            </g>
          ))}
        </svg>
      </div>

      {/* Location Details Panel */}
      <AnimatePresence>
        {selectedLocation && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="border border-primary/20 bg-black/40 rounded overflow-hidden"
          >
            <div className="p-4 space-y-4">
              {/* Header */}
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-mono text-lg text-primary tracking-wider uppercase">
                    {selectedLocation.icon_emoji} {selectedLocation.name}
                  </h3>
                  <p className="text-[9px] font-mono text-primary/40 mt-1">
                    {selectedLocation.category} • Significance: {selectedLocation.significance}
                  </p>
                </div>
                <button
                  onClick={() => setSelectedLocation(null)}
                  className="text-primary/30 hover:text-primary transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Description */}
              {selectedLocation.description && (
                <p className="font-mono text-[10px] text-primary/70 leading-relaxed">
                  {selectedLocation.description}
                </p>
              )}

              {/* Lore Section */}
              {getLocationLore(selectedLocation.id).length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <BookOpen className="w-3.5 h-3.5 text-primary/60" />
                    <span className="text-[9px] font-mono text-primary/40 tracking-widest uppercase">Lore</span>
                  </div>
                  <div className="space-y-1.5 pl-4 border-l border-primary/15">
                    {getLocationLore(selectedLocation.id).map((entry, idx) => (
                      <div key={idx} className="text-[9px] font-mono text-primary/60">
                        <span className="text-primary/40">•</span> {entry.fact}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Events Section */}
              {getLocationEvents(selectedLocation.id).length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Zap className="w-3.5 h-3.5 text-yellow-400" />
                    <span className="text-[9px] font-mono text-yellow-400/60 tracking-widest uppercase">Active Events</span>
                  </div>
                  <div className="space-y-1.5 pl-4 border-l border-yellow-400/15">
                    {getLocationEvents(selectedLocation.id).map((event, idx) => (
                      <div key={idx} className="text-[9px] font-mono text-yellow-400/70">
                        <span className="text-yellow-400/40">⚡</span> {event.subject}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Characters Section */}
              {getLocationCharacters(selectedLocation.id).length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Users className="w-3.5 h-3.5 text-cyan-400" />
                    <span className="text-[9px] font-mono text-cyan-400/60 tracking-widest uppercase">Characters</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {getLocationCharacters(selectedLocation.id).map((char) => (
                      <div
                        key={char.id}
                        className="px-2 py-1 border border-cyan-400/30 bg-cyan-400/5 rounded text-[9px] font-mono text-cyan-400/80"
                      >
                        {char.name}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Visit status */}
              {selectedLocation.visited && (
                <div className="text-[8px] font-mono text-primary/40 italic">
                  ✓ Visited in previous session
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Map Legend */}
      <div className="p-3 border border-primary/10 bg-black/30 rounded text-[8px] font-mono text-primary/40">
        <p className="tracking-widest uppercase mb-2">Map Legend</p>
        <div className="grid grid-cols-2 gap-2">
          {["city", "dungeon", "wilderness", "building"].map((cat) => (
            <div key={cat} className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-primary/40" />
              <span className="capitalize">{cat}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}