import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useNavigate } from "react-router-dom";
import { Trash2, Play, Users, Clock, Search, Loader, ArrowLeft } from "lucide-react";
import { format } from "date-fns";

export default function YnStoriesLibrary() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState([]);
  const [characters, setCharacters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterMode, setFilterMode] = useState("all");
  const [deleting, setDeleting] = useState(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [sessionsData, charsData] = await Promise.all([
        base44.entities.ChatSession.list("-updated_date", 100),
        base44.entities.Character.list("-created_date", 500)
      ]);
      setSessions(sessionsData || []);
      setCharacters(charsData || []);
    } catch (err) {
      console.error("Failed to load data:", err);
    } finally {
      setLoading(false);
    }
  };



  const handleResume = (sessionId) => {
    navigate(`/chat/${sessionId}`);
  };

  const handleDelete = async (sessionId) => {
    if (!confirm("Delete this story? This cannot be undone.")) return;
    
    setDeleting(sessionId);
    try {
      await base44.entities.ChatSession.delete(sessionId);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    } catch (err) {
      console.error("Failed to delete session:", err);
      alert("Failed to delete session");
    } finally {
      setDeleting(null);
    }
  };

  const filtered = sessions.filter((session) => {
    const matchSearch = session.title?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchMode = filterMode === "all" || session.mode === filterMode;
    return matchSearch && matchMode;
  });

  return (
    <div className="min-h-screen bg-background p-4 sm:p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl sm:text-4xl font-mono text-primary glow-text tracking-[0.2em] uppercase mb-2">
              // Y/n Stories Library
            </h1>
            <p className="text-[10px] font-mono text-primary/30 tracking-widest">
              {sessions.length} imported {sessions.length === 1 ? "story" : "stories"}
            </p>
          </div>
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-1.5 px-3 py-2 border border-primary/20 hover:border-primary/40 text-primary/60 hover:text-primary font-mono text-[9px] tracking-widest uppercase transition-all flex-shrink-0"
            title="Back"
          >
            <ArrowLeft className="w-3 h-3" />
            <span className="hidden sm:inline">Back</span>
          </button>
        </div>

        {/* Controls */}
        <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 mb-8">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary/30" />
            <input
              type="text"
              placeholder="Search stories..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-sm px-4 py-2.5 pl-10 focus:outline-none focus:border-primary/50 focus:bg-primary/5 transition-colors"
            />
          </div>
          <select
            value={filterMode}
            onChange={(e) => setFilterMode(e.target.value)}
            className="bg-black/60 border border-primary/20 text-primary/70 font-mono text-sm px-4 py-2.5 focus:outline-none focus:border-primary/40 w-full sm:w-32"
          >
            <option value="all">All Modes</option>
            <option value="solo">Solo</option>
            <option value="group">Group</option>
          </select>
        </div>

        {/* Loading State */}
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="text-center">
              <Loader className="w-8 h-8 text-primary/40 animate-spin mx-auto mb-3" />
              <p className="font-mono text-[10px] text-primary/40 tracking-widest uppercase">
                Loading stories...
              </p>
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-16 h-16 border-2 border-primary/20 rounded mx-auto mb-4 flex items-center justify-center">
              <Users className="w-8 h-8 text-primary/20" />
            </div>
            <p className="font-mono text-[10px] text-primary/30 tracking-widest uppercase">
              {searchTerm ? "No stories match your search" : "No imported stories yet"}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((session) => {
               const sessionCharacters = [];
               if (session.mode === "solo" && session.character_id) {
                 const char = characters.find(c => c.id === session.character_id);
                 if (char) sessionCharacters.push(char);
               } else if (session.mode === "group" && session.group_character_ids) {
                 session.group_character_ids.forEach(charId => {
                   const char = characters.find(c => c.id === charId);
                   if (char) sessionCharacters.push(char);
                 });
               }

               return (
                <div
                  key={session.id}
                  className="border border-primary/20 bg-black/40 hover:bg-black/60 transition-colors overflow-hidden hud-corner glow-border"
                >
                  {/* Card Header */}
                  <div className="p-4 border-b border-primary/10 bg-black/60">
                    <h3 className="font-mono text-xs text-primary tracking-wider truncate mb-2">
                      {session.title || "Untitled Story"}
                    </h3>
                    <div className="flex items-center gap-2 text-[9px] font-mono text-primary/50">
                      <span className={`px-2 py-0.5 border ${
                        session.mode === "solo"
                          ? "border-cyan-400/30 bg-cyan-400/5 text-cyan-400"
                          : "border-purple-400/30 bg-purple-400/5 text-purple-400"
                      }`}>
                        {session.mode === "solo" ? "SOLO" : "GROUP"}
                      </span>
                      <span className="text-primary/40">
                        {session.messages?.length || 0} messages
                      </span>
                    </div>
                  </div>

                  {/* Card Body */}
                  <div className="p-4 space-y-3">
                    {/* Characters */}
                     <div>
                       <p className="text-[8px] font-mono text-primary/40 tracking-widest uppercase mb-1.5">
                         Characters
                       </p>
                       {sessionCharacters.length > 0 ? (
                         <div className="flex flex-wrap gap-1">
                           {sessionCharacters.slice(0, 3).map((char, idx) => (
                             <span key={idx} className="text-[9px] font-mono text-primary/60 px-2 py-0.5 border border-primary/15 bg-primary/5">
                               {char.name}
                             </span>
                           ))}
                           {sessionCharacters.length > 3 && (
                             <span className="text-[9px] font-mono text-primary/50 px-2 py-0.5">
                               +{sessionCharacters.length - 3}
                             </span>
                           )}
                         </div>
                       ) : (
                         <p className="text-[9px] font-mono text-primary/40">None</p>
                       )}
                     </div>

                    {/* Last Updated */}
                    <div className="flex items-center gap-2 text-[8px] font-mono text-primary/40">
                      <Clock className="w-3 h-3" />
                      {session.updated_date
                        ? format(new Date(session.updated_date), "MMM d, yyyy h:mm a")
                        : "Unknown"}
                    </div>

                    {/* Last Message Preview */}
                    {session.last_message && (
                      <div className="p-2 bg-primary/5 border border-primary/10 rounded text-[9px] font-mono text-primary/60 line-clamp-2">
                        {session.last_message}
                      </div>
                    )}
                  </div>

                  {/* Card Footer */}
                  <div className="flex gap-2 p-4 border-t border-primary/10 bg-black/60">
                    <button
                      onClick={() => handleResume(session.id)}
                      className="flex-1 flex items-center justify-center gap-2 px-3 py-2 border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 transition-all font-mono text-[9px] tracking-widest uppercase"
                    >
                      <Play className="w-3 h-3" />
                      Resume
                    </button>
                    <button
                      onClick={() => handleDelete(session.id)}
                      disabled={deleting === session.id}
                      className="flex-1 flex items-center justify-center gap-2 px-3 py-2 border border-red-900/30 text-red-900/60 hover:text-red-400 hover:border-red-400/50 disabled:opacity-40 transition-all font-mono text-[9px] tracking-widest uppercase"
                    >
                      <Trash2 className="w-3 h-3" />
                      {deleting === session.id ? "..." : "Delete"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}