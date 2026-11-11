import { useEffect, useRef, useState } from "react";
import { animaClient } from "@/api/animaClient";
import { Loader, Plus, X, Edit2, Trash2, Brain, Zap } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const MEMORY_TAGS = [
  "relationship",
  "betrayal",
  "achievement",
  "trauma",
  "secret",
  "alliance",
  "conflict",
  "personal",
  "world-event",
  "evolution",
];

import { useConfirm } from "@/lib/ConfirmDialog";

export default function CharacterMemoryManager({ characterId, characterName }) {
  const confirm = useConfirm();
  const requestVersion = useRef(0);
  // Tracks which companion this panel currently shows, so late responses
  // from a previous companion (loads or post-mutation refreshes) are dropped.
  const activeCharacterId = useRef(characterId);
  const [memories, setMemories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState("");
  const [editTags, setEditTags] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [newMemory, setNewMemory] = useState("");
  const [newTags, setNewTags] = useState([]);
  const [summarizing, setSummarizing] = useState(false);
  const [summary, setSummary] = useState(null);
  const [filterTag, setFilterTag] = useState("all");
  const [error, setError] = useState("");

  useEffect(() => {
    // Invalidate requests from the previous companion when switching profiles.
    activeCharacterId.current = characterId;
    if (characterId) {
      void loadMemories(characterId, { reset: true });
    } else {
      requestVersion.current += 1;
      setMemories([]);
      setLoading(false);
    }
    return () => {
      requestVersion.current += 1;
    };
  }, [characterId]);

  const loadMemories = async (targetId = characterId, { reset = false } = {}) => {
    // A refresh started by a mutation on a companion we've since left must not
    // claim the latest version and paint that companion's memories here.
    if (!targetId || targetId !== activeCharacterId.current) return;
    const version = ++requestVersion.current;
    setLoading(true);
    setError("");
    // Only blank the list when switching companions, not on refresh after edits.
    if (reset) setMemories([]);
    try {
      const data = await animaClient.entities.CharacterMemory.filter(
        { character_id: targetId },
        "-created_date",
        100
      );
      if (version === requestVersion.current) setMemories(data || []);
    } catch (err) {
      if (version === requestVersion.current) {
        console.error("Error loading memories:", err);
        setError("Could not load memories. Please retry.");
      }
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  };

  const handleAddMemory = async () => {
    if (!characterId || !newMemory.trim()) return;
    const targetId = characterId;
    setError("");
    try {
      await animaClient.entities.CharacterMemory.create({
        character_id: targetId,
        fact: newMemory.trim(),
        category: newTags.length > 0 ? newTags[0] : "personal",
        tags: newTags,
      });
      setNewMemory("");
      setNewTags([]);
      setShowAdd(false);
      await loadMemories(targetId);
    } catch (err) {
      console.error("Error adding memory:", err);
      setError("Memory could not be saved. Please retry.");
    }
  };

  const handleEditMemory = async (id) => {
    if (!editText.trim()) return;
    const targetId = characterId;
    setError("");
    try {
      await animaClient.entities.CharacterMemory.update(id, {
        fact: editText.trim(),
        tags: editTags,
      });
      setEditingId(null);
      await loadMemories(targetId);
    } catch (err) {
      console.error("Error editing memory:", err);
      setError("Memory could not be updated. Please retry.");
    }
  };

  const handleDeleteMemory = async (id) => {
    const ok = await confirm({
      title: "Delete this memory?",
      message: "This permanently removes the memory and cannot be undone.",
      confirmLabel: "Delete",
    });
    if (!ok) return;
    const targetId = characterId;
    setError("");
    try {
      await animaClient.entities.CharacterMemory.delete(id);
      await loadMemories(targetId);
    } catch (err) {
      console.error("Error deleting memory:", err);
      setError("Memory could not be deleted. Please retry.");
    }
  };

  const startEdit = (memory) => {
    setEditingId(memory.id);
    setEditText(memory.fact);
    setEditTags(memory.tags || []);
  };

  const handleSummarizeRelationships = async () => {
    setSummarizing(true);
    try {
      const memoryTexts = memories.map((m) => m.fact).join("\n- ");
      const prompt = `Based on these character memories, summarize ${characterName}'s current relationship status and emotional state:

Character Memories:
- ${memoryTexts || "(No memories yet)"}

Provide a concise, narrative summary (2-3 sentences) that captures:
1. Overall relationship health and trust levels
2. Major unresolved conflicts or bonds
3. Character's emotional trajectory
Keep it vivid and story-focused.`;

      const result = await animaClient.integrations.Core.InvokeLLM({
        prompt,
      });

      const summaryText = typeof result === "string"
        ? result
        : result?.response || result?.text || result?.content || "";
      setSummary(typeof summaryText === "string" ? summaryText : "");
    } catch (err) {
      console.error("Error summarizing relationships:", err);
      setError("Relationship summary is unavailable. Please retry.");
    } finally {
      setSummarizing(false);
    }
  };

  const filteredMemories =
    filterTag === "all"
      ? memories
      : memories.filter((m) => (m.tags || []).includes(filterTag));

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center space-y-2">
          <Loader className="w-5 h-5 text-primary/60 animate-spin mx-auto" />
          <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase">
            Loading memories...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div role="alert" className="rounded border border-red-500/40 bg-red-950/20 p-3 text-xs text-red-300">
          {error}
          <button type="button" onClick={() => setError("")} className="ml-3 underline">Dismiss</button>
        </div>
      )}
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-mono text-sm text-primary tracking-widest uppercase">
            {characterName}'s Memories
          </h3>
          <p className="text-[9px] font-mono text-primary/40 mt-1">
            {filteredMemories.length} {filteredMemories.length === 1 ? "memory" : "memories"} • Manage what{" "}
            {characterName} remembers
          </p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 transition-all font-mono text-[9px] tracking-widest uppercase"
        >
          <Plus className="w-3 h-3" />
          Add
        </button>
      </div>

      {/* Filter Tags */}
      <div className="flex flex-wrap gap-1.5">
        <button
          onClick={() => setFilterTag("all")}
          className={`px-2 py-1 border rounded font-mono text-[8px] tracking-widest uppercase transition-all ${
            filterTag === "all"
              ? "border-primary/60 bg-primary/10 text-primary"
              : "border-primary/15 bg-black/30 text-primary/50 hover:text-primary/70"
          }`}
        >
          All
        </button>
        {MEMORY_TAGS.map((tag) => (
          <button
            key={tag}
            onClick={() => setFilterTag(tag)}
            className={`px-2 py-1 border rounded font-mono text-[8px] tracking-widest uppercase transition-all ${
              filterTag === tag
                ? "border-primary/60 bg-primary/10 text-primary"
                : "border-primary/15 bg-black/30 text-primary/50 hover:text-primary/70"
            }`}
          >
            {tag}
          </button>
        ))}
      </div>

      {/* Memories List */}
      <div className="space-y-2 max-h-96 overflow-y-auto">
        {filteredMemories.length === 0 ? (
          <div className="p-4 text-center border border-primary/10 bg-black/30 rounded text-[9px] font-mono text-primary/40">
            {memories.length === 0
              ? "No memories yet. Add one to get started."
              : "No memories with this tag."}
          </div>
        ) : (
          filteredMemories.map((memory) => (
            <motion.div
              key={memory.id}
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`p-3 border rounded transition-all ${
                editingId === memory.id
                  ? "border-primary/40 bg-primary/10"
                  : "border-primary/15 bg-black/30 hover:border-primary/25"
              }`}
            >
              {editingId === memory.id ? (
                // Edit Mode
                <div className="space-y-2">
                  <textarea
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    className="w-full bg-black/60 border border-primary/20 text-primary/80 font-mono text-[9px] px-2 py-1.5 focus:outline-none focus:border-primary/40 transition-colors resize-none"
                    rows={3}
                  />
                  <div className="flex flex-wrap gap-1">
                    {MEMORY_TAGS.map((tag) => (
                      <button
                        key={tag}
                        onClick={() => {
                          setEditTags((prev) =>
                            prev.includes(tag)
                              ? prev.filter((t) => t !== tag)
                              : [...prev, tag]
                          );
                        }}
                        className={`px-2 py-0.5 border rounded font-mono text-[7px] tracking-widest uppercase transition-all ${
                          editTags.includes(tag)
                            ? "border-primary/60 bg-primary/20 text-primary"
                            : "border-primary/20 bg-black/40 text-primary/50"
                        }`}
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setEditingId(null)}
                      className="flex-1 px-2 py-1 border border-primary/15 text-primary/40 hover:text-primary/60 font-mono text-[8px] tracking-widest uppercase transition-all"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => handleEditMemory(memory.id)}
                      className="flex-1 px-2 py-1 border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 font-mono text-[8px] tracking-widest uppercase transition-all"
                    >
                      Save
                    </button>
                  </div>
                </div>
              ) : (
                // View Mode
                <>
                  <p className="text-[9px] font-mono text-primary/80 leading-relaxed mb-2">
                    {memory.fact}
                  </p>
                  {memory.tags && memory.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-2">
                      {memory.tags.map((tag) => (
                        <span
                          key={tag}
                          className="px-1.5 py-0.5 bg-primary/5 border border-primary/15 rounded text-[7px] font-mono text-primary/60 tracking-widest uppercase"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => startEdit(memory)}
                      className="flex-1 flex items-center justify-center gap-1 py-1 border border-primary/20 text-primary/40 hover:text-primary/70 font-mono text-[8px] tracking-widest uppercase transition-all"
                    >
                      <Edit2 className="w-2.5 h-2.5" />
                      Edit
                    </button>
                    <button
                      onClick={() => handleDeleteMemory(memory.id)}
                      className="flex-1 flex items-center justify-center gap-1 py-1 border border-red-900/20 text-red-900/40 hover:text-red-400 font-mono text-[8px] tracking-widest uppercase transition-all"
                    >
                      <Trash2 className="w-2.5 h-2.5" />
                      Delete
                    </button>
                  </div>
                </>
              )}
            </motion.div>
          ))
        )}
      </div>

      {/* Summarize Button */}
      <button
        onClick={handleSummarizeRelationships}
        disabled={memories.length === 0 || summarizing}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-purple-900/30 border border-purple-400/40 text-purple-400 hover:bg-purple-900/50 disabled:opacity-30 transition-all font-mono text-[9px] tracking-widest uppercase"
      >
        <Brain className="w-3.5 h-3.5" />
        {summarizing ? "Analyzing..." : "Summarize Relationships"}
      </button>

      {/* Summary Display */}
      <AnimatePresence>
        {summary && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="p-3 border border-purple-400/30 bg-purple-400/5 rounded space-y-2"
          >
            <p className="font-mono text-[8px] text-purple-400/60 tracking-widest uppercase flex items-center gap-1.5">
              <Zap className="w-3 h-3" />
              AI Relationship Summary
            </p>
            <p className="text-[9px] font-mono text-purple-400/90 leading-relaxed">
              {summary}
            </p>
            <button
              onClick={() => setSummary(null)}
              className="px-2 py-1 text-[8px] font-mono text-purple-400/50 hover:text-purple-400 transition-colors"
            >
              Dismiss
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Add Memory Modal */}
      <AnimatePresence>
        {showAdd && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="p-3 border border-primary/20 bg-primary/10 rounded space-y-2"
          >
            <textarea
              value={newMemory}
              onChange={(e) => setNewMemory(e.target.value)}
              placeholder="What should this character remember?"
              className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-[9px] px-2 py-1.5 focus:outline-none focus:border-primary/40 transition-colors resize-none"
              rows={3}
            />
            <div className="flex flex-wrap gap-1">
              {MEMORY_TAGS.map((tag) => (
                <button
                  key={tag}
                  onClick={() => {
                    setNewTags((prev) =>
                      prev.includes(tag)
                        ? prev.filter((t) => t !== tag)
                        : [...prev, tag]
                    );
                  }}
                  className={`px-2 py-0.5 border rounded font-mono text-[7px] tracking-widest uppercase transition-all ${
                    newTags.includes(tag)
                      ? "border-primary/60 bg-primary/20 text-primary"
                      : "border-primary/20 bg-black/40 text-primary/50"
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setShowAdd(false);
                  setNewMemory("");
                  setNewTags([]);
                }}
                className="flex-1 px-2 py-1.5 border border-primary/15 text-primary/40 hover:text-primary/60 font-mono text-[8px] tracking-widest uppercase transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleAddMemory}
                disabled={!newMemory.trim()}
                className="flex-1 px-2 py-1.5 border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-30 font-mono text-[8px] tracking-widest uppercase transition-all"
              >
                Save Memory
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}