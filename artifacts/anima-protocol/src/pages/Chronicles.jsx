import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { motion, AnimatePresence } from "framer-motion";
import {
  BookOpen, ArrowLeft, RefreshCw, Search, ChevronDown, ChevronUp,
  Feather, Calendar, Clock, Heart, X
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import PullToRefreshContainer from "@/components/mobile/PullToRefreshContainer";
import MobileDrawerSelect from "@/components/mobile/MobileDrawerSelect";

const TONE_STYLES = {
  hopeful:     { color: "text-lime-400",    border: "border-lime-400/30",    bg: "bg-lime-400/5",    icon: "✦" },
  melancholic: { color: "text-cyan-300",    border: "border-cyan-300/30",    bg: "bg-cyan-300/5",    icon: "◈" },
  angry:       { color: "text-red-400",     border: "border-red-400/30",     bg: "bg-red-400/5",     icon: "▲" },
  reflective:  { color: "text-blue-400",    border: "border-blue-400/30",    bg: "bg-blue-400/5",    icon: "◎" },
  anxious:     { color: "text-orange-300",  border: "border-orange-300/30",  bg: "bg-orange-300/5",  icon: "◇" },
  peaceful:    { color: "text-green-400",   border: "border-green-400/30",   bg: "bg-green-400/5",   icon: "○" },
  confused:    { color: "text-purple-400",  border: "border-purple-400/30",  bg: "bg-purple-400/5",  icon: "~" },
};

function ChronicleList({ dateGroups, characters, sessions, openEntries, toggleEntry }) {
  return (
    <div className="space-y-8">
      {dateGroups.map(([dateLabel, entries]) => (
        <div key={dateLabel}>
          <div className="flex items-center gap-3 mb-4">
            <div className="h-px flex-1 bg-primary/10" />
            <span className="font-mono text-[9px] text-primary/30 tracking-widest uppercase px-2">{dateLabel}</span>
            <div className="h-px flex-1 bg-primary/10" />
          </div>
          <div className="space-y-3">
            {entries.map(journal => (
              <ChronicleEntry
                key={journal.id}
                journal={journal}
                character={characters.find(c => c.id === journal.character_id)}
                session={sessions.find(s => s.id === journal.session_id)}
                isOpen={openEntries.has(journal.id)}
                onToggle={() => toggleEntry(journal.id)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ChronicleEntry({ journal, character, session, isOpen, onToggle }) {
  const tone = TONE_STYLES[journal.emotional_tone] || TONE_STYLES.reflective;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className={`border ${tone.border} ${tone.bg} rounded overflow-hidden`}
    >
      {/* Entry Header */}
      <button
        onClick={onToggle}
        className="w-full flex items-start gap-3 p-4 text-left hover:bg-white/5 transition-colors"
      >
        {/* Avatar or initial */}
        <div className="flex-shrink-0 mt-0.5">
          {character?.avatar_url ? (
            <img src={character.avatar_url} alt={character.name} className="w-9 h-9 border border-primary/20 object-cover" />
          ) : (
            <div className={`w-9 h-9 border ${tone.border} flex items-center justify-center font-mono text-sm ${tone.color}`}>
              {character?.name?.[0] || "?"}
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className={`font-sacred text-sm ${tone.color} leading-snug`}>{journal.title}</p>
              <p className="font-mono text-[9px] text-primary/40 tracking-widest mt-0.5 uppercase">
                {character?.name || "Unknown"} · {journal.emotional_tone}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className={`font-mono text-[8px] ${tone.color} tracking-widest hidden sm:inline`}>
                {tone.icon}
              </span>
              {isOpen
                ? <ChevronUp className="w-3.5 h-3.5 text-primary/30" />
                : <ChevronDown className="w-3.5 h-3.5 text-primary/30" />
              }
            </div>
          </div>

          {!isOpen && (
            <p className="font-mono text-[9px] text-primary/50 mt-1.5 line-clamp-2 leading-relaxed">
              {journal.content}
            </p>
          )}

          <div className="flex items-center gap-3 mt-1.5 text-[8px] font-mono text-primary/25">
            <span className="flex items-center gap-1">
              <Clock className="w-2.5 h-2.5" />
              {journal.created_date
                ? formatDistanceToNow(new Date(journal.created_date), { addSuffix: true })
                : "recently"}
            </span>
            {session?.title && (
              <span className="truncate hidden sm:inline">· {session.title}</span>
            )}
          </div>
        </div>
      </button>

      {/* Expanded content */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="border-t border-primary/10"
          >
            <div className="p-4 space-y-4">
              {/* Main journal text */}
              <div className="font-mono text-[11px] text-primary/75 leading-relaxed whitespace-pre-wrap">
                {journal.content}
              </div>

              {/* Insight */}
              {journal.character_insights && (
                <div className={`p-3 border ${tone.border} rounded`}>
                  <p className="font-mono text-[8px] text-primary/40 tracking-widest uppercase mb-1">Insight</p>
                  <p className={`font-mono text-[10px] ${tone.color} italic`}>{journal.character_insights}</p>
                </div>
              )}

              {/* Key Moments */}
              {journal.key_moments?.length > 0 && (
                <div>
                  <p className="font-mono text-[8px] text-primary/30 tracking-widest uppercase mb-2">Key Moments</p>
                  <div className="space-y-1">
                    {journal.key_moments.map((m, i) => (
                      <div key={i} className={`flex items-start gap-2 text-[10px] font-mono text-primary/60`}>
                        <span className={`${tone.color} flex-shrink-0 mt-0.5`}>—</span>
                        <span>{m}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Date / session */}
              <div className="flex items-center gap-3 pt-2 border-t border-primary/10 text-[8px] font-mono text-primary/20">
                <Calendar className="w-2.5 h-2.5" />
                <span>
                  {journal.created_date
                    ? format(new Date(journal.created_date), "PPP 'at' HH:mm")
                    : "Unknown date"}
                </span>
                {session?.title && <span>· {session.title}</span>}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export default function Chronicles() {
  const [journals, setJournals] = useState([]);
  const [characters, setCharacters] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [compiling, setCompiling] = useState(false);
  const [openEntries, setOpenEntries] = useState(new Set());
  const [search, setSearch] = useState("");
  const [filterChar, setFilterChar] = useState("all");
  const [filterTone, setFilterTone] = useState("all");
  const [compileResult, setCompileResult] = useState(null);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    const [j, c, s] = await Promise.all([
      base44.entities.CharacterJournal.list("-created_date", 200),
      base44.entities.Character.list("-created_date", 100),
      // Sessions are only used as a title lookup for each journal entry — skip
      // hydrating every session's full message history.
      base44.entities.ChatSession.list("-created_date", 100, { withMessages: false }),
    ]);
    setJournals(j || []);
    setCharacters(c || []);
    setSessions(s || []);
    setLoading(false);
  };

  const handleCompileNow = async () => {
    setCompiling(true);
    setCompileResult(null);
    try {
      const result = await base44.functions.invoke("compileDailyChronicles", {});
      setCompileResult(result?.data || result);
      await loadData();
    } catch (err) {
      setCompileResult({ error: err.message });
    } finally {
      setCompiling(false);
    }
  };

  const toggleEntry = (id) => {
    setOpenEntries(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const filtered = journals.filter(j => {
    if (filterChar !== "all" && j.character_id !== filterChar) return false;
    if (filterTone !== "all" && j.emotional_tone !== filterTone) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        j.title?.toLowerCase().includes(q) ||
        j.content?.toLowerCase().includes(q) ||
        j.character_insights?.toLowerCase().includes(q)
      );
    }
    return true;
  });

  // Group by date
  const grouped = filtered.reduce((acc, j) => {
    const dateKey = j.created_date
      ? format(new Date(j.created_date), "PPP")
      : "Unknown Date";
    if (!acc[dateKey]) acc[dateKey] = [];
    acc[dateKey].push(j);
    return acc;
  }, {});

  const dateGroups = Object.entries(grouped);

  return (
    <div className="h-[100dvh] overflow-y-auto bg-background p-4 sm:p-6 mobile-page-padding">
      <div className="max-w-2xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link to="/" className="text-primary/40 hover:text-primary transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="font-sacred text-primary glow-text tracking-[0.15em] text-xl">Chronicles</h1>
              <p className="font-mono text-[9px] text-primary/30 tracking-widest uppercase mt-0.5">
                Daily diary of every character's inner world
              </p>
            </div>
          </div>
          <button
            onClick={handleCompileNow}
            disabled={compiling}
            className="flex items-center gap-2 px-3 py-2 border border-primary/30 bg-primary/5 text-primary/70 hover:text-primary hover:border-primary/50 font-mono text-[9px] tracking-widest uppercase transition-all disabled:opacity-40"
            title="Compile chronicles for the last 24h"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${compiling ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">{compiling ? "Compiling..." : "Compile Now"}</span>
          </button>
        </div>

        {/* Compile result toast */}
        <AnimatePresence>
          {compileResult && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className={`flex items-center justify-between gap-3 px-4 py-3 border rounded font-mono text-[10px] ${
                compileResult.error
                  ? "border-red-400/30 bg-red-400/10 text-red-400"
                  : "border-primary/30 bg-primary/10 text-primary"
              }`}
            >
              <span>
                {compileResult.error
                  ? `Error: ${compileResult.error}`
                  : `${compileResult.compiled ?? 0} new chronicle${compileResult.compiled !== 1 ? "s" : ""} compiled · ${compileResult.skipped ?? 0} skipped`
                }
              </span>
              <button onClick={() => setCompileResult(null)} className="opacity-50 hover:opacity-100">
                <X className="w-3.5 h-3.5" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Filters */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <div className="relative sm:col-span-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-primary/30" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search entries..."
              className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-xs pl-9 pr-3 py-2 focus:outline-none focus:border-primary/50 transition-colors"
            />
          </div>
          <MobileDrawerSelect
            label="All Characters"
            value={filterChar}
            onChange={setFilterChar}
            options={[
              { value: "all", label: "All Characters" },
              ...characters.map(c => ({ value: c.id, label: c.name })),
            ]}
            className="w-full"
          />
          <MobileDrawerSelect
            label="All Tones"
            value={filterTone}
            onChange={setFilterTone}
            options={[
              { value: "all", label: "All Tones" },
              ...Object.keys(TONE_STYLES).map(t => ({ value: t, label: t })),
            ]}
            className="w-full"
          />
        </div>

        {/* Content */}
        {loading ? (
          <div className="text-center py-16">
            <Feather className="w-6 h-6 text-primary/20 mx-auto mb-3 animate-pulse" />
            <p className="font-mono text-[10px] text-primary/30 tracking-widest uppercase">Loading chronicles...</p>
          </div>
        ) : dateGroups.length === 0 ? (
          <div className="text-center py-16 space-y-4">
            <BookOpen className="w-8 h-8 text-primary/10 mx-auto" />
            <div>
              <p className="font-mono text-primary/30 text-sm tracking-widest uppercase">
                {journals.length === 0 ? "No chronicles yet" : "No matches"}
              </p>
              {journals.length === 0 && (
                <p className="font-mono text-[9px] text-primary/20 mt-2 max-w-xs mx-auto leading-relaxed">
                  Chronicles are compiled automatically every day from active sessions.
                  Click "Compile Now" to generate entries for the last 24 hours.
                </p>
              )}
            </div>
          </div>
        ) : (
          <>
            {/* Mobile: Pull-to-refresh wraps list */}
            <div className="block sm:hidden" style={{ minHeight: '60vh' }}>
              <PullToRefreshContainer onRefresh={loadData} isLoading={loading}>
                <ChronicleList
                  dateGroups={dateGroups}
                  characters={characters}
                  sessions={sessions}
                  openEntries={openEntries}
                  toggleEntry={toggleEntry}
                />
              </PullToRefreshContainer>
            </div>

            {/* Desktop: Plain list */}
            <div className="hidden sm:block">
              <ChronicleList
                dateGroups={dateGroups}
                characters={characters}
                sessions={sessions}
                openEntries={openEntries}
                toggleEntry={toggleEntry}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}