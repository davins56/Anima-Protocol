import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { ArrowLeft, Heart } from "lucide-react";
import { Link } from "react-router-dom";
import CharacterRelationshipGraph from "@/components/network/CharacterRelationshipGraph";

export default function RelationshipVisualization() {
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
              <Heart className="w-5 h-5" />
              // Relationship Graph
            </h1>
            <p className="text-[10px] font-mono text-primary/30 tracking-widest uppercase mt-0.5">
              Character affinity network & interaction history
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

        {/* Graph Component */}
        <CharacterRelationshipGraph sessionId={selectedSession || null} />

        {/* Information Panel */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="border border-primary/15 bg-black/40 p-4 space-y-2">
            <h3 className="font-mono text-sm text-primary/70 tracking-wider uppercase mb-2">Reading the Graph</h3>
            <ul className="space-y-1.5 text-[9px] font-mono text-primary/60 leading-relaxed list-disc list-inside">
              <li>Each circle represents a character in the session</li>
              <li>Lines show relationships, color-coded by affinity tier</li>
              <li>Line thickness represents relationship strength (score)</li>
              <li>Dashed lines indicate negative relationships</li>
              <li>Click a character to see its detailed relationship network</li>
            </ul>
          </div>

          <div className="border border-primary/15 bg-black/40 p-4 space-y-2">
            <h3 className="font-mono text-sm text-primary/70 tracking-wider uppercase mb-2">Affinity Tiers</h3>
            <div className="space-y-1.5 text-[9px] font-mono">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-red-600" />
                <span className="text-primary/60">Hostile (-100 to -50)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-orange-600" />
                <span className="text-primary/60">Cold (-50 to -25)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-purple-600" />
                <span className="text-primary/60">Neutral (-25 to 25)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-blue-600" />
                <span className="text-primary/60">Warm (25 to 50)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-green-600" />
                <span className="text-primary/60">Close (50 to 75)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-pink-600" />
                <span className="text-primary/60">Devoted (75 to 100)</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}