import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { X, MapPin, BookOpen, Calendar } from "lucide-react";

export default function InteractiveLocationsMap({ sessionId }) {
  const [locations, setLocations] = useState([]);
  const [loreEntries, setLoreEntries] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [selectedLocation, setSelectedLocation] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, [sessionId]);

  const loadData = async () => {
    setLoading(true);
    const query = sessionId ? { session_id: sessionId } : {};
    
    const [locationLore, allSessions] = await Promise.all([
      base44.entities.WorldState.filter({ ...query, category: "location", is_active: true }, "-created_date", 100),
      base44.entities.ChatSession.list("-created_date", 100)
    ]);

    setLoreEntries(locationLore || []);
    setSessions(allSessions || []);
    
    // Convert location lore to map points
    const locPoints = (locationLore || []).map((loc, idx) => ({
      id: loc.id,
      name: loc.subject,
      description: loc.fact,
      importance: loc.importance,
      sessionId: loc.session_id,
      x: 20 + ((idx % 5) * 18),
      y: 20 + (Math.floor(idx / 5) * 25),
      color: importanceColor(loc.importance)
    }));
    
    setLocations(locPoints);
    setLoading(false);
  };

  const importanceColor = (importance) => {
    const colors = {
      low: "#60A5FA",
      medium: "#34D399",
      high: "#FBBF24",
      critical: "#F87171"
    };
    return colors[importance] || "#60A5FA";
  };

  const getLocationLore = (locId) => {
    return loreEntries.find(e => e.id === locId);
  };

  const getSessionTitle = (sid) => {
    return sessions.find(s => s.id === sid)?.title || "Unknown Session";
  };

  const selectedLore = selectedLocation ? getLocationLore(selectedLocation) : null;

  return (
    <div className="space-y-4">
      {/* SVG Map */}
      <div className="border border-primary/20 bg-black/40 p-4 rounded overflow-hidden">
        <svg 
          viewBox="0 0 100 100" 
          className="w-full aspect-square bg-black/60 border border-primary/10"
          style={{ minHeight: "400px" }}
        >
          {/* Grid background */}
          <defs>
            <pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse">
              <path d="M 10 0 L 0 0 0 10" fill="none" stroke="#60a5fa" strokeWidth="0.05" opacity="0.1" />
            </pattern>
          </defs>
          <rect width="100" height="100" fill="url(#grid)" />

          {/* Location markers */}
          {locations.map(loc => (
            <g key={loc.id}>
              {/* Circle with pulse effect */}
              <circle
                cx={loc.x}
                cy={loc.y}
                r="2"
                fill={loc.color}
                opacity="0.3"
                style={{ animation: "pulse 2s infinite" }}
              />
              
              {/* Main marker */}
              <circle
                cx={loc.x}
                cy={loc.y}
                r="1.2"
                fill={loc.color}
                stroke="#ffffff"
                strokeWidth="0.15"
                style={{ cursor: "pointer", transition: "all 0.2s" }}
                onMouseEnter={(e) => {
                  e.target.setAttribute("r", "1.8");
                  e.target.setAttribute("stroke-width", "0.25");
                }}
                onMouseLeave={(e) => {
                  e.target.setAttribute("r", "1.2");
                  e.target.setAttribute("stroke-width", "0.15");
                }}
                onClick={() => setSelectedLocation(loc.id)}
              />

              {/* Label on hover/select */}
              {selectedLocation === loc.id && (
                <text
                  x={loc.x}
                  y={loc.y - 2.5}
                  textAnchor="middle"
                  fontSize="0.6"
                  fill={loc.color}
                  style={{ pointerEvents: "none", fontWeight: "bold" }}
                >
                  {loc.name.slice(0, 12)}
                </text>
              )}
            </g>
          ))}
        </svg>

        {/* Legend */}
        <div className="flex items-center justify-center gap-4 mt-3 text-[8px] font-mono flex-wrap">
          {["low", "medium", "high", "critical"].map(imp => (
            <div key={imp} className="flex items-center gap-1">
              <div 
                className="w-2 h-2 rounded-full" 
                style={{ backgroundColor: importanceColor(imp) }}
              />
              <span className="text-primary/50 uppercase">{imp}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Detail Panel */}
      {selectedLore && (
        <div className="border border-primary/30 bg-primary/5 p-4 space-y-3 relative">
          <button
            onClick={() => setSelectedLocation(null)}
            className="absolute top-2 right-2 text-primary/40 hover:text-primary transition-colors"
          >
            <X className="w-4 h-4" />
          </button>

          <div className="flex items-start gap-2">
            <MapPin className="w-4 h-4 text-primary/60 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <h3 className="font-mono text-sm text-primary tracking-wider uppercase">
                {selectedLore.subject}
              </h3>
              <p className="text-[9px] font-mono text-primary/50 mt-0.5">
                {getSessionTitle(selectedLore.session_id)}
              </p>
            </div>
          </div>

          <div className="text-[10px] font-mono text-primary/70 leading-relaxed border-l-2 border-primary/20 pl-2 py-1">
            {selectedLore.fact}
          </div>

          {/* Metadata */}
          <div className="grid grid-cols-2 gap-2 text-[9px] font-mono">
            <div className="p-2 bg-black/40 border border-primary/10">
              <p className="text-primary/40 tracking-widest uppercase mb-0.5">Importance</p>
              <p className="text-primary/70 capitalize">{selectedLore.importance}</p>
            </div>
            <div className="p-2 bg-black/40 border border-primary/10">
              <p className="text-primary/40 tracking-widest uppercase mb-0.5">Status</p>
              <p className="text-primary/70">{selectedLore.is_active ? "Active" : "Archived"}</p>
            </div>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loading && locations.length === 0 && (
        <div className="text-center py-12">
          <MapPin className="w-8 h-8 text-primary/10 mx-auto mb-3" />
          <p className="font-mono text-primary/20 text-sm tracking-[0.3em] uppercase">
            No locations discovered yet
          </p>
          <p className="font-mono text-primary/15 text-xs mt-2">
            Locations will appear as you explore the world
          </p>
        </div>
      )}

      {loading && (
        <div className="text-center py-12 font-mono text-primary/30 text-sm animate-pulse">
          Loading map...
        </div>
      )}

      {/* Location Count */}
      {!loading && locations.length > 0 && (
        <div className="text-center text-[9px] font-mono text-primary/30 tracking-widest uppercase">
          {locations.length} location{locations.length !== 1 ? "s" : ""} discovered
        </div>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.3; r: 2; }
          50% { opacity: 0.6; r: 3; }
        }
      `}</style>
    </div>
  );
}