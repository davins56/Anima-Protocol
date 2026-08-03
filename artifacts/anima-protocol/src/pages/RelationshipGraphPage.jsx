import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { ChevronLeft, Users, Loader } from "lucide-react";
import { Link } from "react-router-dom";
import { useRelationshipGraph } from "@/hooks/useRelationshipGraph";
import RelationshipGraphVisualization from "@/components/network/RelationshipGraphVisualization";

export default function RelationshipGraphPage() {
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get("session");

  const [sessions, setSessions] = useState([]);
  const [selectedSession, setSelectedSession] = useState(sessionId || "");
  const [sessionData, setSessionData] = useState(null);
  const [characters, setCharacters] = useState([]);
  const [loadingSession, setLoadingSession] = useState(true);
  const [selectedCharacter, setSelectedCharacter] = useState(null);

  const { nodes, edges, loading } = useRelationshipGraph(
    selectedSession,
    characters,
    sessionData?.messages
  );

  useEffect(() => {
    loadSessions();
  }, []);

  useEffect(() => {
    if (selectedSession) {
      loadSessionData();
    }
  }, [selectedSession]);

  const loadSessions = async () => {
    try {
      const data = await base44.entities.ChatSession.list("-updated_date", 50);
      setSessions(data || []);
      if (!selectedSession && data?.length > 0) {
        setSelectedSession(data[0].id);
      }
    } catch (err) {
      console.error("Error loading sessions:", err);
    }
  };

  const loadSessionData = async () => {
    setLoadingSession(true);
    try {
      const [sessionList, charList] = await Promise.all([
        base44.entities.ChatSession.list("-updated_date", 50),
        base44.entities.Character.list("-created_date", 100),
      ]);

      const session = sessionList.find((s) => s.id === selectedSession);
      if (session) {
        setSessionData(session);

        // Get characters involved in this session
        const sessionCharIds = [
          session.character_id,
          ...(session.group_character_ids || []),
        ].filter(Boolean);

        const sessionCharacters = charList.filter((c) =>
          sessionCharIds.includes(c.id)
        );

        // Add player as pseudo-character
        if (sessionCharacters.length === 0 || !sessionCharIds.length) {
          setCharacters(charList.slice(0, 10)); // Fallback: show first 10
        } else {
          setCharacters(sessionCharacters);
        }
      }
    } catch (err) {
      console.error("Error loading session:", err);
    } finally {
      setLoadingSession(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="border-b border-primary/20 bg-black/60 backdrop-blur-md px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center gap-4">
          <Link to="/" className="text-primary/40 hover:text-primary transition-colors">
            <ChevronLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="font-mono text-primary glow-text tracking-[0.2em] uppercase text-lg">
              // Character Relationship Graph
            </h1>
            <p className="text-[10px] font-mono text-primary/30 tracking-widest uppercase mt-0.5">
              Interactive sentiment and connection visualization
            </p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 max-w-7xl w-full mx-auto px-6 py-6">
        {/* Session Selector */}
        <div className="mb-6">
          <label className="block text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-2">
            Select Session
          </label>
          <select
            value={selectedSession}
            onChange={(e) => setSelectedSession(e.target.value)}
            className="w-full max-w-xs bg-black/60 border border-primary/20 text-primary/70 font-mono text-xs px-3 py-2.5 focus:outline-none focus:border-primary/50 transition-colors"
          >
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title || "Untitled"} ({s.messages?.length || 0} messages)
              </option>
            ))}
          </select>
        </div>

        {/* Loading State */}
        {loadingSession ? (
          <div className="flex items-center justify-center h-96">
            <div className="text-center">
              <Loader className="w-8 h-8 text-primary/60 animate-spin mx-auto mb-3" />
              <p className="font-mono text-[10px] text-primary/40 tracking-widest uppercase">
                Loading relationships...
              </p>
            </div>
          </div>
        ) : sessionData ? (
          <div className="space-y-6">
            {/* Stats Header */}
            <div className="grid grid-cols-3 gap-4">
              <div className="border border-primary/20 bg-black/40 p-4 rounded">
                <p className="text-[8px] font-mono text-primary/30 tracking-widest uppercase mb-1">
                  Characters
                </p>
                <p className="text-2xl font-mono text-primary glow-text">
                  {characters.length}
                </p>
              </div>
              <div className="border border-primary/20 bg-black/40 p-4 rounded">
                <p className="text-[8px] font-mono text-primary/30 tracking-widest uppercase mb-1">
                  Connections
                </p>
                <p className="text-2xl font-mono text-cyan-400">
                  {edges.length}
                </p>
              </div>
              <div className="border border-primary/20 bg-black/40 p-4 rounded">
                <p className="text-[8px] font-mono text-primary/30 tracking-widest uppercase mb-1">
                  Messages
                </p>
                <p className="text-2xl font-mono text-primary/70">
                  {sessionData.messages?.length || 0}
                </p>
              </div>
            </div>

            {/* Graph Visualization */}
            <RelationshipGraphVisualization
              nodes={nodes}
              edges={edges}
              loading={loading}
              onNodeClick={(node) => setSelectedCharacter(node)}
            />

            {/* Legend Info */}
            <div className="border border-primary/20 bg-black/40 p-4 rounded">
              <div className="flex items-center gap-2 mb-3">
                <Users className="w-4 h-4 text-primary/60" />
                <h3 className="font-mono text-xs tracking-widest uppercase text-primary/70">
                  How to Read the Graph
                </h3>
              </div>
              <ul className="space-y-1.5 text-[9px] font-mono text-primary/60">
                <li>
                  <span className="text-green-400">● Green lines</span> =
                  Positive relationships (trust, affection)
                </li>
                <li>
                  <span className="text-red-400">● Red lines</span> = Negative
                  relationships (distrust, conflict)
                </li>
                <li>
                  <span className="text-primary/60">Thicker lines</span> =
                  Stronger emotional connections
                </li>
                <li>
                  Click a node to see detailed relationship data for that
                  character
                </li>
              </ul>
            </div>
          </div>
        ) : (
          <div className="text-center py-12">
            <p className="font-mono text-primary/20 text-sm tracking-[0.3em] uppercase">
              No session selected
            </p>
          </div>
        )}
      </div>
    </div>
  );
}