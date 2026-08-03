import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { ArrowLeft, BookOpen, Search, Filter, Sparkles } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";

const categoryConfig = {
  character_fact: { label: "Characters", color: "text-cyan-400", borderColor: "border-cyan-400/30", bg: "bg-cyan-400/5" },
  item: { label: "Items", color: "text-yellow-400", borderColor: "border-yellow-400/30", bg: "bg-yellow-400/5" },
  location: { label: "Locations", color: "text-green-400", borderColor: "border-green-400/30", bg: "bg-green-400/5" },
  event: { label: "Events", color: "text-purple-400", borderColor: "border-purple-400/30", bg: "bg-purple-400/5" },
  relationship: { label: "Bonds", color: "text-rose-400", borderColor: "border-rose-400/30", bg: "bg-rose-400/5" },
  secret: { label: "Secrets", color: "text-red-400", borderColor: "border-red-400/30", bg: "bg-red-400/5" },
  rule: { label: "Rules", color: "text-blue-400", borderColor: "border-blue-400/30", bg: "bg-blue-400/5" },
};

const importanceColor = {
  critical: "text-red-400",
  high: "text-yellow-400",
  medium: "text-primary/60",
  low: "text-primary/30",
};

export default function LoreArchive() {
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get("session");

  const [lore, setLore] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [selectedSession, setSelectedSession] = useState(sessionId || "");
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterImportance, setFilterImportance] = useState("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSessions();
  }, []);

  useEffect(() => {
    if (selectedSession) loadLore();
    else setLore([]);
  }, [selectedSession]);

  const loadSessions = async () => {
    const data = await base44.entities.ChatSession.list("-updated_date", 100);
    setSessions(data || []);
    setLoading(false);
  };

  const loadLore = async () => {
    setLoading(true);
    const query = { session_id: selectedSession, is_active: true };
    const data = await base44.entities.WorldState.filter(query, "-created_date", 300);
    setLore(data || []);
    setLoading(false);
  };

  const filtered = lore.filter((entry) => {
    const categoryMatch = filterCategory === "all" || entry.category === filterCategory;
    const importanceMatch = filterImportance === "all" || entry.importance === filterImportance;
    const searchMatch =
      !search.trim() ||
      entry.subject?.toLowerCase().includes(search.toLowerCase()) ||
      entry.fact?.toLowerCase().includes(search.toLowerCase());
    return categoryMatch && importanceMatch && searchMatch;
  });

  const grouped = Object.keys(categoryConfig).reduce((acc, cat) => {
    const items = filtered.filter((e) => e.category === cat);
    if (items.length) acc[cat] = items;
    return acc;
  }, {});

  const totalEntries = lore.length;
  const criticalCount = lore.filter((e) => e.importance === "critical").length;

  return (
    <div className="min-h-[100dvh] bg-background scanline">
      {/* Header */}
      <div className="border-b border-primary/20 bg-black/60 backdrop-blur-md px-3 sm:px-6 py-3 sm:py-4">
        <div className="w-full flex items-center justify-between gap-3 sm:gap-4">
          <div className="flex items-center gap-2 sm:gap-4 flex-1 min-w-0">
            <Link to="/" className="text-primary/40 hover:text-primary transition-colors p-1">
              <ArrowLeft className="w-4 sm:w-5 h-4 sm:h-5" />
            </Link>
            <div className="min-w-0">
              <h1 className="font-mono text-primary glow-text tracking-[0.2em] uppercase text-sm sm:text-lg flex items-center gap-2">
                <BookOpen className="w-4 sm:w-5 h-4 sm:h-5 flex-shrink-0" />
                <span className="truncate">// Lore Archive</span>
              </h1>
              <p className="text-[8px] sm:text-[10px] font-mono text-primary/30 tracking-widest uppercase mt-0.5">
                {totalEntries} discoveries {criticalCount > 0 && `• ${criticalCount} critical`}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="w-full p-3 sm:p-6 pb-24 sm:pb-6 space-y-6">
        {/* Session Selection */}
        <select
          value={selectedSession}
          onChange={(e) => setSelectedSession(e.target.value)}
          className="w-full bg-black/60 border border-primary/20 text-primary/70 font-mono text-xs px-3 py-2.5 focus:outline-none focus:border-primary/50"
        >
          <option value="">— Select a session to explore lore —</option>
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title || "Untitled Session"}
            </option>
          ))}
        </select>

        {!selectedSession && (
          <div className="text-center py-24">
            <Sparkles className="w-12 h-12 text-primary/10 mx-auto mb-4" />
            <p className="font-mono text-primary/20 text-sm tracking-[0.3em] uppercase">
              Select a session to discover its lore
            </p>
          </div>
        )}

        {selectedSession && (
          <>
            {/* Filters */}
            <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary/30" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search lore..."
                  className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-xs pl-10 pr-4 py-2.5 focus:outline-none focus:border-primary/50 transition-colors"
                />
              </div>

              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={() => setFilterCategory("all")}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 border font-mono text-[8px] sm:text-[9px] tracking-widest uppercase transition-all ${
                    filterCategory === "all"
                      ? "border-primary/60 bg-primary/10 text-primary"
                      : "border-primary/15 text-primary/30 hover:border-primary/40"
                  }`}
                >
                  <Filter className="w-3 h-3" />
                  All
                </button>
                {Object.entries(categoryConfig).map(([cat, config]) => (
                  <button
                    key={cat}
                    onClick={() => setFilterCategory(cat)}
                    className={`px-2.5 py-1.5 border font-mono text-[8px] sm:text-[9px] tracking-widest uppercase transition-all ${
                      filterCategory === cat
                        ? `${config.color} ${config.borderColor} ${config.bg}`
                        : "border-primary/15 text-primary/30 hover:border-primary/40"
                    }`}
                  >
                    {config.label}
                  </button>
                ))}
              </div>

              <select
                value={filterImportance}
                onChange={(e) => setFilterImportance(e.target.value)}
                className="bg-black/60 border border-primary/20 text-primary/70 font-mono text-xs px-3 py-2.5 focus:outline-none focus:border-primary/50 transition-colors w-full sm:w-auto"
              >
                <option value="all">All Importance</option>
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>

            {/* Entries */}
            {loading ? (
              <div className="text-center py-12 font-mono text-primary/30 text-xs sm:text-sm animate-pulse tracking-widest uppercase">
                Analyzing narrative...
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-24">
                <BookOpen className="w-12 h-12 text-primary/10 mx-auto mb-4" />
                <p className="font-mono text-primary/20 text-sm tracking-[0.3em] uppercase mb-2">
                  {lore.length === 0 ? "No lore discovered yet" : "No matching entries"}
                </p>
                {lore.length === 0 && (
                  <p className="font-mono text-primary/15 text-xs max-w-xs mx-auto leading-relaxed">
                    Lore is automatically extracted as you progress through conversations.
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-8">
                {Object.entries(grouped).map(([category, entries]) => {
                  const config = categoryConfig[category];
                  return (
                    <div key={category}>
                      <div className="flex items-center gap-2 mb-3">
                        <div className={`w-2 h-2 rounded-full ${config.color}`} />
                        <h2 className={`font-mono text-sm tracking-[0.2em] uppercase ${config.color}`}>
                          {config.label}
                        </h2>
                        <span className="text-[9px] font-mono text-primary/40">({entries.length})</span>
                      </div>

                      <div className="grid gap-2 sm:gap-3">
                        {entries.map((entry) => (
                          <div
                            key={entry.id}
                            className={`group p-3 sm:p-4 border transition-all hover:border-opacity-60 ${config.borderColor} ${config.bg}`}
                          >
                            <div className="flex items-start justify-between gap-3 mb-2">
                              <div className="flex-1 min-w-0">
                                <h3 className={`font-mono text-sm tracking-wider uppercase truncate ${config.color}`}>
                                  {entry.subject}
                                </h3>
                                <p className={`text-[8px] sm:text-[9px] font-mono mt-0.5 ${importanceColor[entry.importance]}`}>
                                  ● {entry.importance.toUpperCase()}
                                </p>
                              </div>
                              {entry.source_message_index !== undefined && (
                                <span className="text-[8px] font-mono text-primary/40 flex-shrink-0">
                                  msg #{entry.source_message_index}
                                </span>
                              )}
                            </div>

                            <p className="font-mono text-xs text-primary/70 leading-relaxed">
                              {entry.fact}
                            </p>

                            <div className="flex items-center justify-between mt-2 pt-2 border-t border-current/10">
                              <span className="text-[8px] font-mono text-current/50">
                                {new Date(entry.created_date).toLocaleDateString()}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}