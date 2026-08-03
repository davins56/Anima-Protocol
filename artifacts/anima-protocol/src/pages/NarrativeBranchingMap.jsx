import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { ChevronLeft, GitBranch, Loader } from "lucide-react";
import { Link } from "react-router-dom";
import { useNarrativeBranching } from "@/hooks/useNarrativeBranching";
import NarrativeBranchMap from "@/components/narrative/NarrativeBranchMap";

export default function NarrativeBranchingMap() {
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get("session");

  const [sessions, setSessions] = useState([]);
  const [selectedSession, setSelectedSession] = useState(sessionId || "");
  const [sessionData, setSessionData] = useState(null);
  const [loadingSession, setLoadingSession] = useState(true);

  const { branches, decisionPoints, loading } = useNarrativeBranching(
    selectedSession,
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
      const data = await base44.entities.ChatSession.list("-updated_date", 50);
      const session = data.find(s => s.id === selectedSession);
      if (session) {
        setSessionData(session);
      }
    } catch (err) {
      console.error("Error loading session:", err);
    } finally {
      setLoadingSession(false);
    }
  };

  const currentSession = sessions.find(s => s.id === selectedSession);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-background flex flex-col">
      {/* Header */}
      <div className="border-b border-primary/20 bg-black/60 backdrop-blur-md px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center gap-4">
          <Link to="/" className="text-primary/40 hover:text-primary transition-colors">
            <ChevronLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="font-mono text-primary glow-text tracking-[0.2em] uppercase text-lg">
              // Narrative Branching Map
            </h1>
            <p className="text-[10px] font-mono text-primary/30 tracking-widest uppercase mt-0.5">
              Visualize key decision points and story divergences
            </p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 max-w-6xl w-full mx-auto px-6 py-6">
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
            {sessions.map(s => (
              <option key={s.id} value={s.id}>
                {s.title || "Untitled"} ({s.messages?.length || 0} messages)
              </option>
            ))}
          </select>
        </div>

        {/* Loading State */}
        {loadingSession || loading ? (
          <div className="flex items-center justify-center h-96">
            <div className="text-center">
              <Loader className="w-8 h-8 text-primary/60 animate-spin mx-auto mb-3" />
              <p className="font-mono text-[10px] text-primary/40 tracking-widest uppercase">
                Loading narrative map...
              </p>
            </div>
          </div>
        ) : sessionData ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Main Map */}
            <div className="lg:col-span-2">
              <NarrativeBranchMap
                branches={branches}
                decisionPoints={decisionPoints}
                loading={loading}
              />
            </div>

            {/* Stats Panel */}
            <div className="space-y-4">
              <div className="border border-primary/20 bg-black/40 p-4 rounded">
                <p className="text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-3">
                  Narrative Stats
                </p>
                <div className="space-y-3">
                  <div>
                    <p className="text-[8px] font-mono text-primary/30 tracking-widest uppercase mb-1">
                      Total Messages
                    </p>
                    <p className="text-xl font-mono text-primary glow-text">
                      {sessionData.messages?.length || 0}
                    </p>
                  </div>
                  <div className="border-t border-primary/10 pt-3">
                    <p className="text-[8px] font-mono text-primary/30 tracking-widest uppercase mb-1">
                      Decision Points
                    </p>
                    <p className="text-xl font-mono text-yellow-400">
                      {decisionPoints.length}
                    </p>
                  </div>
                  <div className="border-t border-primary/10 pt-3">
                    <p className="text-[8px] font-mono text-primary/30 tracking-widest uppercase mb-1">
                      Story Beats
                    </p>
                    <p className="text-xl font-mono text-cyan-400">
                      {Object.keys(branches.structure || {}).length - 1}
                    </p>
                  </div>
                </div>
              </div>

              {/* Legend */}
              <div className="border border-primary/20 bg-black/40 p-4 rounded space-y-3">
                <p className="text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-2">
                  Legend
                </p>
                <div className="space-y-2 text-[9px] font-mono">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-cyan-400/60" />
                    <span className="text-primary/60">Current path</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <GitBranch className="w-3 h-3 text-yellow-400" />
                    <span className="text-primary/60">Decision point</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-primary/20" />
                    <span className="text-primary/60">Alternative path</span>
                  </div>
                </div>
              </div>
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