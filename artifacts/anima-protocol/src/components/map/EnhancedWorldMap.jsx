import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { MapPin, X, Users, Zap, BookOpen, ChevronRight } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function EnhancedWorldMap({ sessionId }) {
  const [locations, setLocations] = useState([]);
  const [lore, setLore] = useState([]);
  const [characters, setCharacters] = useState([]);
  const [worldEvents, setWorldEvents] = useState([]);
  const [selectedLocation, setSelectedLocation] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (sessionId) {
      loadMapData();
    }
  }, [sessionId]);

  const loadMapData = async () => {
    setLoading(true);
    try {
      const [locsRes, loreRes, charsRes, eventsRes] = await Promise.all([
        base44.entities.Location.list("-created_date", 100),
        base44.entities.WorldState.filter({ session_id: sessionId, is_active: true }, "-created_date", 50),
        base44.entities.Character.list("-created_date", 100),
        base44.functions.invoke("generateWorldEvent", { session_id: sessionId }),
      ]);

      setLocations(locsRes || []);
      setLore(loreRes || []);
      setCharacters(charsRes || []);
      if (eventsRes?.data) setWorldEvents([eventsRes.data]);
    } catch (err) {
      console.error("Error loading map data:", err);
    } finally {
      setLoading(false);
    }
  };

  const getLocationLore = (locationId) => {
    return lore.filter((l) =>
      l.subject === locations.find((loc) => loc.id === locationId)?.name
    );
  };

  const getLocationEvents = (locationId) => {
    const locName = locations.find((loc) => loc.id === locationId)?.name || "";
    return worldEvents.filter((e) => e.location === locName || e.title?.includes(locName));
  };

  const getLocationCharacters = (locationId) => {
    // In a real scenario, this would track character positions
    // For now, we'll show characters with matching description
    const locName = locations.find((loc) => loc.id === locationId)?.name || "";
    return characters.filter((c) => c.universe?.includes(locName) || c.backstory?.includes(locName));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="font-mono text-[10px] text-primary/40 tracking-widest uppercase animate-pulse">
          Loading world map...
        </p>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full bg-black/40 border border-primary/20 rounded overflow-hidden">
      {/* SVG Map Canvas */}
      <svg
        viewBox="0 0 800 600"
        className="w-full h-full"
        style={{ backgroundColor: "hsl(220 20% 4%)" }}
      >
        {/* Grid background */}
        <defs>
          <pattern id="grid" width="50" height="50" patternUnits="userSpaceOnUse">
            <path d="M 50 0 L 0 0 0 50" fill="none" stroke="hsl(185 100% 50% / 0.05)" strokeWidth="0.5" />
          </pattern>
        </defs>
        <rect width="800" height="600" fill="url(#grid)" />

        {/* Locations */}
        {locations.map((loc) => (
          <g key={loc.id}>
            {/* Location marker circle */}
            <circle
              cx={loc.x_coord * 8}
              cy={loc.y_coord * 6}
              r="12"
              fill={loc.color_hex || "#60A5FA"}
              opacity="0.3"
              className="hover:opacity-60 transition-opacity cursor-pointer"
              onClick={() => setSelectedLocation(loc)}
            />
            <circle
              cx={loc.x_coord * 8}
              cy={loc.y_coord * 6}
              r="12"
              fill="none"
              stroke={loc.color_hex || "#60A5FA"}
              strokeWidth="2"
              className="hover:stroke-width[3] transition-all cursor-pointer"
              onClick={() => setSelectedLocation(loc)}
            />

            {/* Location name label */}
            <text
              x={loc.x_coord * 8}
              y={loc.y_coord * 6 + 28}
              textAnchor="middle"
              className="font-mono text-[10px] fill-current"
              style={{ color: loc.color_hex || "#60A5FA" }}
              onClick={() => setSelectedLocation(loc)}
              style={{ cursor: "pointer", pointerEvents: "auto" }}
            >
              {loc.name}
            </text>

            {/* Significance indicator */}
            {loc.significance === "critical" && (
              <>
                <circle cx={loc.x_coord * 8} cy={loc.y_coord * 6} r="18" fill="none" stroke={loc.color_hex || "#60A5FA"} strokeWidth="1" opacity="0.5" />
                <circle cx={loc.x_coord * 8} cy={loc.y_coord * 6} r="24" fill="none" stroke={loc.color_hex || "#60A5FA"} strokeWidth="0.5" opacity="0.3" />
              </>
            )}
          </g>
        ))}

        {/* Connection lines between related locations */}
        {lore
          .filter((l) => l.category === "location")
          .map((l, idx) => {
            const fromLoc = locations.find((loc) => loc.name === l.subject);
            const toLoc = locations.find((loc) => loc.name?.includes(l.fact.split(" ")[0]));
            if (!fromLoc || !toLoc) return null;
            return (
              <line
                key={idx}
                x1={fromLoc.x_coord * 8}
                y1={fromLoc.y_coord * 6}
                x2={toLoc.x_coord * 8}
                y2={toLoc.y_coord * 6}
                stroke="hsl(185 100% 50% / 0.2)"
                strokeWidth="1"
                strokeDasharray="5,5"
              />
            );
          })}
      </svg>

      {/* Location Details Panel */}
      <AnimatePresence>
        {selectedLocation && (
          <motion.div
            initial={{ opacity: 0, x: 400 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 400 }}
            className="absolute inset-y-0 right-0 w-96 bg-black/80 border-l border-primary/30 backdrop-blur-md overflow-y-auto flex flex-col"
          >
            {/* Header */}
            <div className="flex items-start justify-between p-4 border-b border-primary/20 flex-shrink-0">
              <div>
                <h2 className="font-mono text-lg text-primary glow-text tracking-wider uppercase">
                  {selectedLocation.name}
                </h2>
                <p className="text-[9px] font-mono text-primary/40 mt-1 tracking-widest">
                  {selectedLocation.category?.toUpperCase()} · {selectedLocation.significance?.toUpperCase()}
                </p>
              </div>
              <button
                onClick={() => setSelectedLocation(null)}
                className="text-primary/30 hover:text-primary transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Description */}
              <div>
                <p className="text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-2">
                  Description
                </p>
                <p className="text-sm font-mono text-primary/80 leading-relaxed">
                  {selectedLocation.description}
                </p>
              </div>

              {/* Coordinates */}
              <div className="p-3 border border-primary/15 bg-primary/5 rounded">
                <p className="text-[8px] font-mono text-primary/40 tracking-widest uppercase mb-1">
                  Coordinates
                </p>
                <p className="text-[10px] font-mono text-primary/70">
                  X: {selectedLocation.x_coord.toFixed(1)} · Y: {selectedLocation.y_coord.toFixed(1)}
                </p>
              </div>

              {/* Lore Entries */}
              {getLocationLore(selectedLocation.id).length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <BookOpen className="w-3.5 h-3.5 text-cyan-400" />
                    <p className="text-[9px] font-mono text-cyan-400 tracking-widest uppercase">
                      Lore ({getLocationLore(selectedLocation.id).length})
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    {getLocationLore(selectedLocation.id).map((entry, idx) => (
                      <div key={idx} className="p-2 border border-cyan-400/20 bg-cyan-400/5 rounded">
                        <p className="text-[9px] font-mono text-cyan-300">{entry.fact}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Active Events */}
              {getLocationEvents(selectedLocation.id).length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Zap className="w-3.5 h-3.5 text-yellow-400" />
                    <p className="text-[9px] font-mono text-yellow-400 tracking-widest uppercase">
                      Active Events ({getLocationEvents(selectedLocation.id).length})
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    {getLocationEvents(selectedLocation.id).map((event, idx) => (
                      <div key={idx} className="p-2 border border-yellow-400/20 bg-yellow-400/5 rounded">
                        <p className="text-[9px] font-mono text-yellow-300 font-semibold">{event.title}</p>
                        <p className="text-[8px] font-mono text-yellow-200/70 mt-0.5">{event.description}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Characters Present */}
              {getLocationCharacters(selectedLocation.id).length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Users className="w-3.5 h-3.5 text-green-400" />
                    <p className="text-[9px] font-mono text-green-400 tracking-widest uppercase">
                      Characters ({getLocationCharacters(selectedLocation.id).length})
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    {getLocationCharacters(selectedLocation.id).map((char) => (
                      <div key={char.id} className="p-2 border border-green-400/20 bg-green-400/5 rounded">
                        <p className="text-[9px] font-mono text-green-300 font-semibold">{char.name}</p>
                        <p className="text-[8px] font-mono text-green-200/70 mt-0.5">{char.category || "character"}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Visit Status */}
              <div className="p-3 border border-primary/15 bg-primary/5 rounded">
                <p className="text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-1">
                  Visit Status
                </p>
                <p className="text-[10px] font-mono text-primary/70">
                  {selectedLocation.visited ? "✓ Visited" : "○ Unvisited"}
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Map Legend */}
      <div className="absolute bottom-4 left-4 p-3 bg-black/80 border border-primary/20 rounded max-w-xs backdrop-blur-md">
        <p className="text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-2">
          Map Legend
        </p>
        <div className="space-y-1 text-[8px] font-mono text-primary/60">
          <p>◯ Click location for details</p>
          <p>⊗⊕ Critical significance</p>
          <p>- - - Connected locations</p>
        </div>
      </div>
    </div>
  );
}