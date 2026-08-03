import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { ArrowLeft, MapPin, Eye } from "lucide-react";
import { Link } from "react-router-dom";
import InteractiveLocationsMap from "@/components/map/InteractiveLocationsMap";

export default function LocationsMap() {
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get("session");
  const [sessions, setSessions] = useState([]);
  const [selectedSession, setSelectedSession] = useState(sessionId || "");

  useEffect(() => {
    base44.entities.ChatSession.list("-updated_date", 100).then(setSessions);
  }, []);

  return (
    <div className="min-h-[100dvh] bg-background scanline">
      {/* Header */}
      <div className="border-b border-primary/20 bg-black/60 backdrop-blur-md px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center gap-4">
          <Link to="/" className="text-primary/40 hover:text-primary transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="font-mono text-primary glow-text tracking-[0.2em] uppercase text-lg flex items-center gap-2">
              <MapPin className="w-5 h-5" />
              // Locations Map
            </h1>
            <p className="text-[10px] font-mono text-primary/30 tracking-widest uppercase mt-0.5">
              Interactive world discovery & lore
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto p-6 pb-24 lg:pb-6 space-y-6">
        {/* Session Filter */}
        <div className="space-y-2">
          <label className="block text-[9px] font-mono text-primary/40 tracking-widest uppercase">
            Filter by Session
          </label>
          <select
            value={selectedSession}
            onChange={(e) => setSelectedSession(e.target.value)}
            className="w-full bg-black/60 border border-primary/20 text-primary/70 font-mono text-sm px-3 py-2.5 focus:outline-none focus:border-primary/50 transition-colors"
          >
            <option value="">All Sessions</option>
            {sessions.map(s => (
              <option key={s.id} value={s.id}>
                {s.title || "Untitled"} ({s.messages?.length || 0} messages)
              </option>
            ))}
          </select>
        </div>

        {/* Interactive Map Component */}
        <InteractiveLocationsMap sessionId={selectedSession || null} />

        {/* Info Panel */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="border border-primary/15 bg-black/40 p-4 space-y-2">
            <div className="flex items-center gap-2 mb-2">
              <Eye className="w-4 h-4 text-primary/60" />
              <h3 className="font-mono text-sm text-primary/70 tracking-wider uppercase">How It Works</h3>
            </div>
            <ul className="space-y-1.5 text-[9px] font-mono text-primary/60 leading-relaxed list-disc list-inside">
              <li>Locations extracted from chat sessions appear as colored markers</li>
              <li>Color intensity reflects importance (critical = red, high = yellow)</li>
              <li>Click any marker to view full lore and session context</li>
              <li>Filter by session to see location discoveries in specific stories</li>
            </ul>
          </div>

          <div className="border border-primary/15 bg-black/40 p-4 space-y-2">
            <div className="flex items-center gap-2 mb-2">
              <MapPin className="w-4 h-4 text-primary/60" />
              <h3 className="font-mono text-sm text-primary/70 tracking-wider uppercase">Legend</h3>
            </div>
            <div className="space-y-1.5 text-[9px] font-mono">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: "#F87171" }} />
                <span className="text-primary/60">Critical - World-shaping location</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: "#FBBF24" }} />
                <span className="text-primary/60">High - Major location</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: "#34D399" }} />
                <span className="text-primary/60">Medium - Notable location</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: "#60A5FA" }} />
                <span className="text-primary/60">Low - Minor location</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}