import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { ArrowLeft, BookOpen, Plus, Trash2, Edit2, X, Check, Filter } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";

const CATEGORIES = ["character_fact", "item", "location", "event", "relationship", "secret", "rule"];
const IMPORTANCE = ["low", "medium", "high", "critical"];

const categoryMeta = {
  character_fact: { label: "Character", color: "text-cyan-400 border-cyan-400/30", bg: "bg-cyan-400/5" },
  item:           { label: "Item",      color: "text-yellow-400 border-yellow-400/30", bg: "bg-yellow-400/5" },
  location:       { label: "Location",  color: "text-green-400 border-green-400/30", bg: "bg-green-400/5" },
  event:          { label: "Event",     color: "text-purple-400 border-purple-400/30", bg: "bg-purple-400/5" },
  relationship:   { label: "Bond",      color: "text-rose-400 border-rose-400/30", bg: "bg-rose-400/5" },
  secret:         { label: "Secret",    color: "text-red-400 border-red-400/30", bg: "bg-red-400/5" },
  rule:           { label: "Rule",      color: "text-blue-400 border-blue-400/30", bg: "bg-blue-400/5" },
};

const importanceColors = {
  low:      "text-primary/30",
  medium:   "text-primary/60",
  high:     "text-yellow-400",
  critical: "text-red-400",
};

const defaultForm = { category: "event", subject: "", fact: "", importance: "medium" };

