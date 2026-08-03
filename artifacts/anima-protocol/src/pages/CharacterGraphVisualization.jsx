import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import CharacterRelationshipGraph from "@/components/network/CharacterRelationshipGraph";
import { ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";

export default function CharacterGraphVisualization() {
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get("session");

  const [sessions, setSessions] = useState([]);
  const [selectedSession, setSelectedSession] = useState(sessionId || "");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    base44.entities.ChatSession.list("-updated_date", 100)
      .then(data => {
        setSessions(data || []);
        if (sessionId) setSelectedSession(sessionId);
      })
      .finally(() => setLoading(false));
  }, [sessionId]);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-background scanline flex flex-col">
      {/* Header */}
      <div className="border-b border-primary/20 bg-black/60 backdrop-blur-md p-6">
        <div className="flex items-center justify-between gap-4 mb-4">
          <div className="flex items-center gap-3">
            <Link to="/" className="text-primary/40 hover:text-primary transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="font-mono text-primary glow-text tracking-[0.2em] uppercase text-lg">
                // Character Relationship Graph
              </h1>
              <p className="text-[10px] font-mono text-primary/30 tracking-widest uppercase mt-1">
                Force-directed visualization with affinity & influence metrics
              </p>
            </div>
          </div>
        </div>

        {/* Session Select */}
        <select
          value={selectedSession}
          onChange={(e) => setSelectedSession(e.target.value)}
          className="bg-black/60 border border-primary/20 text-primary/70 font-mono text-sm px-4 py-2 focus:outline-none focus:border-primary/50 transition-colors"
        >
          <option value="">— Select session —</option>
          {sessions.map(s => (
            <option key={s.id} value={s.id}>{s.title || "Untitled"}</option>
          ))}
        </select>
      </div>

      {/* Graph */}
      <div className="flex-1 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <p className="font-mono text-primary/30 text-sm tracking-widest uppercase animate-pulse">
              Loading...
            </p>
          </div>
        ) : selectedSession ? (
          <CharacterRelationshipGraph sessionId={selectedSession} />
        ) : (
          <div className="flex items-center justify-center h-full">
            <p className="font-mono text-primary/20 text-sm tracking-[0.3em] uppercase">
              Select a session to view character relationships
            </p>
          </div>
        )}
      </div>
    </div>
  );
}