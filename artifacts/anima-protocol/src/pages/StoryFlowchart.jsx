import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { ArrowLeft, Plus, Link2, Trash2, Edit2, Save, X } from "lucide-react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";

export default function StoryFlowchart() {
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get("session");

  const [storypoints, setStorypoints] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [selectedSession, setSelectedSession] = useState(sessionId || "");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [linkMode, setLinkMode] = useState(false);
  const [selectedNodes, setSelectedNodes] = useState([]);

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (selectedSession) {
      loadStorypoints();
    }
  }, [selectedSession]);

  const loadData = async () => {
    setLoading(true);
    const [s, sp] = await Promise.all([
      base44.entities.ChatSession.list("-updated_date", 50),
      base44.entities.Storypoint.list("order", 300),
    ]);
    setSessions(s || []);
    setStorypoints(sp || []);
    if (!selectedSession && s?.length > 0) {
      setSelectedSession(s[0].id);
    }
    setLoading(false);
  };

  const loadStorypoints = async () => {
    const data = await base44.entities.Storypoint.list("order", 300);
    setStorypoints(
      (data || []).filter((sp) => !selectedSession || sp.session_id === selectedSession)
    );
  };

  const handleReorder = async (fromIdx, toIdx) => {
    if (toIdx < 0 || toIdx >= storypoints.length) return;

    const reordered = [...storypoints];
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);

    const updates = reordered.map((sp, idx) =>
      base44.entities.Storypoint.update(sp.id, { order: idx })
    );
    await Promise.all(updates);
    setStorypoints(reordered);
  };

  const handleDelete = async (id) => {
    await base44.entities.Storypoint.delete(id);
    setStorypoints(storypoints.filter((sp) => sp.id !== id));
  };

  const toggleLinkMode = () => {
    setLinkMode(!linkMode);
    setSelectedNodes([]);
  };

  const toggleNodeSelection = (id) => {
    if (!linkMode) return;
    setSelectedNodes((prev) =>
      prev.includes(id) ? prev.filter((n) => n !== id) : [...prev, id]
    );
  };

  const createDependency = async () => {
    if (selectedNodes.length !== 2) return;

    const [from, to] = selectedNodes;
    const fromPoint = storypoints.find((sp) => sp.id === from);
    const toPoint = storypoints.find((sp) => sp.id === to);

    if (!fromPoint || !toPoint) return;

    await base44.entities.Storypoint.update(to, {
      dependencies: [...(toPoint.dependencies || []), from],
    });

    await loadStorypoints();
    setSelectedNodes([]);
    setLinkMode(false);
  };

  if (loading) {
    return (
      <div className="text-center py-12 font-mono text-primary/30 text-sm animate-pulse">
        Loading flowchart...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background overflow-x-hidden">
      <div className="w-full px-3 sm:px-6 py-4 sm:py-6">
        {/* Header */}
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="font-mono text-primary glow-text tracking-[0.2em] uppercase text-lg sm:text-2xl mb-2">
              // Story Flowchart
            </h1>
            <p className="text-[10px] sm:text-xs font-mono text-primary/40 tracking-widest">
              Visualize and reorganize narrative structure
            </p>
          </div>
          <button
            onClick={toggleLinkMode}
            className={`px-4 py-2 border font-mono text-xs tracking-widest uppercase hud-corner transition-all flex-shrink-0 ${
              linkMode
                ? "border-cyan-400/60 bg-cyan-400/10 text-cyan-400"
                : "border-primary/20 text-primary/40 hover:text-primary/70 hover:border-primary/40"
            }`}
          >
            <Link2 className="w-4 h-4 inline mr-2" />
            {linkMode ? "Linking..." : "Link Events"}
          </button>
        </div>

        {/* Session selector */}
        <div className="mb-6">
          <label className="block text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-2">
            Session
          </label>
          <select
            value={selectedSession}
            onChange={(e) => {
              setSelectedSession(e.target.value);
              setSelectedNodes([]);
              setLinkMode(false);
            }}
            className="w-full bg-black/60 border border-primary/20 text-primary/70 font-mono text-xs px-3 py-2.5 focus:outline-none focus:border-primary/50"
          >
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title || "Untitled"} ({s.messages?.length || 0} msgs)
              </option>
            ))}
          </select>
        </div>

        {/* Flowchart */}
        {storypoints.length === 0 ? (
          <div className="text-center py-12">
            <p className="font-mono text-primary/20 text-sm tracking-widest uppercase">
              No narrative beats yet
            </p>
          </div>
        ) : (
          <div className="space-y-2 sm:space-y-3">
            {storypoints.map((point, idx) => {
              const isSelected = selectedNodes.includes(point.id);
              const hasNext = idx < storypoints.length - 1;
              const hasDependencies = point.dependencies?.length > 0;

              return (
                <div key={point.id}>
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`p-3 sm:p-4 border transition-all hud-corner cursor-pointer group ${
                      isSelected
                        ? "border-cyan-400/60 bg-cyan-400/10"
                        : "border-primary/15 bg-black/40 hover:border-primary/40"
                    } ${linkMode ? "cursor-pointer" : ""}`}
                    onClick={() => linkMode && toggleNodeSelection(point.id)}
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-mono text-[9px] sm:text-xs text-primary/40 tracking-widest">
                            BEAT {idx + 1}
                          </span>
                          {hasDependencies && (
                            <span className="text-[8px] font-mono text-orange-400 tracking-widest">
                              ⚡ DEPENDENT
                            </span>
                          )}
                        </div>
                        <h3 className="font-mono text-xs sm:text-sm tracking-wider uppercase text-primary truncate">
                          {point.title || "Untitled"}
                        </h3>
                      </div>
                      {!linkMode && (
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (idx > 0) handleReorder(idx, idx - 1);
                            }}
                            disabled={idx === 0}
                            className="w-6 h-6 border border-primary/20 text-primary/30 hover:text-primary/70 disabled:opacity-20 flex items-center justify-center text-xs"
                          >
                            ↑
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (idx < storypoints.length - 1)
                                handleReorder(idx, idx + 1);
                            }}
                            disabled={idx === storypoints.length - 1}
                            className="w-6 h-6 border border-primary/20 text-primary/30 hover:text-primary/70 disabled:opacity-20 flex items-center justify-center text-xs"
                          >
                            ↓
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDelete(point.id);
                            }}
                            className="w-6 h-6 border border-red-900/20 text-red-900/40 hover:text-red-400 flex items-center justify-center text-xs transition-colors"
                          >
                            ✕
                          </button>
                        </div>
                      )}
                    </div>

                    {point.summary && (
                      <p className="text-[9px] sm:text-[10px] font-mono text-primary/50 leading-relaxed line-clamp-2 mb-2">
                        {point.summary}
                      </p>
                    )}

                    {point.characters_involved?.length > 0 && (
                      <div className="text-[8px] font-mono text-primary/30 tracking-widest">
                        {point.characters_involved.length} character(s) involved
                      </div>
                    )}
                  </motion.div>

                  {/* Connection line */}
                  {hasNext && (
                    <div className="flex justify-center py-1">
                      <div className="w-0.5 h-3 sm:h-4 bg-primary/10" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Link mode actions */}
        {linkMode && selectedNodes.length === 2 && (
          <div className="fixed bottom-6 left-6 right-6 sm:left-auto sm:right-6 p-4 border border-cyan-400/40 bg-cyan-400/10 hud-corner flex items-center justify-between gap-4">
            <p className="font-mono text-xs text-cyan-400 tracking-widest">
              Link {storypoints.find((s) => s.id === selectedNodes[0])?.title || "Event 1"} →{" "}
              {storypoints.find((s) => s.id === selectedNodes[1])?.title || "Event 2"}?
            </p>
            <div className="flex gap-2 flex-shrink-0">
              <button
                onClick={() => {
                  setSelectedNodes([]);
                  setLinkMode(false);
                }}
                className="px-3 py-1.5 border border-primary/20 text-primary/40 hover:text-primary/70 font-mono text-[9px] tracking-widest uppercase"
              >
                Cancel
              </button>
              <button
                onClick={createDependency}
                className="px-3 py-1.5 border border-cyan-400/40 bg-cyan-400/10 text-cyan-400 hover:bg-cyan-400/20 font-mono text-[9px] tracking-widest uppercase"
              >
                Create Link
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}