export default function LoreBook() {
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get("session");

  const [entries, setEntries] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [selectedSession, setSelectedSession] = useState(sessionId || "");
  const [filterCategory, setFilterCategory] = useState("all");
  const [showForm, setShowForm] = useState(false);
  const [editingEntry, setEditingEntry] = useState(null);
  const [form, setForm] = useState(defaultForm);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    base44.entities.ChatSession.list("-updated_date", 100).then(setSessions);
  }, []);

  useEffect(() => {
    if (selectedSession) loadEntries();
    else setEntries([]);
  }, [selectedSession, filterCategory]);

  const loadEntries = async () => {
    const query = { session_id: selectedSession, is_active: true };
    const data = await base44.entities.WorldState.filter(query, "-created_date", 200);
    setEntries(data || []);
  };

  const filtered = filterCategory === "all"
    ? entries
    : entries.filter(e => e.category === filterCategory);

  const handleEdit = (entry) => {
    setEditingEntry(entry);
    setForm({ category: entry.category, subject: entry.subject, fact: entry.fact, importance: entry.importance });
    setShowForm(true);
  };

  const handleDelete = async (id) => {
    await base44.entities.WorldState.update(id, { is_active: false });
    setEntries(prev => prev.filter(e => e.id !== id));
  };

  const handleSave = async () => {
    if (!form.fact.trim() || !selectedSession) return;
    setSaving(true);
    if (editingEntry) {
      await base44.entities.WorldState.update(editingEntry.id, form);
    } else {
      await base44.entities.WorldState.create({ ...form, session_id: selectedSession, is_active: true });
    }
    await loadEntries();
    setShowForm(false);
    setEditingEntry(null);
    setForm(defaultForm);
    setSaving(false);
  };

  const closeForm = () => { setShowForm(false); setEditingEntry(null); setForm(defaultForm); };

  const grouped = CATEGORIES.reduce((acc, cat) => {
    const items = filtered.filter(e => e.category === cat);
    if (items.length) acc[cat] = items;
    return acc;
  }, {});

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-background scanline">
      {/* Header */}
      <div className="border-b border-primary/20 bg-black/60 backdrop-blur-md px-3 sm:px-6 py-3 sm:py-4">
        <div className="w-full flex items-center justify-between gap-3 sm:gap-4">
          <div className="flex items-center gap-2 sm:gap-4 flex-1 min-w-0">
            <Link to="/" className="text-primary/40 hover:text-primary transition-colors p-1">
              <ArrowLeft className="w-4 sm:w-5 h-4 sm:h-5" />
            </Link>
            <div className="min-w-0">
              <h1 className="font-mono text-primary glow-text tracking-[0.2em] uppercase text-sm sm:text-lg flex items-center gap-2">
                <BookOpen className="w-4 sm:w-5 h-4 sm:h-5 flex-shrink-0" />
                <span className="truncate">// Lore Book</span>
              </h1>
              <p className="text-[8px] sm:text-[10px] font-mono text-primary/30 tracking-widest uppercase mt-0.5">
                {entries.length} entries
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowForm(true)}
            disabled={!selectedSession}
            className="flex items-center gap-1.5 px-3 sm:px-5 py-1.5 sm:py-2 bg-primary/10 border border-primary/40 text-primary hover:bg-primary/20 disabled:opacity-30 disabled:cursor-not-allowed transition-all font-mono text-[9px] sm:text-xs tracking-widest uppercase hud-corner glow-border flex-shrink-0"
          >
            <Plus className="w-3 sm:w-4 h-3 sm:h-4" />
            <span className="hidden sm:inline">Add</span>
          </button>
        </div>
      </div>

      <div className="w-full p-3 sm:p-6 pb-24 sm:pb-6 space-y-6">
        {/* Session + Filter controls */}
        <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 items-start sm:items-center">
          <select
            value={selectedSession}
            onChange={e => setSelectedSession(e.target.value)}
            className="w-full sm:w-auto bg-black/60 border border-primary/20 text-primary/70 font-mono text-xs px-3 py-2 focus:outline-none focus:border-primary/50"
          >
            <option value="">— Select session —</option>
            {sessions.map(s => (
              <option key={s.id} value={s.id}>{s.title || "Untitled"}</option>
            ))}
          </select>

          <div className="flex gap-1.5 flex-wrap">
            <button
              onClick={() => setFilterCategory("all")}
              className={`px-2 sm:px-3 py-1 sm:py-1.5 border font-mono text-[8px] sm:text-[9px] tracking-widest uppercase transition-all ${filterCategory === "all" ? "border-primary/60 bg-primary/10 text-primary" : "border-primary/15 text-primary/30 hover:border-primary/40"}`}
            >
              All
            </button>
            {CATEGORIES.map(cat => {
              const meta = categoryMeta[cat];
              return (
                <button
                   key={cat}
                   onClick={() => setFilterCategory(cat)}
                   className={`px-2 sm:px-3 py-1 sm:py-1.5 border font-mono text-[8px] sm:text-[9px] tracking-widest uppercase transition-all ${filterCategory === cat ? `${meta.color} ${meta.bg}` : "border-primary/15 text-primary/30 hover:border-primary/40"}`}
                 >
                   {meta.label}
                 </button>
              );
            })}
          </div>
        </div>

        {/* Empty state */}
        {!selectedSession && (
          <div className="text-center py-24">
            <BookOpen className="w-12 h-12 text-primary/10 mx-auto mb-4" />
            <p className="font-mono text-primary/20 text-sm tracking-[0.3em] uppercase">Select a session to view its lore</p>
          </div>
        )}

        {selectedSession && entries.length === 0 && (
          <div className="text-center py-24">
            <BookOpen className="w-12 h-12 text-primary/10 mx-auto mb-4" />
            <p className="font-mono text-primary/20 text-sm tracking-[0.3em] uppercase mb-2">No lore entries yet</p>
            <p className="font-mono text-primary/20 text-xs max-w-xs mx-auto leading-relaxed">
              Lore is automatically extracted as you chat. You can also add entries manually.
            </p>
          </div>
        )}

        {/* Grouped entries */}
        {Object.entries(grouped).map(([cat, items]) => {
          const meta = categoryMeta[cat] || { label: cat, color: "text-primary/60 border-primary/20", bg: "" };
          return (
            <div key={cat}>
              <p className={`text-[9px] font-mono tracking-[0.3em] uppercase mb-3 ${meta.color.split(" ")[0]}`}>
                // {meta.label} ({items.length})
              </p>
              <div className="grid gap-2">
                {items.map(entry => (
                  <div
                    key={entry.id}
                    className={`group flex items-start gap-3 p-3 border ${meta.color.split(" ")[1]} ${meta.bg} hover:border-opacity-60 transition-all`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="font-mono text-[10px] text-primary/80 tracking-wider uppercase">{entry.subject}</span>
                        <span className={`text-[8px] font-mono tracking-widest uppercase ${importanceColors[entry.importance]}`}>
                          ● {entry.importance}
                        </span>
                      </div>
                      <p className="font-mono text-xs text-primary/50 leading-relaxed">{entry.fact}</p>
                    </div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                      <button onClick={() => handleEdit(entry)} className="w-6 h-6 border border-primary/20 text-primary/30 hover:text-primary flex items-center justify-center transition-colors">
                        <Edit2 className="w-3 h-3" />
                      </button>
                      <button onClick={() => handleDelete(entry.id)} className="w-6 h-6 border border-red-900/20 text-red-900 hover:text-red-400 flex items-center justify-center transition-colors">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg bg-background border border-primary/30 hud-corner glow-border">
            <div className="flex items-center justify-between p-5 border-b border-primary/20">
              <h2 className="font-mono text-primary tracking-[0.2em] uppercase text-sm">
                {editingEntry ? "// Edit Lore Entry" : "// Add Lore Entry"}
              </h2>
              <button onClick={closeForm} className="text-primary/30 hover:text-primary transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-1.5">Category</label>
                  <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                    className="w-full bg-black/60 border border-primary/20 text-primary/70 font-mono text-xs px-3 py-2 focus:outline-none focus:border-primary/50">
                    {CATEGORIES.map(c => <option key={c} value={c}>{categoryMeta[c]?.label || c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-1.5">Importance</label>
                  <select value={form.importance} onChange={e => setForm(f => ({ ...f, importance: e.target.value }))}
                    className="w-full bg-black/60 border border-primary/20 text-primary/70 font-mono text-xs px-3 py-2 focus:outline-none focus:border-primary/50">
                    {IMPORTANCE.map(i => <option key={i} value={i}>{i}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-1.5">Subject</label>
                <input value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
                  placeholder="e.g. Aragorn, The One Ring, Rivendell..."
                  className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/15 font-mono text-sm px-3 py-2 focus:outline-none focus:border-primary/50 transition-colors" />
              </div>
              <div>
                <label className="block text-[9px] font-mono text-primary/40 tracking-widests uppercase mb-1.5">Fact</label>
                <textarea value={form.fact} onChange={e => setForm(f => ({ ...f, fact: e.target.value }))}
                  placeholder="A concise statement of the lore..."
                  rows={3}
                  className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/15 font-mono text-sm px-3 py-2 focus:outline-none focus:border-primary/50 transition-colors resize-none" />
              </div>
            </div>
            <div className="p-5 border-t border-primary/20 flex justify-end gap-3">
              <button onClick={closeForm} className="px-5 py-2 border border-primary/20 text-primary/40 hover:text-primary font-mono text-xs tracking-widest uppercase transition-all">Cancel</button>
              <button onClick={handleSave} disabled={!form.fact.trim() || saving}
                className="px-5 py-2 bg-primary/10 border border-primary/50 text-primary hover:bg-primary/20 disabled:opacity-30 font-mono text-xs tracking-widests uppercase transition-all hud-corner glow-border">
                {saving ? "Saving..." : editingEntry ? "Update" : "Add Entry"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}