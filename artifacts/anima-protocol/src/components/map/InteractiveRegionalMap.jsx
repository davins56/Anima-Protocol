import { useState, useEffect, useRef } from "react";
import { ChevronDown, MapPin, Flag, Eye } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { base44 } from "@/api/base44Client";

const FACTION_COLORS = {
  color1: "#ff6b6b",
  color2: "#4ecdc4",
  color3: "#45b7d1",
  color4: "#96ceb4",
  color5: "#ffeaa7",
  color6: "#dfe6e9",
};

export default function InteractiveRegionalMap({ sessionId }) {
  const canvasRef = useRef(null);
  const [locations, setLocations] = useState([]);
  const [factions, setFactions] = useState([]);
  const [worldEvents, setWorldEvents] = useState([]);
  const [visitedLocations, setVisitedLocations] = useState(new Set());
  const [selectedLocation, setSelectedLocation] = useState(null);
  const [showLegend, setShowLegend] = useState(false);
  const [loading, setLoading] = useState(true);
  const [hoveredFaction, setHoveredFaction] = useState(null);

  useEffect(() => {
    loadMapData();
  }, [sessionId]);

  const loadMapData = async () => {
    setLoading(true);
    try {
      const [locs, facs, events] = await Promise.all([
        base44.entities.Location.list("-created_date", 100),
        base44.entities.Faction.list("-created_date", 50),
        base44.entities.WorldState.filter({ session_id: sessionId || "", category: "event" }, "-created_date", 100),
      ]);
      
      setLocations(locs || []);
      setFactions(facs || []);
      setWorldEvents(events || []);
      
      // Track visited locations from session
      if (sessionId) {
        const visited = locs?.filter(l => l.visited)?.map(l => l.id) || [];
        setVisitedLocations(new Set(visited));
      }
    } catch (err) {
      console.error("Error loading map data:", err);
    } finally {
      setLoading(false);
    }
  };

  const getFactionColor = (idx) => {
    const colors = Object.values(FACTION_COLORS);
    return colors[idx % colors.length];
  };

  const renderCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas || locations.length === 0) return;

    const ctx = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;

    // Clear canvas
    ctx.fillStyle = "hsl(220 20% 4%)";
    ctx.fillRect(0, 0, width, height);

    // Draw grid
    ctx.strokeStyle = "hsl(185 50% 15%)";
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.1;
    for (let i = 0; i <= 100; i += 10) {
      const x = (i / 100) * width;
      const y = (i / 100) * height;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Draw faction territories (semi-transparent regions)
    factions.forEach((faction, idx) => {
      const color = getFactionColor(idx);
      ctx.fillStyle = color + "15";
      const factionLocs = locations.filter(l => l.faction_id === faction.id);
      
      if (factionLocs.length > 0) {
        const minX = Math.min(...factionLocs.map(l => l.x_coord));
        const maxX = Math.max(...factionLocs.map(l => l.x_coord));
        const minY = Math.min(...factionLocs.map(l => l.y_coord));
        const maxY = Math.max(...factionLocs.map(l => l.y_coord));

        const x = (minX / 100) * width;
        const y = (minY / 100) * height;
        const w = ((maxX - minX + 10) / 100) * width;
        const h = ((maxY - minY + 10) / 100) * height;

        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = color + "40";
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, w, h);
      }
    });

    // Draw locations
    locations.forEach((loc) => {
      const x = (loc.x_coord / 100) * width;
      const y = (loc.y_coord / 100) * height;
      const isVisited = visitedLocations.has(loc.id);
      const isSelected = selectedLocation?.id === loc.id;

      // Location circle
      ctx.fillStyle = isVisited ? "hsl(185 100% 50%)" : "hsl(185 50% 30%)";
      ctx.beginPath();
      ctx.arc(x, y, isSelected ? 8 : 6, 0, Math.PI * 2);
      ctx.fill();

      // Border
      ctx.strokeStyle = isVisited ? "hsl(185 100% 80%)" : "hsl(185 50% 50%)";
      ctx.lineWidth = isSelected ? 3 : 2;
      ctx.stroke();

      // Visited indicator
      if (isVisited) {
        ctx.fillStyle = "hsl(185 100% 80%)";
        ctx.font = "bold 10px monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("✓", x, y);
      }
    });

    // Draw world events as markers
    worldEvents.forEach((event) => {
      const relLoc = locations.find(l => l.subject === event.subject);
      if (relLoc) {
        const x = (relLoc.x_coord / 100) * width;
        const y = (relLoc.y_coord / 100) * height;
        
        ctx.fillStyle = "hsl(0 84% 60%)";
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  };

  useEffect(() => {
    renderCanvas();
  }, [locations, visitedLocations, selectedLocation, factions, worldEvents]);

  const handleCanvasClick = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const width = canvas.width;
    const height = canvas.height;

    // Find clicked location
    locations.forEach((loc) => {
      const locX = (loc.x_coord / 100) * width;
      const locY = (loc.y_coord / 100) * height;
      const distance = Math.sqrt((x - locX) ** 2 + (y - locY) ** 2);

      if (distance < 10) {
        setSelectedLocation(loc);
        if (!visitedLocations.has(loc.id)) {
          setVisitedLocations(new Set([...visitedLocations, loc.id]));
          // Update database
          base44.entities.Location.update(loc.id, { visited: true }).catch(() => {});
        }
      }
    });
  };

  if (loading) {
    return (
      <div className="p-4 text-center">
        <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase animate-pulse">
          Loading regional map...
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3 mb-4">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border border-primary/20 bg-primary/5 rounded">
        <span className="font-mono text-[9px] text-primary/40 tracking-widest uppercase">
          🗺️ Regional Map ({locations.length} locations, {factions.length} factions)
        </span>
        <button
          onClick={() => setShowLegend(!showLegend)}
          className="text-primary/40 hover:text-primary transition-colors"
        >
          <ChevronDown className={`w-4 h-4 transition-transform ${showLegend ? "rotate-180" : ""}`} />
        </button>
      </div>

      {/* Legend */}
      <AnimatePresence>
        {showLegend && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="border border-primary/15 bg-black/30 rounded p-3 space-y-2 text-[8px] font-mono"
          >
            <div className="grid grid-cols-2 gap-2">
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-cyan-400" />
                <span className="text-primary/60">Visited Location</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-cyan-700" />
                <span className="text-primary/60">Unvisited Location</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
                <span className="text-primary/60">World Event</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 border border-cyan-500 rounded" />
                <span className="text-primary/60">Faction Territory</span>
              </div>
            </div>
            {factions.length > 0 && (
              <div className="border-t border-primary/10 pt-2 mt-2">
                <p className="text-primary/40 tracking-widest uppercase mb-1">Factions</p>
                <div className="grid grid-cols-2 gap-1">
                  {factions.map((faction, idx) => (
                    <div key={faction.id} className="flex items-center gap-1.5">
                      <div
                        className="w-2 h-2 rounded"
                        style={{ backgroundColor: getFactionColor(idx) }}
                      />
                      <span className="text-primary/60 truncate">{faction.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Canvas Map */}
      <div className="border border-primary/20 bg-black/40 rounded overflow-hidden">
        <canvas
          ref={canvasRef}
          width={800}
          height={500}
          onClick={handleCanvasClick}
          className="w-full cursor-crosshair bg-black/20"
        />
      </div>

      {/* Location Details */}
      {selectedLocation && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-3 border border-primary/20 bg-black/40 rounded space-y-2"
        >
          <div className="flex items-start justify-between">
            <div>
              <h3 className="font-mono text-sm text-primary tracking-wider uppercase">
                {selectedLocation.name}
              </h3>
              <p className="text-[9px] font-mono text-primary/50 mt-0.5">
                ({selectedLocation.x_coord}, {selectedLocation.y_coord})
              </p>
            </div>
            <div className="flex items-center gap-1">
              {visitedLocations.has(selectedLocation.id) && (
                <span className="flex items-center gap-1 px-2 py-1 bg-green-400/10 border border-green-400/30 rounded text-[8px] font-mono text-green-400">
                  <Eye className="w-3 h-3" /> Visited
                </span>
              )}
            </div>
          </div>
          <p className="text-[9px] font-mono text-primary/70 leading-relaxed">
            {selectedLocation.description}
          </p>
          <div className="flex flex-wrap gap-2 text-[8px] font-mono">
            <span className="px-2 py-1 bg-primary/10 border border-primary/20 rounded text-primary/60">
              📍 {selectedLocation.category}
            </span>
            <span className="px-2 py-1 bg-primary/10 border border-primary/20 rounded text-primary/60">
              ⭐ {selectedLocation.significance}
            </span>
          </div>
        </motion.div>
      )}

      {/* Visited Locations List */}
      {visitedLocations.size > 0 && (
        <div className="p-3 border border-primary/15 bg-black/30 rounded text-[8px] font-mono max-h-32 overflow-y-auto">
          <p className="text-primary/40 tracking-widest uppercase mb-1.5">Explored ({visitedLocations.size})</p>
          <div className="space-y-0.5">
            {locations
              .filter(l => visitedLocations.has(l.id))
              .map(loc => (
                <div key={loc.id} className="flex items-center gap-2 text-primary/60">
                  <span>✓</span>
                  <span className="truncate">{loc.name}</span>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}