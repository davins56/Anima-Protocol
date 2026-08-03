import { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Loader, Save, X } from "lucide-react";
import { motion } from "framer-motion";

const CHARACTER_CATEGORIES = [
  "companion",
  "warrior",
  "mystic",
  "scientist",
  "villain",
  "hero",
  "other",
];

const ANIMA_ARCHETYPES = [
  "guardian",
  "muse",
  "sage",
  "trickster",
  "shadow",
  "lover",
  "explorer",
  "oracle",
];

export default function CharacterCustomizer({ characterId, isAnima = false }) {
  const [character, setCharacter] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({});

  useEffect(() => {
    if (characterId) {
      loadCharacter();
    }
  }, [characterId, isAnima]);

  const loadCharacter = async () => {
    setLoading(true);
    try {
      const entity = isAnima ? "Anima" : "Character";
      const data = await base44.entities[entity].list("-created_date", 100);
      const char = data.find((c) => c.id === characterId);
      if (char) {
        setCharacter(char);
        setForm(char);
      }
    } catch (err) {
      console.error("Error loading character:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const entity = isAnima ? "Anima" : "Character";
      await base44.entities[entity].update(characterId, form);
      setCharacter(form);
      setSaving(false);
    } catch (err) {
      console.error("Error saving character:", err);
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center space-y-2">
          <Loader className="w-5 h-5 text-primary/60 animate-spin mx-auto" />
          <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase">
            Loading character...
          </p>
        </div>
      </div>
    );
  }

  if (!character) {
    return (
      <div className="flex items-center justify-center h-64 border border-primary/20 bg-black/30 rounded">
        <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase">
          Character not found
        </p>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-mono text-lg text-primary tracking-widest uppercase">
            Customize {form.name}
          </h2>
          <p className="text-[9px] font-mono text-primary/50 mt-1">
            {isAnima ? "Anima" : "Character"} Customization
          </p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2 bg-green-900/30 border border-green-400/40 text-green-400 hover:bg-green-900/50 disabled:opacity-50 transition-all font-mono text-[9px] tracking-widest uppercase"
        >
          <Save className="w-3.5 h-3.5" />
          {saving ? "Saving..." : "Save Changes"}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Avatar Section */}
        <div className="space-y-3">
          <label className="text-[9px] font-mono text-primary/40 tracking-widest uppercase block">
            Avatar
          </label>
          <div className="w-full aspect-square border border-primary/20 bg-black/40 rounded overflow-hidden">
            {form.avatar_url ? (
              <img
                src={form.avatar_url}
                alt={form.name}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-primary/20">
                No Image
              </div>
            )}
          </div>
          <input
            type="url"
            value={form.avatar_url || ""}
            onChange={(e) => setForm({ ...form, avatar_url: e.target.value })}
            placeholder="Image URL..."
            className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-[9px] px-3 py-2 focus:outline-none focus:border-primary/40 transition-colors"
          />
        </div>

        {/* Main Form */}
        <div className="lg:col-span-2 space-y-4">
          {/* Name */}
          <div>
            <label className="text-[9px] font-mono text-primary/40 tracking-widest uppercase block mb-2">
              Name
            </label>
            <input
              type="text"
              value={form.name || ""}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full bg-black/60 border border-primary/20 text-primary/80 font-mono text-sm px-3 py-2 focus:outline-none focus:border-primary/40 transition-colors"
            />
          </div>

          {/* Tagline / Universe */}
          {isAnima ? (
            <div>
              <label className="text-[9px] font-mono text-primary/40 tracking-widest uppercase block mb-2">
                Tagline
              </label>
              <input
                type="text"
                value={form.tagline || ""}
                onChange={(e) => setForm({ ...form, tagline: e.target.value })}
                placeholder="Short description..."
                className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-[9px] px-3 py-2 focus:outline-none focus:border-primary/40 transition-colors"
              />
            </div>
          ) : (
            <div>
              <label className="text-[9px] font-mono text-primary/40 tracking-widest uppercase block mb-2">
                Universe
              </label>
              <input
                type="text"
                value={form.universe || ""}
                onChange={(e) => setForm({ ...form, universe: e.target.value })}
                placeholder="Series, game, book..."
                className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-[9px] px-3 py-2 focus:outline-none focus:border-primary/40 transition-colors"
              />
            </div>
          )}

          {/* Category / Archetype */}
          <div>
            <label className="text-[9px] font-mono text-primary/40 tracking-widest uppercase block mb-2">
              {isAnima ? "Archetype" : "Category"}
            </label>
            <select
              value={
                isAnima ? form.archetype || "guardian" : form.category || "companion"
              }
              onChange={(e) =>
                setForm({
                  ...form,
                  [isAnima ? "archetype" : "category"]: e.target.value,
                })
              }
              className="w-full bg-black/60 border border-primary/20 text-primary/80 font-mono text-[9px] px-3 py-2 focus:outline-none focus:border-primary/40 transition-colors"
            >
              {(isAnima ? ANIMA_ARCHETYPES : CHARACTER_CATEGORIES).map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>

          {/* Personality */}
          <div>
            <label className="text-[9px] font-mono text-primary/40 tracking-widest uppercase block mb-2">
              Personality & Traits
            </label>
            <textarea
              value={form.personality || ""}
              onChange={(e) => setForm({ ...form, personality: e.target.value })}
              placeholder="Describe personality, quirks, strengths, weaknesses..."
              rows={4}
              className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-[9px] px-3 py-2 focus:outline-none focus:border-primary/40 transition-colors resize-none"
            />
          </div>

          {/* Backstory */}
          <div>
            <label className="text-[9px] font-mono text-primary/40 tracking-widest uppercase block mb-2">
              Backstory
            </label>
            <textarea
              value={form.backstory || ""}
              onChange={(e) => setForm({ ...form, backstory: e.target.value })}
              placeholder="Origin, history, important events..."
              rows={4}
              className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-[9px] px-3 py-2 focus:outline-none focus:border-primary/40 transition-colors resize-none"
            />
          </div>

          {/* Speaking Style */}
          <div>
            <label className="text-[9px] font-mono text-primary/40 tracking-widest uppercase block mb-2">
              Speaking Style & Voice
            </label>
            <textarea
              value={form.speaking_style || ""}
              onChange={(e) =>
                setForm({ ...form, speaking_style: e.target.value })
              }
              placeholder="Tone, vocabulary, speech patterns, accent..."
              rows={4}
              className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-[9px] px-3 py-2 focus:outline-none focus:border-primary/40 transition-colors resize-none"
            />
          </div>

          {/* Status */}
          {!isAnima && (
            <div>
              <label className="text-[9px] font-mono text-primary/40 tracking-widest uppercase block mb-2">
                Status
              </label>
              <select
                value={form.status || "online"}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                className="w-full bg-black/60 border border-primary/20 text-primary/80 font-mono text-[9px] px-3 py-2 focus:outline-none focus:border-primary/40 transition-colors"
              >
                <option value="online">Online</option>
                <option value="standby">Standby</option>
                <option value="offline">Offline</option>
              </select>
            </div>
          )}

          {isAnima && (
            <div>
              <label className="text-[9px] font-mono text-primary/40 tracking-widest uppercase block mb-2">
                Status
              </label>
              <select
                value={form.status || "active"}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                className="w-full bg-black/60 border border-primary/20 text-primary/80 font-mono text-[9px] px-3 py-2 focus:outline-none focus:border-primary/40 transition-colors"
              >
                <option value="active">Active</option>
                <option value="dormant">Dormant</option>
                <option value="archived">Archived</option>
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Info */}
      <div className="p-3 bg-primary/5 border border-primary/10 rounded text-[8px] font-mono text-primary/60 space-y-1">
        <p>
          <strong>Tip:</strong> Changes are saved to the database when you click "Save Changes".
        </p>
        <p>
          Update personality and backstory to influence how the AI interprets this{" "}
          {isAnima ? "Anima's" : "character's"} behavior in conversations.
        </p>
      </div>
    </motion.div>
  );
}