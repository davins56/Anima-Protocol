import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { ArrowLeft, Loader, X, BookOpen, Heart, Swords, Handshake, HelpCircle, Clock, ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import RelationshipGraph from "@/components/network/RelationshipGraph";

export default function Network() {
  const [characters, setCharacters] = useState([]);
  const [relationships, setRelationships] = useState([]);
  const [loreEntries, setLoreEntries] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedChar, setSelectedChar] = useState(null);
  const [connectedChar, setConnectedChar] = useState(null);
  const [panelTab, setPanelTab] = useState("lore"); // lore | history

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    const [chars, animas, rels, lore, sess] = await Promise.all([
      base44.entities.Character.list("-created_date", 100),
      base44.entities.Anima.list("-created_date", 100),
      base44.entities.CharacterRelationship.list("-updated_date", 500),
      base44.entities.WorldState.filter({ is_active: true }, "-created_date", 300),
      base44.entities.ChatSession.list("-updated_date", 50),
    ]);

    const animaAsChars = (animas || []).map((a) => ({
      ...a,
      _isAnima: true,
      category: a.archetype || "guardian",
      universe: "Anima",
    }));
    setCharacters([...animaAsChars, ...(chars || [])]);
    setRelationships(rels || []);
    setLoreEntries(lore || []);
    setSessions(sess || []);
    setLoading(false);
  };

  // Build graph data
  const buildGraph = () => {
    const nodes = characters.map((char) => {
      // Aggregate relationship score across all sessions
      const charRels = relationships.filter((r) => r.character_id === char.id);
      const avgScore = charRels.length
        ? Math.round(charRels.reduce((s, r) => s + (r.score || 0), 0) / charRels.length)
        : 0;
      const maxTier = charRels.reduce((best, r) => {
        const tiers = ["hostile", "cold", "neutral", "warm", "close", "devoted"];
        const idx = tiers.indexOf(r.tier || "neutral");
        const bestIdx = tiers.indexOf(best);
        return idx > bestIdx ? r.tier : best;
      }, "neutral");

      return {
        id: char.id,
        label: char.name,
        avatar: char.avatar_url || "",
        category: char.category || "other",
        isAnima: !!char._isAnima,
        score: avgScore,
        tier: maxTier,
        sessionCount: charRels.length,
        nodeSize: Math.min(28 + Math.abs(avgScore) * 0.4 + charRels.length * 3, 56),
      };
    });

    // Build edges from shared sessions + lore co-mentions
    const edgeMap = new Map();

    // Edges from characters sharing sessions
    sessions.forEach((sess) => {
      const charIds = sess.mode === "group"
        ? (sess.group_character_ids || [])
        : sess.character_id ? [sess.character_id] : [];

      for (let i = 0; i < charIds.length; i++) {
        for (let j = i + 1; j < charIds.length; j++) {
          const key = [charIds[i], charIds[j]].sort().join("|");
          if (!edgeMap.has(key)) edgeMap.set(key, { weight: 0, sessions: [], loreLinks: [] });
          const e = edgeMap.get(key);
          e.weight += 1;
          e.sessions.push(sess.id);
        }
      }
    });

    // Edges from lore co-mentions
    loreEntries.forEach((entry) => {
      characters.forEach((a) => {
        characters.forEach((b) => {
          if (a.id >= b.id) return;
          const text = (entry.fact + " " + entry.subject).toLowerCase();
          if (text.includes(a.name.toLowerCase()) && text.includes(b.name.toLowerCase())) {
            const key = [a.id, b.id].sort().join("|");
            if (!edgeMap.has(key)) edgeMap.set(key, { weight: 0, sessions: [], loreLinks: [] });
            const e = edgeMap.get(key);
            e.weight += 0.5;
            e.loreLinks.push(entry.id);
          }
        });
      });
    });

    const edges = Array.from(edgeMap.entries())
      .filter(([, e]) => e.weight > 0)
      .map(([key, e]) => {
        const [from, to] = key.split("|");
        return { id: key, from, to, weight: e.weight, sessions: e.sessions, loreLinks: e.loreLinks };
      });

    return { nodes, edges };
  };

  const { nodes, edges } = buildGraph();

  // When a character node is clicked, show their lore panel
  const handleSelectChar = (charId) => {
    if (selectedChar?.id === charId) {
      setSelectedChar(null);
      setConnectedChar(null);
      return;
    }
    const char = characters.find((c) => c.id === charId);
    setSelectedChar(char || null);
    setConnectedChar(null);
    setPanelTab("lore");
  };

  // When an edge is clicked, show shared lore between two characters
  const handleSelectEdge = (fromId, toId) => {
    const a = characters.find((c) => c.id === fromId);
    const b = characters.find((c) => c.id === toId);
    setSelectedChar(a || null);
    setConnectedChar(b || null);
    setPanelTab("lore");
  };

  // Lore entries relevant to selected character(s)
  const relevantLore = loreEntries.filter((entry) => {
    if (!selectedChar) return false;
    const text = (entry.fact + " " + entry.subject).toLowerCase();
    const nameA = selectedChar.name.toLowerCase();
    if (!text.includes(nameA)) return false;
    if (connectedChar) {
      const nameB = connectedChar.name.toLowerCase();
      return text.includes(nameB);
    }
    return true;
  });

  // Relationship history for selected character
  const charRelHistory = selectedChar
    ? relationships.filter((r) => r.character_id === selectedChar.id)
    : [];

  const tierColors = {
    hostile: "text-red-400 border-red-400/30 bg-red-400/10",
    cold: "text-blue-300 border-blue-300/30 bg-blue-300/10",
    neutral: "text-primary/60 border-primary/20 bg-primary/5",
    warm: "text-yellow-300 border-yellow-300/30 bg-yellow-300/10",
    close: "text-green-300 border-green-300/30 bg-green-300/10",
    devoted: "text-pink-400 border-pink-400/30 bg-pink-400/10",
  };

  const tierIcon = {
    hostile: <Swords className="w-3 h-3" />,
    cold: <HelpCircle className="w-3 h-3" />,
    neutral: <Handshake className="w-3 h-3" />,
    warm: <Heart className="w-3 h-3" />,
    close: <Heart className="w-3 h-3" />,
    devoted: <Heart className="w-3 h-3" />,
  };

  const categoryColors = {
    character_fact: "text-cyan-400",
    item: "text-yellow-400",
    location: "text-green-400",
    event: "text-purple-400",
    relationship: "text-pink-400",
    secret: "text-red-400",
    rule: "text-primary/60",
  };

  return (
    <div className="flex-1 min-h-0 bg-background scanline flex flex-col overflow-hidden">
      {/* Header */}
      <div className="border-b border-primary/20 bg-black/60 backdrop-blur-md px-6 py-3 flex-shrink-0">
        <div className="flex items-center gap-4">
          <Link to="/" className="text-primary/40 hover:text-primary transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="font-mono text-primary glow-text tracking-[0.2em] uppercase text-base">
              // Relationship Matrix
            </h1>
            <p className="text-[9px] font-mono text-primary/30 tracking-widest uppercase mt-0.5">
              {nodes.length} entities · {edges.length} connections · {loreEntries.length} lore entries
            </p>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <Loader className="w-8 h-8 text-primary/40 animate-spin mx-auto mb-4" />
            <p className="font-mono text-primary/30 text-sm tracking-widest uppercase animate-pulse">
              Mapping network...
            </p>
          </div>
        </div>
      ) : nodes.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <p className="font-mono text-primary/20 text-sm tracking-[0.3em] uppercase mb-2">No characters to visualize</p>
            <Link to="/characters" className="font-mono text-xs text-primary/40 hover:text-primary underline tracking-widest uppercase">
              + Add Characters
            </Link>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex overflow-hidden">
          {/* Graph */}
          <div className="flex-1 relative overflow-hidden">
            <RelationshipGraph
              nodes={nodes}
              edges={edges}
              selectedCharId={selectedChar?.id}
              onSelectChar={handleSelectChar}
              onSelectEdge={handleSelectEdge}
            />

            {/* Legend */}
            <div className="absolute bottom-4 left-4 z-10 bg-black/80 border border-primary/20 p-3 backdrop-blur-sm">
              <p className="text-[8px] font-mono text-primary/40 tracking-widest uppercase mb-2">Tier Colors</p>
              <div className="space-y-1">
                {["devoted", "close", "warm", "neutral", "cold", "hostile"].map((tier) => (
                  <div key={tier} className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${
                      tier === "devoted" ? "bg-pink-400" :
                      tier === "close" ? "bg-green-400" :
                      tier === "warm" ? "bg-yellow-400" :
                      tier === "neutral" ? "bg-cyan-400/60" :
                      tier === "cold" ? "bg-blue-300" : "bg-red-400"
                    }`} />
                    <span className="text-[8px] font-mono text-primary/50 capitalize">{tier}</span>
                  </div>
                ))}
              </div>
              <p className="text-[8px] font-mono text-primary/30 mt-2">Click node or edge</p>
            </div>

            {/* Hint when nothing selected */}
            {!selectedChar && (
              <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 bg-black/70 border border-primary/20 px-4 py-2 backdrop-blur-sm pointer-events-none">
                <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase">
                  Click a node or connection to explore lore
                </p>
              </div>
            )}
          </div>

          {/* Side Panel */}
          {selectedChar && (
            <div className="w-80 border-l border-primary/20 bg-black/80 backdrop-blur-md flex flex-col flex-shrink-0 overflow-hidden">
              {/* Panel Header */}
              <div className="p-4 border-b border-primary/15 flex items-start gap-3">
                <div className="w-10 h-10 border border-primary/30 overflow-hidden flex-shrink-0">
                  {selectedChar.avatar_url ? (
                    <img src={selectedChar.avatar_url} alt={selectedChar.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full bg-primary/10 flex items-center justify-center font-mono text-primary text-sm">
                      {selectedChar.name[0]}
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-mono text-xs text-primary tracking-wider uppercase truncate">{selectedChar.name}</p>
                  {connectedChar && (
                    <div className="flex items-center gap-1 mt-0.5">
                      <ChevronRight className="w-3 h-3 text-primary/30" />
                      <p className="font-mono text-[9px] text-primary/50 tracking-wider uppercase truncate">{connectedChar.name}</p>
                    </div>
                  )}
                  {charRelHistory.length > 0 && !connectedChar && (
                    <div className="flex items-center gap-1.5 mt-1">
                      {tierIcon[charRelHistory[0]?.tier || "neutral"]}
                      <span className={`text-[8px] font-mono tracking-widest uppercase px-1.5 py-0.5 border ${tierColors[charRelHistory[0]?.tier || "neutral"]}`}>
                        {charRelHistory[0]?.tier || "neutral"}
                      </span>
                      <span className="text-[8px] font-mono text-primary/30">
                        {charRelHistory[0]?.score > 0 ? "+" : ""}{charRelHistory[0]?.score ?? 0}
                      </span>
                    </div>
                  )}
                </div>
                <button
                  onClick={() => { setSelectedChar(null); setConnectedChar(null); }}
                  className="text-primary/30 hover:text-primary transition-colors flex-shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Tabs */}
              <div className="flex border-b border-primary/15">
                <button
                  onClick={() => setPanelTab("lore")}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 font-mono text-[9px] tracking-widest uppercase transition-all ${
                    panelTab === "lore" ? "text-primary border-b border-primary" : "text-primary/30 hover:text-primary/60"
                  }`}
                >
                  <BookOpen className="w-3 h-3" />
                  Lore ({relevantLore.length})
                </button>
                <button
                  onClick={() => setPanelTab("history")}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 font-mono text-[9px] tracking-widest uppercase transition-all ${
                    panelTab === "history" ? "text-primary border-b border-primary" : "text-primary/30 hover:text-primary/60"
                  }`}
                >
                  <Clock className="w-3 h-3" />
                  History ({charRelHistory.length})
                </button>
              </div>

              {/* Panel Content */}
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {panelTab === "lore" && (
                  <>
                    {relevantLore.length === 0 ? (
                      <div className="text-center py-12">
                        <p className="font-mono text-[10px] text-primary/20 tracking-widest uppercase">
                          No lore found for {connectedChar ? `${selectedChar.name} & ${connectedChar.name}` : selectedChar.name}
                        </p>
                      </div>
                    ) : (
                      relevantLore.map((entry) => (
                        <div key={entry.id} className="border border-primary/10 bg-primary/5 p-3 space-y-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className={`text-[8px] font-mono tracking-widest uppercase ${categoryColors[entry.category] || "text-primary/40"}`}>
                              {entry.category?.replace("_", " ")}
                            </span>
                            <span className={`text-[8px] font-mono tracking-widest uppercase px-1.5 py-0.5 border ${
                              entry.importance === "critical" ? "border-red-400/30 text-red-400 bg-red-400/10" :
                              entry.importance === "high" ? "border-yellow-400/30 text-yellow-400 bg-yellow-400/10" :
                              "border-primary/15 text-primary/30"
                            }`}>
                              {entry.importance}
                            </span>
                          </div>
                          <p className="font-mono text-[9px] text-primary/60 tracking-wider leading-relaxed">
                            <span className="text-primary/40">[{entry.subject}]</span> {entry.fact}
                          </p>
                        </div>
                      ))
                    )}
                  </>
                )}

                {panelTab === "history" && (
                  <>
                    {charRelHistory.length === 0 ? (
                      <div className="text-center py-12">
                        <p className="font-mono text-[10px] text-primary/20 tracking-widest uppercase">
                          No relationship history yet
                        </p>
                      </div>
                    ) : (
                      charRelHistory.map((rel) => {
                        const sess = sessions.find((s) => s.id === rel.session_id);
                        return (
                          <div key={rel.id} className="border border-primary/10 bg-primary/5 p-3 space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-mono text-[9px] text-primary/50 tracking-wider truncate">
                                {sess?.title || "Unknown Session"}
                              </span>
                              <span className={`text-[8px] font-mono tracking-widest uppercase px-1.5 py-0.5 border flex-shrink-0 ${tierColors[rel.tier || "neutral"]}`}>
                                {rel.tier || "neutral"}
                              </span>
                            </div>
                            {/* Score bar */}
                            <div className="space-y-1">
                              <div className="flex items-center justify-between">
                                <span className="font-mono text-[8px] text-primary/30">Affinity</span>
                                <span className={`font-mono text-[9px] ${rel.score >= 0 ? "text-green-400" : "text-red-400"}`}>
                                  {rel.score > 0 ? "+" : ""}{rel.score ?? 0}
                                </span>
                              </div>
                              <div className="w-full h-1.5 bg-primary/10 relative overflow-hidden">
                                <div
                                  className={`absolute top-0 h-full transition-all ${rel.score >= 0 ? "bg-green-400/60 left-1/2" : "bg-red-400/60 right-1/2"}`}
                                  style={{ width: `${Math.abs((rel.score || 0) / 2)}%` }}
                                />
                                <div className="absolute left-1/2 top-0 h-full w-px bg-primary/20" />
                              </div>
                            </div>
                            <div className="flex items-center justify-between text-[8px] font-mono text-primary/30">
                              <span>{rel.total_interactions || 0} interactions</span>
                              {rel.last_delta !== undefined && rel.last_delta !== 0 && (
                                <span className={rel.last_delta > 0 ? "text-green-400/70" : "text-red-400/70"}>
                                  last: {rel.last_delta > 0 ? "+" : ""}{rel.last_delta}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}