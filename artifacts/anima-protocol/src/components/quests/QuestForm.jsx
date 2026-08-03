import { useState, useEffect } from "react";
import { X, Loader, Plus, Trash2 } from "lucide-react";
import { motion } from "framer-motion";

const DIFFICULTIES = ["trivial", "easy", "moderate", "hard", "legendary"];
const STATUSES = ["available", "active", "completed", "failed", "abandoned"];

export default function QuestForm({
  quest,
  sessionId,
  onSave,
  onCancel,
  loading,
}) {
  const [form, setForm] = useState({
    title: "",
    description: "",
    difficulty: "moderate",
    status: "available",
    objectives: [{ id: "1", description: "", completed: false }],
    rewards: { xp: 0, items: [] },
  });

  const [newItem, setNewItem] = useState("");

  useEffect(() => {
    if (quest) {
      setForm({
        title: quest.title || "",
        description: quest.description || "",
        difficulty: quest.difficulty || "moderate",
        status: quest.status || "available",
        objectives: quest.objectives || [{ id: "1", description: "", completed: false }],
        rewards: quest.rewards || { xp: 0, items: [] },
      });
    }
  }, [quest]);

  const handleAddObjective = () => {
    setForm(f => ({
      ...f,
      objectives: [...f.objectives, { id: String(Date.now()), description: "", completed: false }],
    }));
  };

  const handleRemoveObjective = (id) => {
    setForm(f => ({
      ...f,
      objectives: f.objectives.filter(o => o.id !== id),
    }));
  };

  const handleAddReward = () => {
    if (newItem.trim()) {
      setForm(f => ({
        ...f,
        rewards: { ...f.rewards, items: [...f.rewards.items, newItem] },
      }));
      setNewItem("");
    }
  };

  const handleRemoveReward = (idx) => {
    setForm(f => ({
      ...f,
      rewards: { ...f.rewards, items: f.rewards.items.filter((_, i) => i !== idx) },
    }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    onSave({
      ...form,
      session_id: sessionId,
      objectives: form.objectives.filter(o => o.description.trim()),
    });
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="w-full max-w-2xl bg-background border border-primary/30 rounded hud-corner glow-border max-h-[90vh] overflow-y-auto"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-primary/20 bg-black/60 sticky top-0 z-10">
          <h2 className="font-mono text-primary glow-text tracking-[0.2em] uppercase">
            {quest ? "// Edit Quest" : "// New Quest"}
          </h2>
          <button
            onClick={onCancel}
            disabled={loading}
            className="text-primary/30 hover:text-primary transition-colors disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Title */}
          <div>
            <label className="block text-[9px] font-mono text-primary/40 tracking-[0.25em] uppercase mb-2">
              Quest Title *
            </label>
            <input
              type="text"
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder="e.g., Retrieve the Lost Artifact"
              disabled={loading}
              className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-sm px-3 py-2 focus:outline-none focus:border-primary/50 transition-colors disabled:opacity-50"
              autoFocus
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-[9px] font-mono text-primary/40 tracking-[0.25em] uppercase mb-2">
              Description
            </label>
            <textarea
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Detailed quest narrative..."
              disabled={loading}
              rows={3}
              className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-sm px-3 py-2 focus:outline-none focus:border-primary/50 transition-colors resize-none disabled:opacity-50"
            />
          </div>

          {/* Difficulty and Status */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[9px] font-mono text-primary/40 tracking-[0.25em] uppercase mb-2">
                Difficulty
              </label>
              <select
                value={form.difficulty}
                onChange={e => setForm(f => ({ ...f, difficulty: e.target.value }))}
                disabled={loading}
                className="w-full bg-black/60 border border-primary/20 text-primary/70 font-mono text-sm px-3 py-2 focus:outline-none focus:border-primary/40 transition-colors disabled:opacity-50"
              >
                {DIFFICULTIES.map(d => (
                  <option key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[9px] font-mono text-primary/40 tracking-[0.25em] uppercase mb-2">
                Status
              </label>
              <select
                value={form.status}
                onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                disabled={loading}
                className="w-full bg-black/60 border border-primary/20 text-primary/70 font-mono text-sm px-3 py-2 focus:outline-none focus:border-primary/40 transition-colors disabled:opacity-50"
              >
                {STATUSES.map(s => (
                  <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Objectives */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[9px] font-mono text-primary/40 tracking-[0.25em] uppercase">
                Objectives
              </label>
              <button
                type="button"
                onClick={handleAddObjective}
                className="flex items-center gap-1 text-[9px] font-mono text-primary/50 hover:text-primary transition-colors"
              >
                <Plus className="w-3 h-3" /> Add
              </button>
            </div>
            <div className="space-y-2">
              {form.objectives.map((obj, idx) => (
                <div key={obj.id} className="flex gap-2">
                  <input
                    type="text"
                    value={obj.description}
                    onChange={e => {
                      const updated = form.objectives.map((o, i) =>
                        i === idx ? { ...o, description: e.target.value } : o
                      );
                      setForm(f => ({ ...f, objectives: updated }));
                    }}
                    placeholder="Objective description..."
                    disabled={loading}
                    className="flex-1 bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-sm px-3 py-2 focus:outline-none focus:border-primary/50 transition-colors disabled:opacity-50"
                  />
                  <button
                    type="button"
                    onClick={() => handleRemoveObjective(obj.id)}
                    disabled={loading || form.objectives.length === 1}
                    className="px-2 py-2 border border-red-900/20 text-red-900/40 hover:text-red-400 disabled:opacity-30 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Rewards */}
          <div className="space-y-3">
            <div>
              <label className="block text-[9px] font-mono text-primary/40 tracking-[0.25em] uppercase mb-2">
                XP Reward
              </label>
              <input
                type="number"
                min="0"
                value={form.rewards.xp}
                onChange={e => setForm(f => ({
                  ...f,
                  rewards: { ...f.rewards, xp: parseInt(e.target.value) || 0 },
                }))}
                disabled={loading}
                className="w-full bg-black/60 border border-primary/20 text-primary/80 font-mono text-sm px-3 py-2 focus:outline-none focus:border-primary/50 transition-colors disabled:opacity-50"
              />
            </div>

            <div>
              <label className="block text-[9px] font-mono text-primary/40 tracking-[0.25em] uppercase mb-2">
                Item Rewards
              </label>
              <div className="flex gap-2 mb-2">
                <input
                  type="text"
                  value={newItem}
                  onChange={e => setNewItem(e.target.value)}
                  placeholder="Item name..."
                  disabled={loading}
                  onKeyPress={e => e.key === "Enter" && (e.preventDefault(), handleAddReward())}
                  className="flex-1 bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-sm px-3 py-2 focus:outline-none focus:border-primary/50 transition-colors disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={handleAddReward}
                  disabled={!newItem.trim() || loading}
                  className="px-3 py-2 border border-primary/20 text-primary/40 hover:text-primary hover:border-primary/40 disabled:opacity-30 font-mono text-[9px] transition-colors"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
              {form.rewards.items.length > 0 && (
                <div className="space-y-1">
                  {form.rewards.items.map((item, idx) => (
                    <div key={idx} className="flex items-center justify-between gap-2 p-2 border border-primary/15 bg-black/30 rounded">
                      <span className="text-sm text-primary/70">{item}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveReward(idx)}
                        disabled={loading}
                        className="text-red-900/40 hover:text-red-400 disabled:opacity-30 transition-colors"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-4 border-t border-primary/10">
            <button
              type="button"
              onClick={onCancel}
              disabled={loading}
              className="flex-1 px-4 py-2 border border-primary/20 text-primary/40 hover:text-primary hover:border-primary/40 disabled:opacity-30 font-mono text-xs tracking-widest uppercase transition-all"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!form.title.trim() || loading}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-primary/10 border border-primary/40 text-primary hover:bg-primary/20 disabled:opacity-30 font-mono text-xs tracking-widest uppercase transition-all hud-corner glow-border"
            >
              {loading ? (
                <>
                  <Loader className="w-3 h-3 animate-spin" />
                  Saving
                </>
              ) : (
                quest ? "Update Quest" : "Create Quest"
              )}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}