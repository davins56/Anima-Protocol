import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { ArrowLeft, Check, X, Archive, Loader, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";

const typeColors = {
  location: "border-blue-400/40 bg-blue-400/10 text-blue-400",
  event: "border-purple-400/40 bg-purple-400/10 text-purple-400",
  faction: "border-green-400/40 bg-green-400/10 text-green-400",
  artifact: "border-yellow-400/40 bg-yellow-400/10 text-yellow-400",
  character_detail: "border-cyan-400/40 bg-cyan-400/10 text-cyan-400",
  history: "border-orange-400/40 bg-orange-400/10 text-orange-400"
};

const typeLabels = {
  location: "📍 Location",
  event: "⚔️ Event",
  faction: "🏛️ Faction",
  artifact: "✨ Artifact",
  character_detail: "👤 Character",
  history: "📜 History"
};

export default function DiscoveryQueue() {
  const [discoveries, setDiscoveries] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("pending");
  const [scanning, setScanning] = useState(false);
  const [archiving, setArchiving] = useState(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    const query = filter === "all" ? {} : { status: filter };
    const [discoveries, sessions] = await Promise.all([
      base44.entities.PendingDiscovery.filter(query, "-created_date", 100),
      base44.entities.ChatSession.list("-created_date", 100)
    ]);
    setDiscoveries(discoveries || []);
    setSessions(sessions || []);
    setLoading(false);
  };

  const handleScanSession = async (sessionId) => {
    setScanning(true);
    const session = sessions.find(s => s.id === sessionId);
    if (!session?.messages) {
      setScanning(false);
      return;
    }

    await base44.functions.invoke('detectWorldBuildingDetails', {
      session_id: sessionId,
      messages: session.messages || [],
      start_index: 0
    }).catch(() => {});

    await loadData();
    setScanning(false);
  };

  const handleApprove = async (discovery) => {
    setArchiving(discovery.id);
    
    // Create lore entry
    const loreEntry = await base44.entities.WorldState.create({
      session_id: discovery.session_id,
      category: discovery.discovery_type,
      subject: discovery.subject,
      fact: discovery.description,
      importance: 'medium',
      is_active: true
    });

    // Mark discovery as approved
    await base44.entities.PendingDiscovery.update(discovery.id, {
      status: 'archived',
      related_lore_id: loreEntry.id,
      approved_at: new Date().toISOString()
    });

    await loadData();
    setArchiving(null);
  };

  const handleReject = async (id) => {
    setArchiving(id);
    await base44.entities.PendingDiscovery.update(id, { status: 'rejected' });
    await loadData();
    setArchiving(null);
  };

  const pendingCount = discoveries.filter(d => d.status === 'pending').length;
  const filteredDiscoveries = discoveries.filter(d => 
    filter === 'all' ? true : d.status === filter
  );

  return (
    <div className="min-h-[100dvh] bg-background scanline">
      {/* Header */}
      <div className="border-b border-primary/20 bg-black/60 backdrop-blur-md px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Link to="/" className="text-primary/40 hover:text-primary transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="font-mono text-primary glow-text tracking-[0.2em] uppercase text-lg flex items-center gap-2">
                <Sparkles className="w-5 h-5" />
                // Pending Discoveries
              </h1>
              <p className="text-[10px] font-mono text-primary/30 tracking-widest uppercase mt-0.5">
                {pendingCount} awaiting review
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setFilter(filter === 'pending' ? 'all' : 'pending')}
              className={`px-4 py-2 border font-mono text-xs tracking-widest uppercase transition-all ${
                filter === 'pending' 
                  ? "bg-primary/10 border-primary/40 text-primary" 
                  : "border-primary/15 text-primary/30 hover:border-primary/40"
              }`}
            >
              Pending
            </button>
            <button
              onClick={() => setFilter(filter === 'all' ? 'pending' : 'all')}
              className={`px-4 py-2 border font-mono text-xs tracking-widest uppercase transition-all ${
                filter === 'all' 
                  ? "bg-primary/10 border-primary/40 text-primary" 
                  : "border-primary/15 text-primary/30 hover:border-primary/40"
              }`}
            >
              All
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto p-6 pb-24 lg:pb-6 space-y-8">
        {/* Scan Controls */}
        <div className="space-y-3">
          <p className="text-[10px] font-mono text-primary/40 tracking-[0.3em] uppercase">Quick Scan</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {sessions.slice(0, 8).map(session => (
              <button
                key={session.id}
                onClick={() => handleScanSession(session.id)}
                disabled={scanning}
                className="p-3 border border-primary/20 bg-black/40 text-primary/70 hover:border-primary/40 hover:text-primary font-mono text-[9px] text-left transition-all disabled:opacity-50 truncate hud-corner"
              >
                {scanning ? (
                  <Loader className="w-3 h-3 animate-spin inline mr-1" />
                ) : (
                  <Sparkles className="w-3 h-3 inline mr-1" />
                )}
                {session.title || "Untitled"}
              </button>
            ))}
          </div>
        </div>

        {/* Discoveries Grid */}
        {loading ? (
          <div className="text-center py-12 font-mono text-primary/30 text-sm animate-pulse">
            Loading discoveries...
          </div>
        ) : filteredDiscoveries.length === 0 ? (
          <div className="text-center py-20">
            <Sparkles className="w-8 h-8 text-primary/10 mx-auto mb-3" />
            <p className="font-mono text-primary/20 text-sm tracking-[0.3em] uppercase">
              {filter === 'pending' ? 'No pending discoveries' : 'No discoveries'}
            </p>
            <p className="font-mono text-primary/15 text-xs mt-2">
              Click a session above to scan for world-building details
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {filteredDiscoveries.map(discovery => {
              const session = sessions.find(s => s.id === discovery.session_id);
              return (
                <div
                  key={discovery.id}
                  className={`border p-4 space-y-3 hud-corner transition-all ${typeColors[discovery.discovery_type]}`}
                >
                  {/* Header */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 gap-2">
                        <span className="font-mono text-[10px] tracking-[0.2em] uppercase">
                          {typeLabels[discovery.discovery_type]}
                        </span>
                        <div className="flex-1 h-0.5 bg-current/10" />
                        <span className="text-[9px] font-mono opacity-60">
                          {Math.round(discovery.confidence * 100)}%
                        </span>
                      </div>
                      <h3 className="font-mono text-sm text-current font-bold mt-1 truncate">
                        {discovery.subject}
                      </h3>
                    </div>
                  </div>

                  {/* Description */}
                  <p className="font-mono text-[10px] text-current/70 leading-relaxed">
                    {discovery.description}
                  </p>

                  {/* Context */}
                  <div className="p-2 bg-black/40 border border-current/20">
                    <p className="text-[9px] font-mono text-current/50 italic truncate">
                      "{discovery.context}"
                    </p>
                  </div>

                  {/* Session & Status */}
                  <div className="flex items-center justify-between text-[9px] font-mono text-current/50">
                    <span>{session?.title || "Unknown"}</span>
                    <span className="uppercase tracking-widest">{discovery.status}</span>
                  </div>

                  {/* Actions */}
                  {discovery.status === 'pending' && (
                    <div className="flex gap-2 pt-2">
                      <button
                        onClick={() => handleReject(discovery.id)}
                        disabled={archiving === discovery.id}
                        className="flex-1 flex items-center justify-center gap-1 px-3 py-1.5 border border-red-900/40 text-red-900 hover:text-red-400 hover:border-red-400/40 disabled:opacity-30 font-mono text-[9px] tracking-widest uppercase transition-all"
                      >
                        {archiving === discovery.id ? (
                          <Loader className="w-3 h-3 animate-spin" />
                        ) : (
                          <X className="w-3 h-3" />
                        )}
                        Reject
                      </button>
                      <button
                        onClick={() => handleApprove(discovery)}
                        disabled={archiving === discovery.id}
                        className="flex-1 flex items-center justify-center gap-1 px-3 py-1.5 bg-current/10 border border-current/40 text-current hover:bg-current/20 disabled:opacity-30 font-mono text-[9px] tracking-widest uppercase transition-all"
                      >
                        {archiving === discovery.id ? (
                          <Loader className="w-3 h-3 animate-spin" />
                        ) : (
                          <>
                            <Check className="w-3 h-3" />
                            <span className="hidden sm:inline">Approve</span>
                          </>
                        )}
                      </button>
                    </div>
                  )}

                  {discovery.status === 'archived' && (
                    <div className="flex items-center gap-1 text-[9px] font-mono text-green-400 pt-2">
                      <Archive className="w-3 h-3" />
                      Added to Lore
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}