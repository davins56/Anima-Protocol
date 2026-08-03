import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { usePaginatedEntities } from "@/hooks/usePaginatedEntities";
import { useConfirm } from "@/lib/ConfirmDialog";
import { useNavigate } from "react-router-dom";
import {
  Trash2,
  Play,
  Users,
  Clock,
  Search,
  Loader,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

const PAGE_SIZE = 30;

export default function YnStoriesLibrary() {
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [characters, setCharacters] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filterMode, setFilterMode] = useState("all");
  const [deleting, setDeleting] = useState(null);

  // Debounce the search box so a paged query isn't fired on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchTerm.trim()), 300);
    return () => clearTimeout(t);
  }, [searchTerm]);

  // Characters are only needed to resolve a session's character names; load the
  // roster once (it isn't part of the paged story list).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const chars = await base44.entities.Character.list("-created_date", 500);
        if (!cancelled) setCharacters(chars || []);
      } catch (err) {
        console.error("Failed to load characters:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Push mode filter + title search into the SQL query so they apply across the
  // WHOLE history, not just the loaded page. Memoised for a stable identity so
  // the pagination query key only changes when a filter/search actually changes.
  const listOpts = useMemo(() => {
    const opts = { withMessages: false };
    if (filterMode !== "all") opts.filters = { mode: filterMode };
    if (debouncedSearch) opts.search = { title: debouncedSearch };
    return opts;
  }, [filterMode, debouncedSearch]);

  const {
    items: sessions,
    hasMore,
    currentPage,
    total,
    pageCount,
    goToPage,
    nextPage,
    prevPage,
    isLoading,
    refetch,
  } = usePaginatedEntities("ChatSession", PAGE_SIZE, "-updated_date", listOpts, {
    countTotal: true,
  });

  // Per-card message totals for the CURRENT page only — a lightweight COUNT, not
  // a full-history hydration. Keyed by the page's session ids so it refetches
  // when the page (or filter/search) changes.
  const sessionIds = useMemo(() => sessions.map((s) => s.id), [sessions]);
  const { data: messageCounts } = useQuery({
    queryKey: ["ChatMessage", "counts", sessionIds],
    queryFn: () => base44.messages.counts(sessionIds),
    enabled: sessionIds.length > 0,
    staleTime: 60000,
  });

  const handleResume = (sessionId) => {
    navigate(`/chat/${sessionId}`);
  };

  const handleDelete = async (sessionId) => {
    const ok = await confirm({
      title: "Delete this story?",
      message: "This permanently removes the story and cannot be undone.",
      confirmLabel: "Delete",
    });
    if (!ok) return;

    setDeleting(sessionId);
    try {
      await base44.entities.ChatSession.delete(sessionId);
      await refetch();
    } catch (err) {
      console.error("Failed to delete session:", err);
      toast.error("Failed to delete session");
    } finally {
      setDeleting(null);
    }
  };

  const showPager = hasMore || currentPage > 0;

  // A compact, windowed list of page numbers to render when the grand total is
  // known: always the first and last page, a small window around the current
  // page, and "…" gaps between non-adjacent groups. Falls back to nothing when
  // there's no count (the pager then shows only Prev/Next).
  const pageItems = useMemo(() => {
    if (!pageCount || pageCount <= 1) return [];
    const window = 1; // pages on each side of the current page
    const pages = new Set([0, pageCount - 1, currentPage]);
    for (let d = 1; d <= window; d += 1) {
      pages.add(Math.max(0, currentPage - d));
      pages.add(Math.min(pageCount - 1, currentPage + d));
    }
    const sorted = [...pages].sort((a, b) => a - b);
    const out = [];
    let prev = null;
    for (const p of sorted) {
      if (prev !== null && p - prev > 1) out.push({ gap: true, key: `gap-${prev}` });
      out.push({ page: p, key: `p-${p}` });
      prev = p;
    }
    return out;
  }, [pageCount, currentPage]);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-background p-4 sm:p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl sm:text-4xl font-mono text-primary glow-text tracking-[0.2em] uppercase mb-2">
              // Y/n Stories Library
            </h1>
            <p className="text-[10px] font-mono text-primary/30 tracking-widest">
              {total == null
                ? `${sessions.length} ${sessions.length === 1 ? "story" : "stories"} on page ${currentPage + 1}`
                : `${total} ${total === 1 ? "story" : "stories"}${
                    pageCount && pageCount > 1
                      ? ` · page ${currentPage + 1} of ${pageCount}`
                      : ""
                  }`}
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
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="text-center">
              <Loader className="w-8 h-8 text-primary/40 animate-spin mx-auto mb-3" />
              <p className="font-mono text-[10px] text-primary/40 tracking-widest uppercase">
                Loading stories...
              </p>
            </div>
          </div>
        ) : sessions.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-16 h-16 border-2 border-primary/20 rounded mx-auto mb-4 flex items-center justify-center">
              <Users className="w-8 h-8 text-primary/20" />
            </div>
            <p className="font-mono text-[10px] text-primary/30 tracking-widest uppercase">
              {debouncedSearch || filterMode !== "all"
                ? "No stories match your search"
                : "No imported stories yet"}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {sessions.map((session) => {
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

               const messageCount = messageCounts ? messageCounts[session.id] ?? 0 : null;

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
                        {messageCount == null ? "…" : messageCount} messages
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

        {/* Pager */}
        {showPager && (
          <div className="flex flex-wrap items-center justify-center gap-1.5 sm:gap-2 mt-8">
            <button
              onClick={prevPage}
              disabled={currentPage === 0}
              className="flex items-center justify-center gap-1.5 px-3 py-2 font-mono text-[9px] tracking-widest uppercase border border-primary/20 text-primary/50 hover:text-primary hover:border-primary/40 transition-all disabled:opacity-25 disabled:cursor-not-allowed"
              title="Previous page"
            >
              <ChevronLeft className="w-3 h-3" />
              <span className="hidden sm:inline">Prev</span>
            </button>

            {/* Numbered page jumps (shown once the grand total is known). One tap
                reaches any page — including the last — instead of stepping. */}
            {pageItems.length > 0 ? (
              pageItems.map((item) =>
                item.gap ? (
                  <span
                    key={item.key}
                    className="font-mono text-[10px] text-primary/30 px-1 select-none"
                  >
                    …
                  </span>
                ) : (
                  <button
                    key={item.key}
                    onClick={() => goToPage(item.page)}
                    disabled={item.page === currentPage}
                    aria-current={item.page === currentPage ? "page" : undefined}
                    className={`min-w-[2.25rem] px-2.5 py-2 font-mono text-[10px] tracking-widest tabular-nums border transition-all ${
                      item.page === currentPage
                        ? "border-primary/60 bg-primary/15 text-primary cursor-default"
                        : "border-primary/20 text-primary/50 hover:text-primary hover:border-primary/40"
                    }`}
                  >
                    {item.page + 1}
                  </button>
                ),
              )
            ) : (
              <span className="font-mono text-[10px] text-primary/40 tracking-widest tabular-nums px-2">
                Page {currentPage + 1}
              </span>
            )}

            <button
              onClick={nextPage}
              disabled={pageCount != null ? currentPage >= pageCount - 1 : !hasMore}
              className="flex items-center justify-center gap-1.5 px-3 py-2 font-mono text-[9px] tracking-widest uppercase border border-primary/20 text-primary/50 hover:text-primary hover:border-primary/40 transition-all disabled:opacity-25 disabled:cursor-not-allowed"
              title="Next page"
            >
              <span className="hidden sm:inline">Next</span>
              <ChevronRight className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
