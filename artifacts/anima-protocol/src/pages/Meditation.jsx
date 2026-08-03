import { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { Link } from "react-router-dom";
import { ArrowLeft, Play, Pause, SkipForward, SkipBack, Plus, Volume2, VolumeX, Sparkles, Heart, Zap, Star } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import AffirmationPlayer from "@/components/meditation/AffirmationPlayer";
import AmbientSoundControl from "@/components/meditation/AmbientSoundControl";
import MeditationRitual from "@/components/meditation/MeditationRitual";
import ChakraVisualizer from "@/components/meditation/ChakraVisualizer";
import SacredSpaceSession from "@/components/meditation/SacredSpaceSession";

const CATEGORY_CONFIG = {
  abundance: { label: "Abundance", glyph: "✦", color: "#FBBF24", gradient: "from-yellow-500/20 to-amber-500/10" },
  healing: { label: "Healing", glyph: "◉", color: "#34D399", gradient: "from-emerald-500/20 to-teal-500/10" },
  love: { label: "Love", glyph: "♡", color: "#F472B6", gradient: "from-pink-500/20 to-rose-500/10" },
  strength: { label: "Strength", glyph: "⬟", color: "#F87171", gradient: "from-red-500/20 to-orange-500/10" },
  clarity: { label: "Clarity", glyph: "◈", color: "#60A5FA", gradient: "from-blue-500/20 to-cyan-500/10" },
  protection: { label: "Protection", glyph: "⬡", color: "#A78BFA", gradient: "from-violet-500/20 to-purple-500/10" },
  awakening: { label: "Awakening", glyph: "⟡", color: "#C084FC", gradient: "from-purple-500/20 to-pink-500/10" },
  custom: { label: "Custom", glyph: "◦", color: "#94A3B8", gradient: "from-slate-500/20 to-gray-500/10" },
};

const DEFAULT_AFFIRMATIONS = [
  { text: "I am healthy, wealthy, and wise.", category: "abundance" },
  { text: "My body heals itself with every breath I take.", category: "healing" },
  { text: "I radiate love and it returns to me multiplied.", category: "love" },
  { text: "I am grounded, centered, and at peace.", category: "clarity" },
  { text: "Abundance flows to me naturally and effortlessly.", category: "abundance" },
  { text: "I am protected by light. Only love can reach me.", category: "protection" },
  { text: "My consciousness expands with every moment.", category: "awakening" },
  { text: "I am worthy of all good things.", category: "love" },
  { text: "My inner strength is limitless.", category: "strength" },
  { text: "I am in perfect alignment with my highest self.", category: "awakening" },
  { text: "528Hz — the frequency of love — flows through my cells.", category: "healing" },
  { text: "I attract miracles. I am a magnet for blessings.", category: "abundance" },
];

const TABS = [
  { id: "affirm", label: "Affirmations", glyph: "✦" },
  { id: "ritual", label: "Ritual", glyph: "◉" },
  { id: "characters", label: "With Character", glyph: "♡" },
  { id: "chakra", label: "Chakra", glyph: "⟡" },
];

export default function Meditation() {
  const [affirmations, setAffirmations] = useState([]);
  const [anima, setAnima] = useState(null);
  const [activeTab, setActiveTab] = useState("affirm");
  const [filterCategory, setFilterCategory] = useState("all");
  const [showAddForm, setShowAddForm] = useState(false);
  const [newText, setNewText] = useState("");
  const [newCategory, setNewCategory] = useState("healing");
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [characters, setCharacters] = useState([]);
  const [activeCharSession, setActiveCharSession] = useState(null);

  useEffect(() => {
    init();
  }, []);

  const init = async () => {
    setLoading(true);
    try {
      const me = await base44.auth.me();
      setUser(me);

      const [userAffirms, animas, chars] = await Promise.all([
        base44.entities.Affirmation.filter({ user_email: me.email, is_active: true }),
        base44.entities.Anima.list("-created_date", 10),
        base44.entities.Character.list("-created_date", 100),
      ]);
      setCharacters(chars || []);

      // Seed defaults if user has none
      let allAffirms = userAffirms || [];
      if (allAffirms.length === 0) {
        const created = await Promise.all(
          DEFAULT_AFFIRMATIONS.map(a =>
            base44.entities.Affirmation.create({ ...a, user_email: me.email, is_default: true, is_active: true })
          )
        );
        allAffirms = created;
      }

      setAffirmations(allAffirms);

      const userAnima = animas?.find(a => a.assigned_user === me.email) || animas?.[0] || null;
      setAnima(userAnima);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleAddAffirmation = async () => {
    if (!newText.trim() || !user) return;
    const created = await base44.entities.Affirmation.create({
      text: newText.trim(),
      category: newCategory,
      user_email: user.email,
      is_active: true,
    });
    setAffirmations(prev => [...prev, created]);
    setNewText("");
    setShowAddForm(false);
  };

  const handleDelete = async (id) => {
    await base44.entities.Affirmation.update(id, { is_active: false });
    setAffirmations(prev => prev.filter(a => a.id !== id));
  };

  const filtered = filterCategory === "all"
    ? affirmations
    : affirmations.filter(a => a.category === filterCategory);

  if (loading) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center" style={{ background: "linear-gradient(160deg, #0d0520 0%, #12052e 40%, #0a0a1a 100%)" }}>
        <div className="text-center space-y-3">
          <div className="text-3xl animate-spin" style={{ color: "#A78BFA" }}>⟡</div>
          <p className="font-mono text-[10px] tracking-[0.4em] uppercase animate-pulse" style={{ color: "rgba(167,139,250,0.5)" }}>
            Attuning frequency...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col pb-20" style={{ background: "linear-gradient(160deg, #0d0520 0%, #12052e 50%, #0a0a1a 100%)" }}>

      {/* Ambient aura glow */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-0 left-1/3 w-96 h-96 rounded-full opacity-15 blur-[120px]" style={{ background: "radial-gradient(circle, #7C3AED, transparent 70%)" }} />
        <div className="absolute bottom-1/3 right-1/4 w-64 h-64 rounded-full opacity-10 blur-[80px]" style={{ background: "radial-gradient(circle, #EC4899, transparent 70%)" }} />
        <div className="absolute top-1/2 left-1/2 w-48 h-48 rounded-full opacity-8 blur-[60px]" style={{ background: "radial-gradient(circle, #06B6D4, transparent 70%)" }} />
      </div>

      {/* Header */}
      <div className="relative z-10 border-b px-4 sm:px-6 py-4 sticky top-0 backdrop-blur-xl" style={{ borderColor: "rgba(139,92,246,0.2)", background: "rgba(13,5,32,0.85)" }}>
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link to="/" className="transition-colors p-1" style={{ color: "rgba(167,139,250,0.4)" }}>
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm" style={{ color: "#C084FC" }}>⟡</span>
                <h1 className="font-mono text-sm sm:text-base tracking-[0.2em] uppercase" style={{ color: "#E0D9FF" }}>
                  Sacred Space
                </h1>
              </div>
              <p className="font-mono text-[8px] tracking-[0.3em] uppercase mt-0.5" style={{ color: "rgba(167,139,250,0.4)" }}>
                {anima?.name || "Anima"} · Wellness Protocol
              </p>
            </div>
          </div>
          <AmbientSoundControl />
        </div>
      </div>

      {/* Tabs */}
      <div className="relative z-10 border-b" style={{ borderColor: "rgba(139,92,246,0.1)", background: "rgba(13,5,32,0.7)" }}>
        <div className="max-w-4xl mx-auto flex">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-3 font-mono text-[9px] sm:text-[10px] tracking-[0.2em] uppercase transition-all border-b-2 ${
                activeTab === tab.id ? "border-violet-400 text-violet-300" : "border-transparent text-white/25 hover:text-white/50"
              }`}
            >
              <span>{tab.glyph}</span>
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="relative z-10 flex-1 overflow-y-auto max-w-4xl mx-auto w-full px-4 sm:px-6 py-6">
        <AnimatePresence mode="wait">

          {/* AFFIRMATIONS TAB */}
          {activeTab === "affirm" && (
            <motion.div key="affirm" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-6">

              {/* Player */}
              <AffirmationPlayer affirmations={filtered} anima={anima} />

              {/* Category Filter */}
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setFilterCategory("all")}
                  className="px-3 py-1.5 border font-mono text-[8px] tracking-widest uppercase transition-all"
                  style={{
                    borderColor: filterCategory === "all" ? "rgba(167,139,250,0.5)" : "rgba(255,255,255,0.06)",
                    background: filterCategory === "all" ? "rgba(124,58,237,0.15)" : "transparent",
                    color: filterCategory === "all" ? "#A78BFA" : "rgba(255,255,255,0.25)",
                  }}
                >
                  All ({affirmations.length})
                </button>
                {Object.entries(CATEGORY_CONFIG).map(([cat, cfg]) => {
                  const count = affirmations.filter(a => a.category === cat).length;
                  if (count === 0) return null;
                  return (
                    <button
                      key={cat}
                      onClick={() => setFilterCategory(cat)}
                      className="px-3 py-1.5 border font-mono text-[8px] tracking-widest uppercase transition-all"
                      style={{
                        borderColor: filterCategory === cat ? `${cfg.color}60` : "rgba(255,255,255,0.06)",
                        background: filterCategory === cat ? `${cfg.color}15` : "transparent",
                        color: filterCategory === cat ? cfg.color : "rgba(255,255,255,0.25)",
                      }}
                    >
                      {cfg.glyph} {cfg.label} ({count})
                    </button>
                  );
                })}
              </div>

              {/* Affirmations List */}
              <div className="space-y-2">
                {filtered.map((a, idx) => {
                  const cfg = CATEGORY_CONFIG[a.category] || CATEGORY_CONFIG.custom;
                  return (
                    <motion.div
                      key={a.id}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: idx * 0.03 }}
                      className="flex items-center gap-3 px-4 py-3 border transition-all group"
                      style={{ borderColor: `${cfg.color}20`, background: `${cfg.color}05` }}
                    >
                      <span className="flex-shrink-0 text-sm" style={{ color: cfg.color }}>{cfg.glyph}</span>
                      <p className="flex-1 font-mono text-[10px] sm:text-xs leading-relaxed" style={{ color: "rgba(220,210,255,0.7)" }}>
                        {a.text}
                      </p>
                      <button
                        onClick={() => handleDelete(a.id)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity font-mono text-[8px] text-red-400/50 hover:text-red-400"
                      >
                        ✕
                      </button>
                    </motion.div>
                  );
                })}
              </div>

              {/* Add Affirmation */}
              {showAddForm ? (
                <div className="space-y-3 p-4 border" style={{ borderColor: "rgba(139,92,246,0.3)", background: "rgba(124,58,237,0.06)" }}>
                  <textarea
                    value={newText}
                    onChange={e => setNewText(e.target.value)}
                    placeholder="Write your affirmation..."
                    rows={2}
                    className="w-full bg-black/40 border font-mono text-xs px-3 py-2 resize-none focus:outline-none transition-all"
                    style={{ borderColor: "rgba(139,92,246,0.3)", color: "#E0D9FF" }}
                  />
                  <div className="flex gap-2 flex-wrap">
                    {Object.entries(CATEGORY_CONFIG).map(([cat, cfg]) => (
                      <button
                        key={cat}
                        onClick={() => setNewCategory(cat)}
                        className="px-2.5 py-1 border font-mono text-[8px] tracking-widest uppercase transition-all"
                        style={{
                          borderColor: newCategory === cat ? `${cfg.color}60` : "rgba(255,255,255,0.06)",
                          background: newCategory === cat ? `${cfg.color}15` : "transparent",
                          color: newCategory === cat ? cfg.color : "rgba(255,255,255,0.2)",
                        }}
                      >
                        {cfg.glyph} {cfg.label}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleAddAffirmation}
                      disabled={!newText.trim()}
                      className="px-4 py-2 font-mono text-[9px] tracking-widest uppercase transition-all disabled:opacity-30"
                      style={{ background: "rgba(124,58,237,0.3)", border: "1px solid rgba(139,92,246,0.5)", color: "#C084FC" }}
                    >
                      ✦ Add
                    </button>
                    <button
                      onClick={() => setShowAddForm(false)}
                      className="px-4 py-2 font-mono text-[9px] tracking-widest uppercase transition-all"
                      style={{ border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.3)" }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setShowAddForm(true)}
                  className="w-full flex items-center justify-center gap-2 py-3 border font-mono text-[9px] tracking-widest uppercase transition-all"
                  style={{ borderColor: "rgba(139,92,246,0.2)", color: "rgba(167,139,250,0.5)", background: "rgba(124,58,237,0.04)" }}
                >
                  <Plus className="w-3 h-3" />
                  Add Affirmation
                </button>
              )}
            </motion.div>
          )}

          {/* RITUAL TAB */}
          {activeTab === "ritual" && (
            <motion.div key="ritual" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <MeditationRitual anima={anima} user={user} />
            </motion.div>
          )}

          {/* WITH CHARACTER TAB */}
          {activeTab === "characters" && (
            <motion.div key="characters" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-6">
              <div className="text-center space-y-2 py-4">
                <div className="text-3xl" style={{ color: "#F472B6" }}>♡</div>
                <h2 className="font-mono text-base tracking-[0.2em] uppercase" style={{ color: "#E0D9FF" }}>
                  Sacred Space with a Character
                </h2>
                <p className="font-mono text-[10px] leading-relaxed max-w-sm mx-auto" style={{ color: "rgba(167,139,250,0.5)" }}>
                  Invite a character into your Sacred Space. Your time together will leave a permanent impression on who they are and how they relate to you.
                </p>
              </div>

              {characters.length === 0 ? (
                <p className="text-center font-mono text-[10px]" style={{ color: "rgba(255,255,255,0.2)" }}>
                  No characters yet. Create one first.
                </p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {characters.map(char => (
                    <button
                      key={char.id}
                      onClick={() => setActiveCharSession(char)}
                      className="flex flex-col items-center gap-3 p-4 border transition-all text-left"
                      style={{ borderColor: "rgba(244,114,182,0.15)", background: "rgba(244,114,182,0.03)" }}
                    >
                      {char.avatar_url ? (
                        <img src={char.avatar_url} alt={char.name}
                          className="w-14 h-14 object-cover border"
                          style={{ borderColor: "rgba(244,114,182,0.3)" }} />
                      ) : (
                        <div className="w-14 h-14 border flex items-center justify-center font-mono text-xl"
                          style={{ borderColor: "rgba(244,114,182,0.3)", color: "#F472B6" }}>
                          {char.name[0]}
                        </div>
                      )}
                      <div className="text-center w-full">
                        <p className="font-mono text-[10px] tracking-wider uppercase truncate" style={{ color: "rgba(220,210,255,0.8)" }}>
                          {char.name}
                        </p>
                        {char.universe && (
                          <p className="font-mono text-[8px] truncate" style={{ color: "rgba(255,255,255,0.2)" }}>
                            {char.universe}
                          </p>
                        )}
                      </div>
                      <span className="font-mono text-[8px] tracking-widest uppercase px-2 py-1 border"
                        style={{ borderColor: "rgba(244,114,182,0.2)", color: "rgba(244,114,182,0.6)" }}>
                        ⟡ Enter Together
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </motion.div>
          )}

          {/* CHAKRA TAB */}
          {activeTab === "chakra" && (
            <motion.div key="chakra" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <ChakraVisualizer />
            </motion.div>
          )}

        </AnimatePresence>
      </div>

      {activeCharSession && (
        <SacredSpaceSession
          character={activeCharSession}
          user={user}
          onClose={() => setActiveCharSession(null)}
          onComplete={(result) => {
            // Character has been updated — could refresh characters list
            setCharacters(prev => prev.map(c =>
              c.id === activeCharSession.id
                ? { ...c, _sacredSpaceTouch: result.emotional_shift }
                : c
            ));
          }}
        />
      )}
    </div>
  );
}