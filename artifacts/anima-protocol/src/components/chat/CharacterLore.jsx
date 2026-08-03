import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { BookOpen, Plus, X, Trash2 } from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";

const CATEGORIES = ["personal", "secret", "interaction", "relationship", "event", "preference"];

export default function CharacterLore({ characterId, characterName }) {
  const [memories, setMemories] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ fact: "", category: "personal", tags: [] });
  const [search, setSearch] = useState("");
  const [savingForm, setSavingForm] = useState(false);

  useEffect(() => {
    loadMemories();
  }, [characterId]);

  const loadMemories = async () => {
    const data = await base44.entities.CharacterMemory.filter({
      character_id: characterId,
    });
    setMemories(data);
  };

  const handleSave = async () => {
    if (!form.fact.trim()) return;
    setSavingForm(true);
    await base44.entities.CharacterMemory.create({
      character_id: characterId,
      fact: form.fact,
      category: form.category,
      tags: form.tags,
    });
    setForm({ fact: "", category: "personal", tags: [] });
    setShowForm(false);
    await loadMemories();
    setSavingForm(false);
  };

  const deleteMemory = async (id) => {
    await base44.entities.CharacterMemory.delete(id);
    await loadMemories();
  };

  const filtered = memories.filter((m) =>
    m.fact.toLowerCase().includes(search.toLowerCase()) ||
    m.category.toLowerCase().includes(search.toLowerCase())
  );

  const categoryColors = {
    personal: "text-cyan-400 border-cyan-400/30",
    secret: "text-red-400 border-red-400/30",
    interaction: "text-purple-400 border-purple-400/30",
    relationship: "text-pink-400 border-pink-400/30",
    event: "text-yellow-400 border-yellow-400/30",
    preference: "text-green-400 border-green-400/30",
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-primary/60" />
          <h3 className="font-mono text-sm text-primary/80 tracking-wider uppercase">Character Lore</h3>
          <span className="text-[9px] font-mono text-primary/30">({filtered.length})</span>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-1 px-3 py-1.5 text-[9px] font-mono text-primary/60 hover:text-primary border border-primary/20 hover:border-primary/40 transition-all uppercase"
        >
          <Plus className="w-3 h-3" />
          Add Memory
        </button>
      </div>

      {/* Search */}
      {memories.length > 0 && (
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search memories..."
          className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-[10px] px-3 py-1.5 focus:outline-none focus:border-primary/40 transition-colors"
        />
      )}

      {/* Memories List */}
      {filtered.length === 0 ? (
        <p className="text-[9px] font-mono text-primary/20 text-center py-4">No memories recorded</p>
      ) : (
        <div className="space-y-2">
          {filtered.map((mem) => (
            <div
              key={mem.id}
              className="group relative p-3 border border-primary/15 bg-black/40 text-left transition-all hover:border-primary/30 hover:bg-primary/5"
            >
              <div className="flex items-start gap-3">
                <span className={`text-[9px] font-mono tracking-widest uppercase flex-shrink-0 border px-2 py-0.5 ${categoryColors[mem.category]}`}>
                  {mem.category.slice(0, 3)}
                </span>
                <p className="text-[10px] font-mono text-primary/70 flex-1 leading-relaxed">{mem.fact}</p>
                <button
                  onClick={() => deleteMemory(mem.id)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 text-primary/30 hover:text-red-400"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Memory Form */}
      {showForm && (
        <div className="border border-primary/20 bg-black/60 p-4 space-y-3">
          <div>
            <label className="block text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-1.5">
              Memory Type
            </label>
            <Select value={form.category} onValueChange={(v) => setForm((f) => ({ ...f, category: v }))}>
              <SelectTrigger className="w-full bg-black/60 border-primary/20 text-primary/80 font-mono text-[10px] min-h-[36px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-background border-primary/30">
                {CATEGORIES.map((cat) => (
                  <SelectItem key={cat} value={cat} className="font-mono text-primary/80 capitalize">
                    {cat}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="block text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-1.5">
              Memory *
            </label>
            <textarea
              value={form.fact}
              onChange={(e) => setForm((f) => ({ ...f, fact: e.target.value }))}
              placeholder={`Record a memory about ${characterName}...`}
              rows={2}
              className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/15 font-mono text-[10px] px-3 py-2 focus:outline-none focus:border-primary/40 transition-colors resize-none"
            />
          </div>

          <div className="flex gap-2 justify-end">
            <button
              onClick={() => setShowForm(false)}
              className="px-3 py-1.5 border border-primary/20 text-primary/40 hover:text-primary hover:border-primary/40 font-mono text-[9px] tracking-widest uppercase transition-all"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!form.fact.trim() || savingForm}
              className="px-3 py-1.5 bg-primary/10 border border-primary/40 text-primary hover:bg-primary/20 disabled:opacity-30 disabled:cursor-not-allowed font-mono text-[9px] tracking-widest uppercase transition-all"
            >
              {savingForm ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}