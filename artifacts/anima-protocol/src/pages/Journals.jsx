import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { useStoreSync } from "@/lib/useStoreSync";
import { BookOpen, Search, Trash2, Calendar, User, ArrowLeft } from "lucide-react";
import { useConfirm } from "@/lib/ConfirmDialog";
import { deleteWithUndo } from "@/lib/undoableDelete";

export default function Journals() {
  const confirm = useConfirm();
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get("session");

  const [journals, setJournals] = useState([]);
  const [filteredJournals, setFilteredJournals] = useState([]);
  const [characters, setCharacters] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [selectedJournal, setSelectedJournal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filterChar, setFilterChar] = useState("all");
  const [filterSession, setFilterSession] = useState(sessionId || "all");
  const [search, setSearch] = useState("");

  const loadData = async () => {
    setLoading(true);
    const [j, c, s] = await Promise.all([
      base44.entities.CharacterJournal.list("-created_date", 200),
      base44.entities.Character.list("-created_date", 100),
      base44.entities.ChatSession.list("-created_date", 100),
    ]);
    setJournals(j || []);
    setCharacters(c || []);
    setSessions(s || []);
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  // Live cross-device sync: refetch when another device changes our data.
  useStoreSync(loadData);

  useEffect(() => {
    applyFilters();
  }, [journals, filterChar, filterSession, search]);

  const applyFilters = () => {
    let filtered = journals;

    if (filterChar !== "all") {
      filtered = filtered.filter(j => j.character_id === filterChar);
    }

    if (filterSession !== "all") {
      filtered = filtered.filter(j => j.session_id === filterSession);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      filtered = filtered.filter(j =>
        j.title?.toLowerCase().includes(q) ||
        j.content?.toLowerCase().includes(q) ||
        j.character_insights?.toLowerCase().includes(q)
      );
    }

    setFilteredJournals(filtered);
  };

  const handleDelete = async (id) => {
    const ok = await confirm({
      title: "Delete this journal entry?",
      message: "You'll have a few seconds to undo this.",
      confirmLabel: "Delete",
    });
    if (!ok) return;
    const item = journals.find((j) => j.id === id);
    if (selectedJournal?.id === id) setSelectedJournal(null);
    await deleteWithUndo({
      entity: "CharacterJournal",
      item,
      label: "Journal entry",
      onChange: loadData,
    });
  };

  const emotionColors = {
    hopeful: "text-lime-400",
    melancholic: "text-cyan-300",
    angry: "text-red-400",
    reflective: "text-blue-400",
    anxious: "text-orange-300",
    peaceful: "text-green-400",
    confused: "text-purple-400",
  };

  return (
    <div className="min-h-screen flex gap-6 p-6 bg-background">
      {/* Journal List */}
      <div className="flex-1 flex flex-col">
        <div className="mb-4">
          <div className="flex items-center gap-4 mb-4">
            <Link to="/" className="text-primary/40 hover:text-primary transition-colors flex-shrink-0">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <h1 className="font-mono text-primary glow-text tracking-[0.2em] uppercase">// Character Journals</h1>
          </div>

          {/* Filters */}
          <div className="flex flex-col gap-3">
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
                value={filterChar}
                onChange={(e) => setFilterChar(e.target.value)}
                className="bg-black/60 border border-primary/20 text-primary/70 font-mono text-sm px-3 py-2 focus:outline-none focus:border-primary/50 transition-colors"
              >
                <option value="all">All Characters</option>
                {characters.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>

              <select
                value={filterSession}
                onChange={(e) => setFilterSession(e.target.value)}
                className="bg-black/60 border border-primary/20 text-primary/70 font-mono text-sm px-3 py-2 focus:outline-none focus:border-primary/50 transition-colors"
              >
                <option value="all">All Sessions</option>
                {sessions.map(s => (
                  <option key={s.id} value={s.id}>{s.title || "Untitled"}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Journal Cards */}
        <div className="flex-1 overflow-y-auto space-y-2.5 sm:space-y-3 pr-2 sm:pr-3">
          {loading ? (
            <p className="text-center font-mono text-primary/30 text-xs sm:text-sm tracking-widest uppercase py-8 animate-pulse">
              Loading...
            </p>
          ) : filteredJournals.length === 0 ? (
            <div className="text-center py-12">
              <BookOpen className="w-6 sm:w-8 h-6 sm:h-8 text-primary/10 mx-auto mb-3" />
              <p className="font-mono text-primary/20 text-xs sm:text-sm tracking-widest uppercase">
                {journals.length === 0 ? "No journals" : "No matches"}
              </p>
            </div>
          ) : (
            filteredJournals.map(journal => {
              const char = characters.find(c => c.id === journal.character_id);
              const session = sessions.find(s => s.id === journal.session_id);
              return (
                <button
                   key={journal.id}
                   onClick={() => setSelectedJournal(journal)}
                   className={`w-full text-left p-3 border transition-all hud-corner ${
                     selectedJournal?.id === journal.id
                       ? "border-primary/40 bg-primary/10 text-primary"
                       : "border-primary/15 bg-black/40 text-primary/60 hover:border-primary/30 hover:bg-primary/5"
                   }`}
                 >
                   <div className="flex items-start justify-between gap-2 mb-2">
                     <div className="flex-1 min-w-0">
                       <h3 className="font-mono text-[9px] sm:text-xs tracking-wider uppercase mb-0.5 truncate">
                         {journal.title}
                       </h3>
                       <div className="flex items-center gap-1.5 text-[8px] sm:text-[9px] font-mono text-primary/40 flex-wrap">
                         <User className="w-2.5 sm:w-3 h-2.5 sm:h-3 flex-shrink-0" />
                         <span className="truncate">{char?.name || "Unknown"}</span>
                         <span className="hidden sm:inline">•</span>
                         <span className={emotionColors[journal.emotional_tone] || "text-primary/40"}>
                           {journal.emotional_tone}
                         </span>
                       </div>
                     </div>
                     {char?.avatar_url && (
                       <img src={char.avatar_url} alt={char.name} className="w-6 sm:w-8 h-6 sm:h-8 border border-primary/20 flex-shrink-0" />
                     )}
                   </div>
                   <p className="text-[9px] sm:text-[10px] font-mono text-primary/50 line-clamp-2">{journal.content}</p>
                   <div className="flex items-center gap-1 mt-1.5 text-[7px] sm:text-[9px] font-mono text-primary/25 truncate">
                     <Calendar className="w-2.5 sm:w-3 h-2.5 sm:h-3 flex-shrink-0" />
                     <span className="truncate">{session?.title || "Session"}</span>
                   </div>
                 </button>
              );
            })
          )}
        </div>
      </div>

      {/* Journal Detail */}
      {selectedJournal && (
        <div className="w-full lg:w-96 border border-primary/30 bg-black/60 backdrop-blur-md flex flex-col max-h-screen overflow-hidden">
          {/* Header */}
          <div className="flex items-start justify-between p-4 border-b border-primary/20">
            <div className="flex-1">
              <h2 className="font-mono text-primary text-sm tracking-[0.2em] uppercase mb-2">
                {selectedJournal.title}
              </h2>
              <div className="space-y-1">
                <p className="text-[9px] font-mono text-primary/40">
                  By: {characters.find(c => c.id === selectedJournal.character_id)?.name || "Unknown"}
                </p>
                <p className={`text-[9px] font-mono tracking-widest uppercase ${emotionColors[selectedJournal.emotional_tone] || "text-primary/40"}`}>
                  Tone: {selectedJournal.emotional_tone}
                </p>
              </div>
            </div>
            <button
              onClick={() => handleDelete(selectedJournal.id)}
              className="text-red-900/40 hover:text-red-400 transition-colors ml-2"
            >
              <Trash2 className="w-5 h-5" />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* Main content */}
            <div>
              <p className="text-[10px] font-mono text-primary/70 leading-relaxed whitespace-pre-wrap">
                {selectedJournal.content}
              </p>
            </div>

            {/* Insights */}
            {selectedJournal.character_insights && (
              <div className="p-3 border border-primary/15 bg-primary/5">
                <p className="text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-1.5">Insight</p>
                <p className="text-xs font-mono text-primary/70">{selectedJournal.character_insights}</p>
              </div>
            )}

            {/* Key moments */}
            {selectedJournal.key_moments?.length > 0 && (
              <div>
                <p className="text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-2">Key Moments</p>
                <div className="space-y-1.5">
                  {selectedJournal.key_moments.map((moment, i) => (
                    <div key={i} className="text-[10px] font-mono text-primary/60 border-l-2 border-primary/20 pl-2">
                      {moment}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Relationships affected */}
            {selectedJournal.relationships_affected?.length > 0 && (
              <div>
                <p className="text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-2">Relationships</p>
                <div className="space-y-1">
                  {selectedJournal.relationships_affected.map((rel, i) => {
                    const relChar = characters.find(c => c.id === rel.character_id);
                    return (
                      <div key={i} className="text-[9px] font-mono p-2 border border-primary/15 bg-primary/5">
                        <p className="text-primary/70 font-bold">{relChar?.name || "Unknown"}</p>
                        <p className="text-primary/50 text-[8px] mt-0.5">{rel.change}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}