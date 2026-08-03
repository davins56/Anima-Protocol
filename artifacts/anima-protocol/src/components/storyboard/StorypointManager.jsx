import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Plus, ChevronDown, Edit2, Trash2, GripVertical } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function StorypointManager({ sessionId, isVisible = true }) {
  const [storypoints, setStorypoints] = useState([]);
  const [expandedId, setExpandedId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editTitle, setEditTitle] = useState("");
  const [editSummary, setEditSummary] = useState("");

  useEffect(() => {
    if (sessionId && isVisible) {
      loadStorypoints();

      // Subscribe to updates
      const unsubscribe = base44.entities.Storypoint.subscribe((event) => {
        if (event.data?.session_id === sessionId) {
          loadStorypoints();
        }
      });

      return unsubscribe;
    }
  }, [sessionId, isVisible]);

  const loadStorypoints = async () => {
    try {
      const data = await base44.entities.Storypoint.filter(
        { session_id: sessionId },
        "order",
        100
      );
      setStorypoints(data || []);
    } catch (err) {
      console.error("Error loading storypoints:", err);
    }
  };

  const handleAddStorypoint = async () => {
    if (!sessionId) return;
    setLoading(true);
    try {
      const nextOrder = storypoints.length > 0
        ? Math.max(...storypoints.map(s => s.order || 0)) + 1
        : 1;

      await base44.entities.Storypoint.create({
        session_id: sessionId,
        title: "Untitled Story Point",
        summary: "",
        order: nextOrder,
        key_moments: [],
        characters_involved: [],
        follow_up_suggestions: [],
      });

      await loadStorypoints();
    } catch (err) {
      console.error("Error creating storypoint:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateStorypoint = async (id) => {
    try {
      await base44.entities.Storypoint.update(id, {
        title: editTitle,
        summary: editSummary,
      });
      setEditingId(null);
      await loadStorypoints();
    } catch (err) {
      console.error("Error updating storypoint:", err);
    }
  };

  const handleDeleteStorypoint = async (id) => {
    if (!confirm("Delete this story point?")) return;
    try {
      await base44.entities.Storypoint.delete(id);
      await loadStorypoints();
    } catch (err) {
      console.error("Error deleting storypoint:", err);
    }
  };

  const handleReorderStorypoints = async (storypoints) => {
    try {
      for (let i = 0; i < storypoints.length; i++) {
        await base44.entities.Storypoint.update(storypoints[i].id, {
          order: i + 1,
        });
      }
      await loadStorypoints();
    } catch (err) {
      console.error("Error reordering storypoints:", err);
    }
  };

  const startEdit = (storypoint) => {
    setEditingId(storypoint.id);
    setEditTitle(storypoint.title || "");
    setEditSummary(storypoint.summary || "");
  };

  if (!isVisible) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="border border-primary/20 bg-black/30 rounded overflow-hidden"
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-primary/10 flex items-center justify-between">
        <div>
          <h3 className="font-mono text-sm text-primary tracking-wider uppercase">
            📖 Story Points ({storypoints.length})
          </h3>
          <p className="text-[8px] text-primary/40 mt-1 tracking-widest">
            Narrative waypoints in your storyline
          </p>
        </div>
        <button
          onClick={handleAddStorypoint}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-primary/10 border border-primary/30 text-primary/70 hover:text-primary hover:bg-primary/20 disabled:opacity-50 font-mono text-[9px] tracking-widest uppercase transition-all"
        >
          <Plus className="w-3 h-3" />
          Add Point
        </button>
      </div>

      {/* Storypoints List */}
      <div className="max-h-96 overflow-y-auto">
        {storypoints.length === 0 ? (
          <div className="p-4 text-center">
            <p className="font-mono text-[9px] text-primary/30 tracking-widest uppercase">
              No story points yet
            </p>
          </div>
        ) : (
          <div className="divide-y divide-primary/10">
            {storypoints.map((point, idx) => (
              <div key={point.id} className="p-3 bg-black/20 hover:bg-black/40 transition-colors">
                {editingId === point.id ? (
                  <div className="space-y-2">
                    <input
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      placeholder="Title"
                      className="w-full bg-black/60 border border-primary/20 text-primary font-mono text-sm px-2 py-1 focus:outline-none focus:border-primary/50"
                    />
                    <textarea
                      value={editSummary}
                      onChange={(e) => setEditSummary(e.target.value)}
                      placeholder="Summary of events..."
                      className="w-full bg-black/60 border border-primary/20 text-primary font-mono text-sm px-2 py-1 focus:outline-none focus:border-primary/50 resize-none h-20"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleUpdateStorypoint(point.id)}
                        className="flex-1 px-2 py-1 bg-green-400/10 border border-green-400/30 text-green-400 hover:bg-green-400/20 font-mono text-[8px] tracking-widest uppercase transition-all"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="flex-1 px-2 py-1 bg-primary/10 border border-primary/20 text-primary/60 hover:text-primary/80 font-mono text-[8px] tracking-widest uppercase transition-all"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <button
                        onClick={() => setExpandedId(expandedId === point.id ? null : point.id)}
                        className="flex-1 flex items-start gap-2 text-left min-w-0"
                      >
                        <ChevronDown
                          className={`w-3.5 h-3.5 text-primary/40 flex-shrink-0 mt-0.5 transition-transform ${
                            expandedId === point.id ? "rotate-180" : ""
                          }`}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="font-mono text-[10px] text-primary/80 tracking-wider uppercase truncate">
                            {idx + 1}. {point.title}
                          </p>
                          {point.summary && (
                            <p className="text-[8px] text-primary/50 line-clamp-1 mt-0.5">
                              {point.summary}
                            </p>
                          )}
                        </div>
                      </button>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={() => startEdit(point)}
                          className="p-1 text-primary/40 hover:text-primary/70 transition-colors"
                        >
                          <Edit2 className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => handleDeleteStorypoint(point.id)}
                          className="p-1 text-primary/40 hover:text-red-400 transition-colors"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>

                    {/* Expanded Details */}
                    <AnimatePresence>
                      {expandedId === point.id && point.summary && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          className="mt-2 pl-5 border-l border-primary/10 space-y-1.5"
                        >
                          <div>
                            <p className="text-[8px] font-mono text-primary/40 tracking-widest uppercase mb-1">
                              Details
                            </p>
                            <p className="text-[9px] font-mono text-primary/70 leading-relaxed">
                              {point.summary}
                            </p>
                          </div>

                          {point.characters_involved?.length > 0 && (
                            <div>
                              <p className="text-[8px] font-mono text-primary/40 tracking-widest uppercase mb-1">
                                Characters
                              </p>
                              <div className="flex flex-wrap gap-1">
                                {point.characters_involved.map((charId) => (
                                  <span
                                    key={charId}
                                    className="px-2 py-0.5 bg-primary/10 border border-primary/20 rounded text-[8px] font-mono text-primary/70"
                                  >
                                    {charId}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}

                          {point.follow_up_suggestions?.length > 0 && (
                            <div>
                              <p className="text-[8px] font-mono text-primary/40 tracking-widest uppercase mb-1">
                                Follow-ups
                              </p>
                              <div className="space-y-1">
                                {point.follow_up_suggestions.map((suggestion, i) => (
                                  <div key={i} className="text-[8px] font-mono text-primary/60">
                                    <span className="text-primary/40">→</span> {suggestion.title}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}