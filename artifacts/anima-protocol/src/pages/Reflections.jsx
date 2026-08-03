import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { ArrowLeft, Search, Trash2, Edit2, X, Plus, Check } from "lucide-react";

const TAG_COLORS = {
  breakthrough: "border-green-400/40 bg-green-400/10 text-green-400",
  "shadow-work": "border-purple-400/40 bg-purple-400/10 text-purple-400",
  insight: "border-cyan-400/40 bg-cyan-400/10 text-cyan-400",
  growth: "border-lime-400/40 bg-lime-400/10 text-lime-400",
  challenge: "border-orange-400/40 bg-orange-400/10 text-orange-400",
  healing: "border-pink-400/40 bg-pink-400/10 text-pink-400"
};

export default function Reflections() {
  const [reflections, setReflections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedTag, setSelectedTag] = useState("all");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({
    title: "",
    content: "",
    mood: "calm",
    emotional_intensity: 5,
    tags: []
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadReflections();
  }, []);

  const loadReflections = async () => {
    setLoading(true);
    const data = await base44.entities.Reflection.list("-created_date", 100);
    setReflections(data || []);
    setLoading(false);
  };

  const handleEdit = (reflection) => {
    setEditingId(reflection.id);
    setForm({
      title: reflection.title,
      content: reflection.content,
      mood: reflection.mood || "calm",
      emotional_intensity: reflection.emotional_intensity || 5,
      tags: reflection.tags || []
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.title.trim() || !form.content.trim()) return;
    setSaving(true);
    try {
      if (editingId) {
        await base44.entities.Reflection.update(editingId, form);
      } else {
        await base44.entities.Reflection.create(form);
      }
      await loadReflections();
      setShowForm(false);
      setEditingId(null);
      setForm({ title: "", content: "", mood: "calm", emotional_intensity: 5, tags: [] });
    } catch (err) {
      console.error("Error saving reflection:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    await base44.entities.Reflection.delete(id);
    await loadReflections();
  };

  const toggleTag = (tag) => {
    setForm(f => ({
      ...f,
      tags: f.tags.includes(tag) ? f.tags.filter(t => t !== tag) : [...f.tags, tag]
    }));
  };

  const filtered = reflections.filter(r => {
    const searchMatch = !search.trim() || r.title.toLowerCase().includes(search.toLowerCase()) || r.content.toLowerCase().includes(search.toLowerCase());
    const tagMatch = selectedTag === "all" || (r.tags && r.tags.includes(selectedTag));
    return searchMatch && tagMatch;
  });

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-background scanline">
      {/* Header */}
      <div className="border-b border-primary/20 bg-black/60 backdrop-blur-md px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Link to="/" className="text-primary/40 hover:text-primary transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="font-mono text-primary glow-text tracking-[0.2em] uppercase text-lg">
                // Reflections Journal
              </h1>
              <p className="text-[10px] font-mono text-primary/30 tracking-widest uppercase mt-0.5">
                {filtered.length} entries
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 px-5 py-2 bg-primary/10 border border-primary/40 text-primary hover:bg-primary/20 transition-all font-mono text-xs tracking-widest uppercase hud-corner glow-border"
          >
            <Plus className="w-4 h-4" />
            New Reflection
          </button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto p-6 pb-24 lg:pb-6 space-y-6">
        {/* Search and Filter */}
        <div className="flex flex-col gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary/30" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search reflections..."
              className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-sm pl-10 pr-4 py-2.5 focus:outline-none focus:border-primary/50 transition-colors"
            />
          </div>

          {/* Tag Filter */}
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => setSelectedTag("all")}
              className={`px-3 py-1.5 border font-mono text-xs tracking-widest uppercase transition-all ${
                selectedTag === "all"
                  ? "border-primary/60 bg-primary/10 text-primary"
                  : "border-primary/15 text-primary/40 hover:border-primary/40"
              }`}
            >
              All
            </button>
            {Object.keys(TAG_COLORS).map(tag => (
              <button
                key={tag}
                onClick={() => setSelectedTag(tag)}
                className={`px-3 py-1.5 border font-mono text-xs tracking-widest uppercase transition-all ${
                  selectedTag === tag ? TAG_COLORS[tag] : "border-primary/15 text-primary/40 hover:border-primary/40"
                }`}
              >
                {tag}
              </button>
            ))}
          </div>
        </div>

        {/* Reflections List */}
        {loading ? (
          <div className="text-center py-12 font-mono text-primary/30 text-sm animate-pulse">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12">
            <p className="font-mono text-primary/20 text-sm tracking-[0.3em] uppercase">
              {reflections.length === 0 ? "No reflections yet" : "No matching reflections"}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(reflection => (
              <div
                key={reflection.id}
                className="border border-primary/15 bg-black/40 hover:bg-primary/5 hover:border-primary/30 p-4 hud-corner transition-all group"
              >
                <div className="flex items-start justify-between gap-4 mb-2">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-mono text-sm text-primary tracking-wider uppercase">{reflection.title}</h3>
                    <p className="text-[9px] font-mono text-primary/40 tracking-widest mt-1">
                      {new Date(reflection.created_date).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric"
                      })}
                    </p>
                  </div>
                  <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                    <button
                      onClick={() => handleEdit(reflection)}
                      className="w-7 h-7 border border-primary/20 text-primary/30 hover:text-primary flex items-center justify-center transition-colors"
                    >
                      <Edit2 className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => handleDelete(reflection.id)}
                      className="w-7 h-7 border border-red-900/20 text-red-900 hover:text-red-400 flex items-center justify-center transition-colors"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>

                {/* Content Preview */}
                <p className="text-[10px] font-mono text-primary/70 line-clamp-3 mb-2">{reflection.content}</p>

                {/* Tags */}
                {reflection.tags && reflection.tags.length > 0 && (
                  <div className="flex gap-1.5 flex-wrap">
                    {reflection.tags.map(tag => (
                      <span
                        key={tag}
                        className={`px-2 py-0.5 border text-[9px] font-mono tracking-[0.1em] uppercase ${TAG_COLORS[tag] || "border-primary/15 text-primary/40"}`}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}

                {/* Mood & Intensity */}
                <div className="flex items-center gap-3 mt-3 text-[9px] font-mono text-primary/40">
                  {reflection.mood && <span>Mood: {reflection.mood}</span>}
                  {reflection.emotional_intensity && <span>Intensity: {reflection.emotional_intensity}/10</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl bg-background border border-primary/30 hud-corner glow-border max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-primary/20 sticky top-0 bg-background">
              <h2 className="font-mono text-primary tracking-[0.2em] uppercase">
                {editingId ? "// Edit Reflection" : "// New Reflection"}
              </h2>
              <button onClick={() => { setShowForm(false); setEditingId(null); }} className="text-primary/30 hover:text-primary">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div>
                <label className="block text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-2">Title *</label>
                <input
                  value={form.title}
                  onChange={(e) => setForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="Reflection title..."
                  className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/15 font-mono text-sm px-3 py-2 focus:outline-none focus:border-primary/50"
                />
              </div>

              <div>
                <label className="block text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-2">Reflection *</label>
                <textarea
                  value={form.content}
                  onChange={(e) => setForm(f => ({ ...f, content: e.target.value }))}
                  placeholder="Write your reflection..."
                  rows={6}
                  className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/15 font-mono text-sm px-3 py-2 focus:outline-none focus:border-primary/50 resize-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-2">Mood</label>
                  <select
                    value={form.mood}
                    onChange={(e) => setForm(f => ({ ...f, mood: e.target.value }))}
                    className="w-full bg-black/60 border border-primary/20 text-primary/70 font-mono text-sm px-3 py-2"
                  >
                    <option>joyful</option>
                    <option>calm</option>
                    <option>sad</option>
                    <option>anxious</option>
                    <option>peaceful</option>
                    <option>hopeful</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-2">
                    Intensity: {form.emotional_intensity}
                  </label>
                  <input
                    type="range"
                    min="1"
                    max="10"
                    value={form.emotional_intensity}
                    onChange={(e) => setForm(f => ({ ...f, emotional_intensity: parseInt(e.target.value) }))}
                    className="w-full accent-primary"
                  />
                </div>
              </div>

              {/* Tags */}
              <div>
                <label className="block text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-2">Tags</label>
                <div className="flex gap-2 flex-wrap">
                  {Object.keys(TAG_COLORS).map(tag => (
                    <button
                      key={tag}
                      onClick={() => toggleTag(tag)}
                      className={`px-3 py-1.5 border font-mono text-xs tracking-widest uppercase transition-all ${
                        form.tags.includes(tag)
                          ? TAG_COLORS[tag]
                          : "border-primary/15 text-primary/40 hover:border-primary/40"
                      }`}
                    >
                      {form.tags.includes(tag) && <Check className="w-3 h-3 inline mr-1" />}
                      {tag}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="p-5 border-t border-primary/20 flex justify-end gap-3 sticky bottom-0 bg-background">
              <button
                onClick={() => { setShowForm(false); setEditingId(null); }}
                className="px-5 py-2 border border-primary/20 text-primary/40 hover:text-primary font-mono text-xs tracking-widest uppercase"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={!form.title.trim() || !form.content.trim() || saving}
                className="px-5 py-2 bg-primary/10 border border-primary/50 text-primary hover:bg-primary/20 disabled:opacity-30 font-mono text-xs tracking-widest uppercase hud-corner glow-border"
              >
                {saving ? "Saving..." : editingId ? "Update" : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}