import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { ChevronLeft, Loader } from "lucide-react";
import RelationshipNetworkGraph from "@/components/network/RelationshipNetworkGraph";
import InteractiveNetworkGraph from "@/components/network/InteractiveNetworkGraph";
import { Link } from "react-router-dom";

export default function RelationshipGraph() {
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get("session");

  const [sessions, setSessions] = useState([]);
  const [selectedSession, setSelectedSession] = useState(sessionId || "");
  const [characters, setCharacters] = useState([]);
  const [relationships, setRelationships] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedChar, setSelectedChar] = useState(null);

  useEffect(() => {
    loadInitialData();
  }, []);

  useEffect(() => {
    if (selectedSession) {
      loadSessionData();
    }
  }, [selectedSession]);

  const loadInitialData = async () => {
    setLoading(true);
    try {
      const [seshs, chars] = await Promise.all([
        base44.entities.ChatSession.list("-updated_date", 50),
        base44.entities.Character.list("-created_date", 100),
      ]);
      setSessions(seshs || []);
      setCharacters(chars || []);
      if (!selectedSession && seshs?.length > 0) {
        setSelectedSession(seshs[0].id);
      }
    } catch (err) {
      console.error("Error loading data:", err);
    } finally {
      setLoading(false);
    }
  };

  const loadSessionData = async () => {
    if (!selectedSession) return;
    try {
      const rels = await base44.entities.CharacterRelationship.filter({
        session_id: selectedSession,
      });
      setRelationships(rels || []);
    } catch (err) {
      console.error("Error loading relationships:", err);
    }
  };

  const currentSession = sessions.find(s => s.id === selectedSession);

  return (
    <div className="flex-1 min-h-0 bg-background overflow-hidden flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-primary/20 bg-black/60 backdrop-blur-md">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Link to="/" className="text-primary/40 hover:text-primary transition-colors">
              <ChevronLeft className="w-4 h-4 sm:w-5 sm:h-5" />
            </Link>
            <h1 className="font-mono text-primary glow-text tracking-[0.2em] uppercase text-lg sm:text-2xl">
              // Relationship Network
            </h1>
          </div>
          <p className="text-[10px] sm:text-xs font-mono text-primary/40 tracking-widest">
            Character connections and emotional ties
          </p>
        </div>
      </div>

      {/* Session Selector */}
      <div className="px-4 sm:px-6 py-3 border-b border-primary/10 bg-black/40">
        <label className="block text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-2">
          Session
        </label>
        <select
          value={selectedSession}
          onChange={(e) => setSelectedSession(e.target.value)}
          className="w-full max-w-xs bg-black/60 border border-primary/20 text-primary/70 font-mono text-xs px-3 py-2 focus:outline-none focus:border-primary/50 transition-colors"
        >
          {sessions.map(s => (
            <option key={s.id} value={s.id}>
              {s.title || "Untitled"} ({s.messages?.length || 0} messages)
            </option>
          ))}
        </select>
      </div>

      {/* Graph Container */}
      <div className="flex-1 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <Loader className="w-6 h-6 text-primary/60 animate-spin mx-auto mb-3" />
              <p className="font-mono text-[10px] text-primary/40 tracking-widest uppercase">
                Loading network...
              </p>
            </div>
          </div>
        ) : (
          <InteractiveNetworkGraph
            nodes={characters.map(c => ({
              id: c.id,
              label: c.name,
              nodeSize: 30
            }))}
            edges={relationships.map(r => ({
              from: r.character_id,
              to: selectedSession,
              weight: (r.score || 0) / 100,
              id: r.id,
              score: r.score
            }))}
            selectedCharId={selectedChar}
            onSelectChar={setSelectedChar}
            sessionId={selectedSession}
            onRelationshipChange={loadSessionData}
          />
        )}
      </div>

      {/* Legend */}
      <div className="px-4 sm:px-6 py-3 border-t border-primary/10 bg-black/60 backdrop-blur-md">
        <p className="text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-2">Legend</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="flex items-center gap-2">
            <div className="w-2 h-0.5 bg-green-400/70" />
            <span className="text-[9px] font-mono text-primary/50">Positive Bond</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-0.5 bg-red-400/70" />
            <span className="text-[9px] font-mono text-primary/50">Negative Bond</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-primary/80" />
            <span className="text-[9px] font-mono text-primary/50">Character</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-full border border-primary/40 bg-primary/5" />
            <span className="text-[9px] font-mono text-primary/50">Hovered</span>
          </div>
        </div>
      </div>
    </div>
  );
}