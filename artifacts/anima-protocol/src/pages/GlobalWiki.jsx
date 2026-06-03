import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { ArrowLeft, BookOpen, Search, TrendingUp, Users, Lightbulb, Tag } from "lucide-react";
import { Link } from "react-router-dom";

const CATEGORIES = ["character_fact", "item", "location", "event", "relationship", "secret", "rule"];

export default function GlobalWiki() {
  const [loreEntries, setLoreEntries] = useState([]);
  const [characterMemories, setCharacterMemories] = useState([]);
  const [characters, setCharacters] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterImportance, setFilterImportance] = useState("all");
  const [view, setView] = useState("entries"); // "entries", "themes", "characters"

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    const [lore, chars, sess] = await Promise.all([
      base44.entities.WorldState.filter({ is_active: true }, "-created_date", 500),
      base44.entities.Character.list("-created_date", 200),
      // Sessions are only used here as a title/id lookup for lore entries — skip
      // hydrating every session's full message history so the wiki loads fast.
      base44.entities.ChatSession.list("-updated_date", 200, { withMessages: false })
    ]);

    setLoreEntries(lore || []);
    setCharacters(chars || []);
    setSessions(sess || []);

    // Load character memories
    const allMemories = [];
    for (const char of (chars || []).slice(0, 50)) {
      const res = await base44.functions.invoke("characterMemory", {
        action: "get",
        character_id: char.id
      }).catch(() => ({ data: { memories: [] } }));
      if (res?.data?.memories) {
        allMemories.push(...res.data.memories.map(m => ({ ...m, character_id: char.id, character_name: char.name })));
      }
    }
    setCharacterMemories(allMemories);
    setLoading(false);
  };

  // Aggregate themes from lore entries
  const extractThemes = () => {
    const themes = {};
    (loreEntries || []).forEach(entry => {
      const words = entry.fact?.toLowerCase().split(/\s+/) || [];
      words.forEach(word => {
        if (word.length > 5 && !["about", "their", "which", "where"].includes(word)) {
          themes[word] = (themes[word] || 0) + 1;
        }
      });
    });
    return Object.entries(themes)
      .filter(([_, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20);
  };

  // Group character histories across sessions
  const getCharacterHistories = () => {
    const histories = {};
    characters.forEach(char => {
      const sessionAppearances = sessions.filter(s =>
        (loreEntries || []).some(e => e.session_id === s.id && e.subject?.toLowerCase().includes(char.name.toLowerCase()))
      );
      const memories = characterMemories.filter(m => m.character_id === char.id);
      histories[char.id] = {
        character: char,
        sessions: sessionAppearances,
        memories: memories,
        totalMentions: (loreEntries || []).filter(e => e.subject?.includes(char.name)).length
      };
    });
    return Object.values(histories).sort((a, b) => b.totalMentions - a.totalMentions);
  };

  const filteredLore = (loreEntries || []).filter(entry => {
    const categoryMatch = filterCategory === "all" || entry.category === filterCategory;
    const importanceMatch = filterImportance === "all" || entry.importance === filterImportance;
    const searchMatch = !search.trim() ||
      entry.subject?.toLowerCase().includes(search.toLowerCase()) ||
      entry.fact?.toLowerCase().includes(search.toLowerCase());
    return categoryMatch && importanceMatch && searchMatch;
  });

  const themes = extractThemes();
  const characterHistories = getCharacterHistories();

  const categoryMeta = {
    character_fact: { label: "Character", color: "text-cyan-400", icon: "👤" },
    item: { label: "Item", color: "text-yellow-400", icon: "⚔️" },
    location: { label: "Location", color: "text-green-400", icon: "📍" },
    event: { label: "Event", color: "text-purple-400", icon: "⚡" },
    relationship: { label: "Bond", color: "text-rose-400", icon: "💞" },
    secret: { label: "Secret", color: "text-red-400", icon: "🔐" },
    rule: { label: "Rule", color: "text-blue-400", icon: "📜" }
  };

  const importanceColors = {
    low: "text-primary/30",
    medium: "text-primary/60",
    high: "text-yellow-400",
    critical: "text-red-400"
  };

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
                <BookOpen className="w-5 h-5" />
                // Global Wiki
              </h1>
              <p className="text-[10px] font-mono text-primary/30 tracking-widest uppercase mt-0.5">
                {(loreEntries || []).length} facts • {characterHistories.length} characters
              </p>
            </div>
          </div>

          {/* View Toggle */}
          <div className="flex gap-2">
            <button
              onClick={() => setView("entries")}
              className={`px-4 py-2 border font-mono text-[10px] tracking-widest uppercase transition-all ${
                view === "entries"
                  ? "border-primary/60 bg-primary/10 text-primary"
                  : "border-primary/15 text-primary/30 hover:border-primary/40"
              }`}
            >
              Entries
            </button>
            <button
              onClick={() => setView("themes")}
              className={`px-4 py-2 border font-mono text-[10px] tracking-widest uppercase transition-all ${
                view === "themes"
                  ? "border-primary/60 bg-primary/10 text-primary"
                  : "border-primary/15 text-primary/30 hover:border-primary/40"
              }`}
            >
              Themes
            </button>
            <button
              onClick={() => setView("characters")}
              className={`px-4 py-2 border font-mono text-[10px] tracking-widest uppercase transition-all ${
                view === "characters"
                  ? "border-primary/60 bg-primary/10 text-primary"
                  : "border-primary/15 text-primary/30 hover:border-primary/40"
              }`}
            >
              Histories
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto p-6 pb-24 lg:pb-6 space-y-6">
        {/* ────── ENTRIES VIEW ────── */}
        {view === "entries" && (
          <>
            {/* Filters */}
            <div className="space-y-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary/30" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search entries..."
                  className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-sm pl-10 pr-4 py-2.5 focus:outline-none focus:border-primary/50 transition-colors"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <select
                  value={filterCategory}
                  onChange={(e) => setFilterCategory(e.target.value)}
                  className="bg-black/60 border border-primary/20 text-primary/70 font-mono text-sm px-3 py-2 focus:outline-none focus:border-primary/50"
                >
                  <option value="all">All Categories</option>
                  {CATEGORIES.map(cat => (
                    <option key={cat} value={cat}>{categoryMeta[cat]?.label || cat}</option>
                  ))}
                </select>

                <select
                  value={filterImportance}
                  onChange={(e) => setFilterImportance(e.target.value)}
                  className="bg-black/60 border border-primary/20 text-primary/70 font-mono text-sm px-3 py-2 focus:outline-none focus:border-primary/50"
                >
                  <option value="all">All Importance</option>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </div>
            </div>

            {/* Entries Grid */}
            {loading ? (
              <div className="text-center py-12 font-mono text-primary/30 animate-pulse">Loading wiki...</div>
            ) : filteredLore.length === 0 ? (
              <div className="text-center py-12">
                <BookOpen className="w-8 h-8 text-primary/10 mx-auto mb-3" />
                <p className="font-mono text-primary/20 text-sm">No entries found</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {filteredLore.map(entry => {
                  const meta = categoryMeta[entry.category];
                  const sessionTitle = sessions.find(s => s.id === entry.session_id)?.title || "Global";
                  return (
                    <div
                      key={entry.id}
                      className="border border-primary/15 bg-black/40 p-3 space-y-2 hover:border-primary/30 transition-all"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <h3 className="font-mono text-[10px] text-primary/80 tracking-wider uppercase mb-0.5">
                            {entry.subject}
                          </h3>
                          <p className="text-[9px] font-mono text-primary/40">{meta?.label}</p>
                        </div>
                        <span className={`font-mono text-[8px] tracking-widest uppercase ${importanceColors[entry.importance]}`}>
                          {entry.importance}
                        </span>
                      </div>
                      <p className="text-[10px] font-mono text-primary/60 leading-relaxed line-clamp-3">
                        {entry.fact}
                      </p>
                      <div className="text-[8px] font-mono text-primary/25 border-t border-primary/10 pt-2">
                        from {sessionTitle}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* ────── THEMES VIEW ────── */}
        {view === "themes" && (
          <>
            <div className="flex items-center gap-2 mb-4">
              <Lightbulb className="w-5 h-5 text-primary/60" />
              <h2 className="font-mono text-sm text-primary/70 tracking-wider uppercase">Recurring Themes</h2>
            </div>

            {loading ? (
              <div className="text-center py-12 font-mono text-primary/30 animate-pulse">Analyzing themes...</div>
            ) : themes.length === 0 ? (
              <div className="text-center py-12">
                <Lightbulb className="w-8 h-8 text-primary/10 mx-auto mb-3" />
                <p className="font-mono text-primary/20 text-sm">No recurring themes</p>
              </div>
            ) : (
              <div className="space-y-3">
                {themes.map(([theme, count]) => (
                  <div key={theme} className="border border-primary/15 bg-black/40 p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-mono text-[10px] text-primary/80 tracking-wider uppercase">{theme}</span>
                      <div className="flex items-center gap-2">
                        <TrendingUp className="w-3 h-3 text-primary/50" />
                        <span className="font-mono text-[9px] text-primary/60">{count} mentions</span>
                      </div>
                    </div>
                    <div className="w-full bg-black/60 border border-primary/10 h-2">
                      <div
                        className="bg-primary/40 h-full transition-all"
                        style={{ width: `${(count / Math.max(...themes.map(t => t[1]))) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* ────── CHARACTER HISTORIES VIEW ────── */}
        {view === "characters" && (
          <>
            <div className="flex items-center gap-2 mb-4">
              <Users className="w-5 h-5 text-primary/60" />
              <h2 className="font-mono text-sm text-primary/70 tracking-wider uppercase">Character Histories Across Sessions</h2>
            </div>

            {loading ? (
              <div className="text-center py-12 font-mono text-primary/30 animate-pulse">Loading histories...</div>
            ) : characterHistories.filter(h => h.totalMentions > 0).length === 0 ? (
              <div className="text-center py-12">
                <Users className="w-8 h-8 text-primary/10 mx-auto mb-3" />
                <p className="font-mono text-primary/20 text-sm">No character histories</p>
              </div>
            ) : (
              <div className="space-y-4">
                {characterHistories.filter(h => h.totalMentions > 0).map(history => (
                  <div key={history.character.id} className="border border-primary/20 bg-primary/5 p-4 space-y-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        {history.character.avatar_url && (
                          <img
                            src={history.character.avatar_url}
                            alt={history.character.name}
                            className="w-10 h-10 border border-primary/30 object-cover"
                          />
                        )}
                        <div>
                          <h3 className="font-mono text-sm text-primary tracking-wider uppercase">
                            {history.character.name}
                          </h3>
                          {history.character.universe && (
                            <p className="text-[9px] font-mono text-primary/40">{history.character.universe}</p>
                          )}
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-mono text-[10px] text-primary/60">{history.totalMentions} mentions</p>
                        <p className="font-mono text-[9px] text-primary/40">{history.sessions.length} sessions</p>
                      </div>
                    </div>

                    {/* Sessions this character appeared in */}
                    {history.sessions.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-[9px] font-mono text-primary/40 tracking-widest uppercase">Sessions</p>
                        <div className="flex flex-wrap gap-1">
                          {history.sessions.slice(0, 5).map(session => (
                            <span
                              key={session.id}
                              className="px-2 py-1 bg-black/40 border border-primary/15 text-[8px] font-mono text-primary/60 tracking-wider uppercase"
                            >
                              {session.title?.slice(0, 12) || "Untitled"}
                            </span>
                          ))}
                          {history.sessions.length > 5 && (
                            <span className="px-2 py-1 bg-black/40 border border-primary/15 text-[8px] font-mono text-primary/50">
                              +{history.sessions.length - 5} more
                            </span>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Shared memories */}
                    {history.memories.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-[9px] font-mono text-primary/40 tracking-widest uppercase">Key Memories</p>
                        <div className="space-y-1">
                          {history.memories.slice(0, 3).map((mem, idx) => (
                            <div key={idx} className="text-[9px] font-mono text-primary/60 border-l-2 border-primary/20 pl-2 py-0.5">
                              {mem.fact}
                            </div>
                          ))}
                          {history.memories.length > 3 && (
                            <p className="text-[8px] font-mono text-primary/30">+{history.memories.length - 3} more memories</p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}