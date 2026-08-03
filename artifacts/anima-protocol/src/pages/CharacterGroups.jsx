import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Plus, X, Edit2, Trash2, ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const defaultForm = {
  name: "",
  description: "",
  character_ids: [],
};

export default function CharacterGroups() {
  const [groups, setGroups] = useState([]);
  const [characters, setCharacters] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editingGroup, setEditingGroup] = useState(null);
  const [form, setForm] = useState(defaultForm);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    loadGroups();
    loadCharacters();
  }, []);

  const loadGroups = async () => {
    const data = await base44.entities.CharacterGroup.list("-created_date", 100);
    setGroups(data);
  };

  const loadCharacters = async () => {
    const data = await base44.entities.Character.list("-created_date", 100);
    setCharacters(data);
  };

  const handleEdit = (group) => {
    setEditingGroup(group);
    setForm({
      name: group.name || "",
      description: group.description || "",
      character_ids: group.character_ids || [],
    });
    setShowForm(true);
  };

  const handleDelete = async (id) => {
    await base44.entities.CharacterGroup.delete(id);
    await loadGroups();
  };

  const handleSave = async () => {
    if (!form.name.trim() || form.character_ids.length === 0) return;
    setSaving(true);
    if (editingGroup) {
      await base44.entities.CharacterGroup.update(editingGroup.id, form);
    } else {
      await base44.entities.CharacterGroup.create(form);
    }
    await loadGroups();
    setShowForm(false);
    setEditingGroup(null);
    setForm(defaultForm);
    setSaving(false);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingGroup(null);
    setForm(defaultForm);
  };

  const toggleCharacter = (charId) => {
    setForm((f) => ({
      ...f,
      character_ids: f.character_ids.includes(charId)
        ? f.character_ids.filter((id) => id !== charId)
        : [...f.character_ids, charId],
    }));
  };

  const filteredCharacters = characters.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );

  const getGroupCharacters = (groupId) => {
    const group = groups.find((g) => g.id === groupId);
    return characters.filter((c) => group?.character_ids?.includes(c.id)) || [];
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-background scanline">
      {/* Header */}
      <div className="border-b border-primary/20 bg-black/60 backdrop-blur-md px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Link to="/characters" className="text-primary/40 hover:text-primary transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="font-mono text-primary glow-text tracking-[0.2em] uppercase text-lg">
                // Character Groups
              </h1>
              <p className="text-[10px] font-mono text-primary/30 tracking-widest uppercase mt-0.5">
                {groups.length} groups indexed
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 px-5 py-2 bg-primary/10 border border-primary/40 text-primary hover:bg-primary/20 transition-all font-mono text-xs tracking-widest uppercase hud-corner glow-border"
          >
            <Plus className="w-4 h-4" />
            New Group
          </button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto p-6 pb-24 lg:pb-6">
        {groups.length === 0 ? (
          <div className="text-center py-24">
            <p className="font-mono text-primary/20 text-sm tracking-[0.3em] uppercase mb-6">
              No groups created
            </p>
            <button
              onClick={() => setShowForm(true)}
              className="px-8 py-3 bg-primary/10 border border-primary/40 text-primary hover:bg-primary/20 font-mono text-xs tracking-widest uppercase hud-corner glow-border transition-all"
            >
              + Create First Group
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {groups.map((group) => {
              const groupChars = getGroupCharacters(group.id);
              return (
                <div
                  key={group.id}
                  className="group relative border border-primary/15 bg-black/40 hud-corner hover:border-primary/40 hover:bg-primary/5 transition-all p-4"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-mono text-sm text-primary tracking-wider uppercase">{group.name}</h3>
                      {group.description && (
                        <p className="text-[10px] font-mono text-primary/30 mt-1 line-clamp-2">{group.description}</p>
                      )}
                      <div className="flex flex-wrap gap-2 mt-3">
                        {groupChars.slice(0, 5).map((char) => (
                          <span
                            key={char.id}
                            className="text-[9px] font-mono px-2 py-1 bg-primary/10 border border-primary/20 text-primary/70 rounded"
                          >
                            {char.name}
                          </span>
                        ))}
                        {groupChars.length > 5 && (
                          <span className="text-[9px] font-mono px-2 py-1 bg-primary/10 border border-primary/20 text-primary/70 rounded">
                            +{groupChars.length - 5}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                      <button
                        onClick={() => handleEdit(group)}
                        className="w-7 h-7 bg-black/80 border border-primary/30 text-primary/50 hover:text-primary flex items-center justify-center transition-colors"
                      >
                        <Edit2 className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => handleDelete(group.id)}
                        className="w-7 h-7 bg-black/80 border border-red-900/30 text-red-900 hover:text-red-400 flex items-center justify-center transition-colors"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl bg-background border border-primary/30 hud-corner glow-border max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-6 border-b border-primary/20">
              <h2 className="font-mono text-primary glow-text tracking-[0.2em] uppercase">
                {editingGroup ? "// Edit Group" : "// New Group"}
              </h2>
              <button onClick={closeForm} className="text-primary/30 hover:text-primary transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              {/* Name */}
              <div>
                <label className="block text-[9px] font-mono text-primary/40 tracking-[0.25em] uppercase mb-2">
                  Group Name *
                </label>
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Avengers, Team Avatar, Z-Fighters"
                  className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/15 font-mono text-sm px-3 py-2 focus:outline-none focus:border-primary/50 transition-colors"
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-[9px] font-mono text-primary/40 tracking-[0.25em] uppercase mb-2">
                  Description
                </label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Describe this group..."
                  rows={2}
                  className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/15 font-mono text-sm px-3 py-2 focus:outline-none focus:border-primary/50 transition-colors resize-none"
                />
              </div>

              {/* Search Characters */}
              <div>
                <label className="block text-[9px] font-mono text-primary/40 tracking-[0.25em] uppercase mb-2">
                  Add Characters *
                </label>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search characters..."
                  className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/15 font-mono text-sm px-3 py-2 focus:outline-none focus:border-primary/50 transition-colors mb-3"
                />
              </div>

              {/* Characters Grid */}
              <div className="space-y-3">
                <p className="text-[9px] font-mono text-primary/40 tracking-widest uppercase">
                  {form.character_ids.length} selected
                </p>
                <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto">
                  {filteredCharacters.map((char) => (
                    <button
                      key={char.id}
                      onClick={() => toggleCharacter(char.id)}
                      className={`p-2 text-left border text-sm transition-all text-xs ${
                        form.character_ids.includes(char.id)
                          ? "border-primary/60 bg-primary/10 text-primary"
                          : "border-primary/15 bg-black/40 text-primary/60 hover:border-primary/40"
                      }`}
                    >
                      <p className="font-mono tracking-wider uppercase truncate">{char.name}</p>
                      {char.universe && (
                        <p className="text-[9px] text-primary/30 truncate">{char.universe}</p>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="p-6 border-t border-primary/20 flex justify-end gap-3">
              <button
                onClick={closeForm}
                className="px-6 py-2 border border-primary/20 text-primary/40 hover:text-primary hover:border-primary/40 font-mono text-xs tracking-widest uppercase transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={!form.name.trim() || form.character_ids.length === 0 || saving}
                className="px-6 py-2 bg-primary/10 border border-primary/50 text-primary hover:bg-primary/20 disabled:opacity-30 disabled:cursor-not-allowed font-mono text-xs tracking-widest uppercase transition-all hud-corner glow-border"
              >
                {saving ? "Saving..." : editingGroup ? "Update" : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}