import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Plus, X, Edit2, Trash2, Upload, Volume2, BookOpen, Loader } from "lucide-react";
import VoicePicker from "@/components/voice/VoicePicker";
import VoiceCloneManager from "@/components/characters/VoiceCloneManager";
import { Link } from "react-router-dom";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";

const CATEGORIES = ["companion", "warrior", "mystic", "scientist", "villain", "hero", "other"];
const STATUSES = ["online", "standby", "offline"];

const categoryColors = {
  companion: "text-cyan-400 border-cyan-400/30",
  warrior: "text-red-400 border-red-400/30",
  mystic: "text-purple-400 border-purple-400/30",
  scientist: "text-green-400 border-green-400/30",
  villain: "text-orange-400 border-orange-400/30",
  hero: "text-yellow-400 border-yellow-400/30",
  other: "text-primary/50 border-primary/20",
};

const statusColors = {
  online: "bg-green-400",
  standby: "bg-yellow-400",
  offline: "bg-primary/20",
};

const defaultForm = {
  name: "",
  universe: "",
  category: "companion",
  status: "online",
  avatar_url: "",
  personality: "",
  backstory: "",
  speaking_style: "",
  elevenlabs_voice_id: "",
};

export default function Characters() {
  const navigate = useNavigate();
  const [characters, setCharacters] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editingChar, setEditingChar] = useState(null);
  const [form, setForm] = useState(defaultForm);
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [fetchingBio, setFetchingBio] = useState(false);
  const [longPressTimer, setLongPressTimer] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [showDeleteAll, setShowDeleteAll] = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);

  useEffect(() => {
    loadCharacters();
  }, []);

  const loadCharacters = async () => {
    const data = await base44.entities.Character.list("-created_date", 100);
    setCharacters(data);
  };

  const handleEdit = (char) => {
    setEditingChar(char);
    setForm({
      name: char.name || "",
      universe: char.universe || "",
      category: char.category || "companion",
      status: char.status || "online",
      avatar_url: char.avatar_url || "",
      personality: char.personality || "",
      backstory: char.backstory || "",
      speaking_style: char.speaking_style || "",
      elevenlabs_voice_id: char.elevenlabs_voice_id || "",
    });
    setShowForm(true);
  };

  const handleDelete = async (id) => {
    setDeletingId(id);
    await base44.entities.Character.delete(id);
    await loadCharacters();
    setDeletingId(null);
  };

  const handleLongPressStart = (id) => {
    const timer = setTimeout(() => {
      if (confirm("Delete this character?")) {
        handleDelete(id);
      }
    }, 500);
    setLongPressTimer(timer);
  };

  const handleLongPressEnd = () => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      setLongPressTimer(null);
    }
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      let finalForm = form;
      
      // If creating new character with universe but missing personality/backstory/speaking_style, auto-generate
      if (!editingChar && form.universe && (!form.personality || !form.backstory || !form.speaking_style)) {
        const generated = await base44.functions.invoke('generateCharacterTraits', {
          name: form.name,
          universe: form.universe
        });
        finalForm = {
          ...form,
          personality: generated.personality || form.personality,
          backstory: generated.backstory || form.backstory,
          speaking_style: generated.speaking_style || form.speaking_style
        };
      }

      if (editingChar) {
        await base44.entities.Character.update(editingChar.id, finalForm);
      } else {
        await base44.entities.Character.create(finalForm);
      }
      await loadCharacters();
      setShowForm(false);
      setEditingChar(null);
      setForm(defaultForm);
    } catch (err) {
      console.error('Error saving character:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleAvatarUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploadingAvatar(true);
    const { file_url } = await base44.integrations.Core.UploadFile({ file });
    setForm((f) => ({ ...f, avatar_url: file_url }));
    setUploadingAvatar(false);
  };

  const handleFetchWikipediaBio = async () => {
    if (!form.name.trim()) return;
    setFetchingBio(true);
    try {
      const result = await base44.functions.invoke("fetchCharacterBioFromWikipedia", {
        character_name: form.name,
        character_universe: form.universe || null,
      });
      if (result?.data?.data) {
        const bioData = result.data.data;
        setForm(prev => ({
          ...prev,
          personality: bioData.personality || prev.personality,
          backstory: bioData.backstory || prev.backstory,
          speaking_style: bioData.speaking_style || prev.speaking_style,
        }));
      }
    } catch (err) {
      console.error("Error fetching Wikipedia bio:", err);
    } finally {
      setFetchingBio(false);
    }
  };

  const handleDeleteAll = async () => {
    setDeletingAll(true);
    try {
      await Promise.all(characters.map((c) => base44.entities.Character.delete(c.id)));
      setCharacters([]);
      setShowDeleteAll(false);
    } catch (err) {
      console.error('Error deleting all characters:', err);
    } finally {
      setDeletingAll(false);
    }
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingChar(null);
    setForm(defaultForm);
  };

  return (
    <div className="flex flex-col h-[100dvh] overflow-hidden bg-background scanline">
      {/* Header */}
      <div className="border-b border-primary/20 bg-black/60 backdrop-blur-md px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Link to="/" className="text-primary/40 hover:text-primary transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="font-mono text-primary glow-text tracking-[0.2em] uppercase text-lg">
                // Character Library
              </h1>
              <p className="text-[10px] font-mono text-primary/30 tracking-widest uppercase mt-0.5">
                {characters.length} entities indexed
              </p>
            </div>
          </div>
          <div className="flex gap-3">
            {characters.length > 0 && (
              <button
                onClick={() => setShowDeleteAll(true)}
                className="flex items-center gap-2 px-4 py-2 border border-destructive/30 text-destructive/60 hover:text-destructive hover:border-destructive/60 font-mono text-xs tracking-widest uppercase transition-all"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Delete All</span>
              </button>
            )}
            <Link
              to="/groups"
              className="flex items-center gap-2 px-5 py-2 bg-primary/10 border border-primary/40 text-primary hover:bg-primary/20 transition-all font-mono text-xs tracking-widest uppercase hud-corner glow-border"
            >
              Manage Groups
            </Link>
            <button
              onClick={() => setShowForm(true)}
              className="flex items-center gap-2 px-5 py-2 bg-primary/10 border border-primary/40 text-primary hover:bg-primary/20 transition-all font-mono text-xs tracking-widest uppercase hud-corner glow-border"
            >
              <Plus className="w-4 h-4" />
              New Character
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6" style={{ WebkitOverflowScrolling: 'touch', overflowY: 'scroll', paddingBottom: 'var(--tab-bar-height, 120px)' }}>
        <div className="max-w-6xl mx-auto space-y-6">
          {characters.length === 0 ? (
            <div className="text-center py-24">
              <p className="font-mono text-primary/20 text-sm tracking-[0.3em] uppercase mb-6">
                No characters indexed
              </p>
              <button
                onClick={() => setShowForm(true)}
                className="px-8 py-3 bg-primary/10 border border-primary/40 text-primary hover:bg-primary/20 font-mono text-xs tracking-widest uppercase hud-corner glow-border transition-all"
              >
                + Create First Character
              </button>
            </div>
          ) : (
            <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {characters.map((char) => (
              <div
                key={char.id}
                className={`group relative border border-primary/15 bg-black/40 hud-corner hover:border-primary/40 hover:bg-primary/5 transition-all cursor-long-press ${deletingId === char.id ? "opacity-50" : ""}`}
                data-no-swipe
                onMouseDown={() => handleLongPressStart(char.id)}
                onMouseUp={handleLongPressEnd}
                onMouseLeave={handleLongPressEnd}
                onTouchStart={() => handleLongPressStart(char.id)}
                onTouchEnd={handleLongPressEnd}
              >
                {/* Action buttons */}
                <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                  <button
                    onClick={() => handleEdit(char)}
                    className="w-7 h-7 bg-black/80 border border-primary/30 text-primary/50 hover:text-primary flex items-center justify-center transition-colors"
                  >
                    <Edit2 className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => handleDelete(char.id)}
                    className="w-7 h-7 bg-black/80 border border-red-900/30 text-red-900 hover:text-red-400 flex items-center justify-center transition-colors"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>

                {/* Avatar */}
                <div className="relative">
                  {char.avatar_url ? (
                    <img src={char.avatar_url} alt={char.name} className="w-full aspect-square object-cover" />
                  ) : (
                    <div className="w-full aspect-square bg-primary/5 flex items-center justify-center">
                      <span className="font-mono text-primary/30 text-4xl">{char.name[0]}</span>
                    </div>
                  )}
                  {/* Status dot */}
                  <div className={`absolute bottom-2 left-2 w-2 h-2 rounded-full ${statusColors[char.status || "online"]}`} />
                </div>

                {/* Info */}
                <div className="p-4">
                  <h3 className="font-mono text-sm text-primary tracking-wider uppercase truncate">{char.name}</h3>
                  {char.universe && (
                    <p className="text-[10px] font-mono text-primary/30 truncate mt-0.5 tracking-widest">{char.universe}</p>
                  )}
                  {char.category && (
                    <span className={`inline-block mt-2 text-[9px] font-mono tracking-[0.2em] uppercase border px-2 py-0.5 ${categoryColors[char.category]}`}>
                      {char.category}
                    </span>
                  )}
                  {char.personality && (
                    <p className="mt-2 text-[10px] font-mono text-primary/30 line-clamp-2 leading-relaxed">{char.personality}</p>
                  )}
                </div>
              </div>
            ))}
            </div>
            </>
          )}
        </div>
      </div>

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl bg-background border border-primary/30 hud-corner glow-border max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-6 border-b border-primary/20">
              <h2 className="font-mono text-primary glow-text tracking-[0.2em] uppercase">
                {editingChar ? "// Edit Character" : "// New Character"}
              </h2>
              <button onClick={closeForm} className="text-primary/30 hover:text-primary transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              {/* Avatar Upload */}
              <div className="flex items-center gap-4">
                <div className="w-20 h-20 border border-primary/30 bg-primary/5 overflow-hidden flex-shrink-0">
                  {form.avatar_url ? (
                    <img src={form.avatar_url} alt="avatar" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <span className="font-mono text-primary/20 text-2xl">{form.name[0] || "?"}</span>
                    </div>
                  )}
                </div>
                <div className="space-y-2 flex-1">
                  <label className="block">
                    <input type="file" accept="image/*" onChange={handleAvatarUpload} className="hidden" />
                    <span className="flex items-center gap-2 px-4 py-2 border border-primary/20 text-primary/50 hover:text-primary hover:border-primary/40 font-mono text-[10px] tracking-widest uppercase cursor-pointer transition-all w-fit">
                      <Upload className="w-3 h-3" />
                      {uploadingAvatar ? "Uploading..." : "Upload Avatar"}
                    </span>
                  </label>
                  <input
                    value={form.avatar_url}
                    onChange={(e) => setForm((f) => ({ ...f, avatar_url: e.target.value }))}
                    placeholder="Or paste image URL..."
                    className="w-full bg-black/60 border border-primary/15 text-primary/70 placeholder-primary/15 font-mono text-[10px] px-3 py-2 focus:outline-none focus:border-primary/40 transition-colors"
                  />
                </div>
              </div>

              {/* Name & Universe */}
              <div className="grid grid-cols-2 gap-4">
                <Field label="Character Name *" value={form.name} onChange={(v) => setForm((f) => ({ ...f, name: v }))} placeholder="e.g. Serenity" />
                <Field label="Universe / Series" value={form.universe} onChange={(v) => setForm((f) => ({ ...f, universe: v }))} placeholder="e.g. Original" />
              </div>

              {/* Category & Status */}
              <div className="grid grid-cols-2 gap-4">
                <SelectField label="Category" value={form.category} options={CATEGORIES} onChange={(v) => setForm((f) => ({ ...f, category: v }))} />
                <SelectField label="Status" value={form.status} options={STATUSES} onChange={(v) => setForm((f) => ({ ...f, status: v }))} />
              </div>

              {/* Personality */}
              <TextAreaField
                label="Personality Traits"
                value={form.personality}
                onChange={(v) => setForm((f) => ({ ...f, personality: v }))}
                placeholder="Describe how they think, act, and feel..."
                rows={3}
              />

              {/* Backstory */}
              <TextAreaField
                label="Backstory"
                value={form.backstory}
                onChange={(v) => setForm((f) => ({ ...f, backstory: v }))}
                placeholder="Background, history, motivations..."
                rows={3}
              />

              {/* Speaking Style */}
              <TextAreaField
                label="Speaking Style"
                value={form.speaking_style}
                onChange={(v) => setForm((f) => ({ ...f, speaking_style: v }))}
                placeholder="How they talk, vocabulary, tone, habits..."
                rows={2}
              />

              {/* Voice Clone Manager */}
              <div>
                <label className="flex items-center gap-1.5 text-[9px] font-mono text-primary/40 tracking-[0.25em] uppercase mb-2">
                  <Volume2 className="w-3 h-3" />
                  Voice Configuration
                </label>
                <VoiceCloneManager
                  character={editingChar || { elevenlabs_voice_id: form.elevenlabs_voice_id, voice_clones: [] }}
                  onUpdate={(data) => {
                    setForm((f) => ({ ...f, elevenlabs_voice_id: data.elevenlabs_voice_id || f.elevenlabs_voice_id }));
                    if (editingChar) {
                      base44.entities.Character.update(editingChar.id, data).catch(console.error);
                    }
                  }}
                />
              </div>

              {/* Auto-fetch Bio Button */}
              <button
                onClick={handleFetchWikipediaBio}
                disabled={fetchingBio || !form.name.trim()}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-500/10 border border-blue-400/40 text-blue-400 hover:bg-blue-500/20 disabled:opacity-50 font-mono text-xs tracking-widest uppercase transition-all hud-corner"
              >
                {fetchingBio ? (
                  <>
                    <Loader className="w-3 h-3 animate-spin" />
                    Fetching...
                  </>
                ) : (
                  <>
                    <BookOpen className="w-3 h-3" />
                    Fetch from Wikipedia
                  </>
                )}
              </button>
              </div>
            </div>

            <div className="p-6 border-t border-primary/20 flex justify-end gap-3">
              <button onClick={closeForm} className="px-6 py-2 border border-primary/20 text-primary/40 hover:text-primary hover:border-primary/40 font-mono text-xs tracking-widest uppercase transition-all">
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={!form.name.trim() || saving}
                className="px-6 py-2 bg-primary/10 border border-primary/50 text-primary hover:bg-primary/20 disabled:opacity-30 disabled:cursor-not-allowed font-mono text-xs tracking-widest uppercase transition-all hud-corner glow-border"
              >
                {saving ? "Saving..." : editingChar ? "Update" : "Create"}
              </button>
            </div>
            </div>
            )}

      {/* Delete All Confirmation Modal */}
      {showDeleteAll && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm bg-background border border-destructive/40 hud-corner p-6 space-y-4">
            <div className="flex items-center gap-3">
              <Trash2 className="w-5 h-5 text-destructive flex-shrink-0" />
              <h2 className="font-mono text-destructive tracking-[0.2em] uppercase text-sm">Delete All Characters</h2>
            </div>
            <p className="font-mono text-xs text-primary/60 leading-relaxed">
              This will permanently delete all <span className="text-destructive font-bold">{characters.length} characters</span>. This cannot be undone.
            </p>
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setShowDeleteAll(false)}
                disabled={deletingAll}
                className="flex-1 px-4 py-2 border border-primary/20 text-primary/50 hover:text-primary hover:border-primary/40 font-mono text-xs tracking-widest uppercase transition-all disabled:opacity-30"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteAll}
                disabled={deletingAll}
                className="flex-1 px-4 py-2 bg-destructive/20 border border-destructive/60 text-destructive hover:bg-destructive/30 disabled:opacity-50 font-mono text-xs tracking-widest uppercase transition-all flex items-center justify-center gap-2"
              >
                {deletingAll ? <><Loader className="w-3 h-3 animate-spin" /> Deleting...</> : "Delete All"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange, placeholder }) {
  return (
    <div>
      <label className="block text-[9px] font-mono text-primary/40 tracking-[0.25em] uppercase mb-2">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/15 font-mono text-sm px-3 py-2 focus:outline-none focus:border-primary/50 transition-colors"
      />
    </div>
  );
}

function SelectField({ label, value, options, onChange }) {
  return (
    <div>
      <label className="block text-[9px] font-mono text-primary/40 tracking-[0.25em] uppercase mb-2">{label}</label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-full bg-black/60 border-primary/20 text-primary/80 font-mono text-sm min-h-[44px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="bg-background border-primary/30">
          {options.map((o) => (
            <SelectItem key={o} value={o} className="font-mono text-primary/80 capitalize">
              {o}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function TextAreaField({ label, value, onChange, placeholder, rows = 3 }) {
  return (
    <div>
      <label className="block text-[9px] font-mono text-primary/40 tracking-[0.25em] uppercase mb-2">{label}</label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/15 font-mono text-sm px-3 py-2 focus:outline-none focus:border-primary/50 transition-colors resize-none leading-relaxed"
      />
    </div>
  );
}