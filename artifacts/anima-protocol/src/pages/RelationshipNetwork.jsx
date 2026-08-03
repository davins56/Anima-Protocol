import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import RelationshipNetworkDashboard from "@/components/network/RelationshipNetworkDashboard";
import { TrendingUp, TrendingDown, Activity } from "lucide-react";

export default function RelationshipNetwork() {
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get("session");

  const [sessions, setSessions] = useState([]);
  const [selectedSession, setSelectedSession] = useState(sessionId || "");
  const [stats, setStats] = useState(null);
  const [timeline, setTimeline] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    base44.entities.ChatSession.list("-updated_date", 100)
      .then(data => {
        setSessions(data || []);
        if (sessionId) setSelectedSession(sessionId);
      })
      .finally(() => setLoading(false));
  }, [sessionId]);

  useEffect(() => {
    if (selectedSession) {
      loadStats();
      loadTimeline();
    }
  }, [selectedSession]);

  const loadStats = async () => {
    const [rels, storypoints] = await Promise.all([
      base44.entities.CharacterRelationship.filter({ session_id: selectedSession }, "-updated_date", 100),
      base44.entities.Storypoint.filter({ session_id: selectedSession }, "-updated_date", 50),
    ]);

    if (rels && rels.length > 0) {
      const avgScore = rels.reduce((sum, r) => sum + r.score, 0) / rels.length;
      const improved = rels.filter(r => r.last_delta > 0).length;
      const declined = rels.filter(r => r.last_delta < 0).length;

      setStats({
        total_relationships: rels.length,
        average_affinity: Math.round(avgScore),
        improved_count: improved,
        declined_count: declined,
        most_devoted: rels.sort((a, b) => b.score - a.score)[0],
        most_hostile: rels.sort((a, b) => a.score - b.score)[0],
      });
    }

    if (storypoints && storypoints.length > 0) {
      setTimeline(storypoints);
    }
  };

  const loadTimeline = async () => {
    // Data is loaded as part of loadStats
  };

  if (loading) {
    return (
      <div className="flex-1 min-h-0 bg-background flex items-center justify-center">
        <p className="font-mono text-primary/30 text-sm tracking-widest uppercase animate-pulse">
          Loading network...
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-background scanline">
      <div className="flex flex-col flex-1 min-h-0">
        {/* Header */}
        <div className="border-b border-primary/20 bg-black/60 backdrop-blur-md p-6">
          <div className="flex items-center justify-between gap-4 mb-4">
            <div>
              <h1 className="font-mono text-primary glow-text tracking-[0.2em] uppercase text-lg">
                // Relationship Network
              </h1>
              <p className="text-[10px] font-mono text-primary/30 tracking-widest uppercase mt-1">
                Dynamic character affinity & conflict tracking
              </p>
            </div>
          </div>

          {/* Session Select */}
          <select
            value={selectedSession}
            onChange={(e) => setSelectedSession(e.target.value)}
            className="bg-black/60 border border-primary/20 text-primary/70 font-mono text-sm px-4 py-2 focus:outline-none focus:border-primary/50"
          >
            <option value="">— Select session —</option>
            {sessions.map(s => (
              <option key={s.id} value={s.id}>{s.title || "Untitled"}</option>
            ))}
          </select>
        </div>

        {selectedSession ? (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Stats Bar */}
            {stats && (
              <div className="border-b border-primary/20 bg-black/40 p-4 grid grid-cols-5 gap-3">
                <div className="p-3 border border-primary/15 bg-primary/5">
                  <p className="text-[8px] font-mono text-primary/40 tracking-widest uppercase mb-1">Total</p>
                  <p className="text-lg font-mono text-primary">{stats.total_relationships}</p>
                  <p className="text-[8px] font-mono text-primary/40 mt-1">connections</p>
                </div>

                <div className="p-3 border border-primary/15 bg-primary/5">
                  <p className="text-[8px] font-mono text-primary/40 tracking-widest uppercase mb-1">Avg Score</p>
                  <p className={`text-lg font-mono ${stats.average_affinity > 0 ? "text-green-400" : "text-red-400"}`}>
                    {stats.average_affinity > 0 ? "+" : ""}{stats.average_affinity}
                  </p>
                </div>

                <div className="p-3 border border-green-400/20 bg-green-400/5">
                  <div className="flex items-center gap-1 mb-1">
                    <TrendingUp className="w-3 h-3 text-green-400" />
                    <p className="text-[8px] font-mono text-green-400/60 tracking-widest uppercase">Improved</p>
                  </div>
                  <p className="text-lg font-mono text-green-400">{stats.improved_count}</p>
                </div>

                <div className="p-3 border border-red-400/20 bg-red-400/5">
                  <div className="flex items-center gap-1 mb-1">
                    <TrendingDown className="w-3 h-3 text-red-400" />
                    <p className="text-[8px] font-mono text-red-400/60 tracking-widest uppercase">Declined</p>
                  </div>
                  <p className="text-lg font-mono text-red-400">{stats.declined_count}</p>
                </div>

                <div className="p-3 border border-primary/15 bg-primary/5">
                  <p className="text-[8px] font-mono text-primary/40 tracking-widest uppercase mb-1">Storypoints</p>
                  <p className="text-lg font-mono text-primary">{timeline.length}</p>
                </div>
              </div>
            )}

            {/* Dashboard */}
            <div className="flex-1 overflow-hidden">
              <RelationshipNetworkDashboard sessionId={selectedSession} />
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <p className="font-mono text-primary/20 text-sm tracking-[0.3em] uppercase">
              Select a session to view relationship network
            </p>
          </div>
        )}
      </div>
    </div>
  );
}