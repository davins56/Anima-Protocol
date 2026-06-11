import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { ArrowLeft } from "lucide-react";
import { Plus, X, Edit2, Trash2, Upload, Sparkles, Loader, Volume2, Palette, MessageSquare, Crown, Check, Clock } from "lucide-react";
import VoicePicker from "@/components/voice/VoicePicker";
import AnimaCustomizer from "@/components/anima/AnimaCustomizer";
import { Link } from "react-router-dom";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const ARCHETYPES = ["guardian", "muse", "sage", "trickster", "shadow", "lover", "explorer", "oracle"];

const MBTI_TYPES = [
  "INTJ",
  "INTP",
  "ENTJ",
  "ENTP",
  "INFJ",
  "INFP",
  "ENFJ",
  "ENFP",
  "ISTJ",
  "ISFJ",
  "ESTJ",
  "ESFJ",
  "ISTP",
  "ISFP",
  "ESTP",
  "ESFP",
];

const archetypeColors = {
  guardian: "text-cyan-400 border-cyan-400/30",
  muse: "text-pink-400 border-pink-400/30",
  sage: "text-purple-400 border-purple-400/30",
  trickster: "text-yellow-400 border-yellow-400/30",
  shadow: "text-red-400 border-red-400/30",
  lover: "text-rose-400 border-rose-400/30",
  explorer: "text-green-400 border-green-400/30",
  oracle: "text-blue-400 border-blue-400/30",
};

const archetypeDescriptions = {
  guardian: "Protector — steadfast, loyal, grounding",
  muse: "Inspirer — creative, playful, illuminating",
  sage: "Wisdom — calm, ancient, truth-seeking",
  trickster: "Chaos — witty, unpredictable, liberating",
  shadow: "Depth — dark, honest, transformative",
  lover: "Connection — passionate, empathic, devoted",
  explorer: "Discovery — curious, adventurous, free",
  oracle: "Vision — prophetic, mysterious, knowing",
};

const defaultForm = {
  name: "",
  tagline: "",
  archetype: "guardian",
  personality_type: "",
  personality: "",
  backstory: "",
  speaking_style: "",
  avatar_url: "",
  theme_color: "#00e5e5",
  status: "active",
  elevenlabs_voice_id: "",
  emotion: "calm",
  emotion_level: "Low",
  intensity: 35,
  arousal: 30,
};

export default function Animas() {
  const navigate = useNavigate();
  const [animas, setAnimas] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editingAnima, setEditingAnima] = useState(null);
  const [form, setForm] = useState(defaultForm);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [customizingAnima, setCustomizingAnima] = useState(null);
  const [me, setMe] = useState(null);
  const [activatingId, setActivatingId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [generatingField, setGeneratingField] = useState(null);

  useEffect(() => {
    loadAnimas();
  }, []);

  const loadAnimas = async () => {
    const [data, meData] = await Promise.all([
      base44.entities.Anima.list("-created_date", 100),
      base44.auth.me().catch(() => null),
    ]);
    setAnimas(data);
    setMe(meData);
    setLoading(false);
  };

  const handleEdit = (anima) => {
    setEditingAnima(anima);
    setForm({
      name: anima.name || "",
      tagline: anima.tagline || "",
      archetype: anima.archetype || "guardian",
      personality_type: anima.personality_type || anima.mbti || "",
      personality: anima.personality || "",
      backstory: anima.backstory || "",
      speaking_style: anima.speaking_style || "",
      avatar_url: anima.avatar_url || "",
      theme_color: anima.theme_color || "#00e5e5",
      status: anima.status || "active",
      elevenlabs_voice_id: anima.elevenlabs_voice_id || "",
      emotion: anima.emotion || anima.primary_emotion || "calm",
      emotion_level: anima.emotion_level || anima.level || "Low",
      intensity: anima.intensity != null ? anima.intensity : 35,
      arousal: anima.arousal != null ? anima.arousal : 30,
    });
    setShowForm(true);
  };

  const handleDelete = async (id) => {
    await base44.entities.Anima.delete(id);
    await loadAnimas();
  };

  const handleSetActive = async (anima) => {
    if (!me?.email || activatingId) return;
    setActivatingId(anima.id);
    // Clear the active assignment from any other companion, then bind this one.
    const others = animas.filter(
      (a) => a.assigned_user === me.email && a.id !== anima.id
    );
    await Promise.all(
      others.map((a) => base44.entities.Anima.update(a.id, { assigned_user: null }))
    );
    await base44.entities.Anima.update(anima.id, { assigned_user: me.email });
    await loadAnimas();
    setActivatingId(null);
  };

  const handleTalk = async (anima) => {
    if (me?.email && anima.assigned_user !== me.email) {
      await handleSetActive(anima);
    }
    navigate("/chat");
  };

  const handleGenerate = async () => {
    if (!form.name) return;
    setGenerating(true);
    const result = await base44.integrations.Core.InvokeLLM({
      prompt: `Create a rich, immersive AI companion named "${form.name}" with the archetype: ${form.archetype}.${
        form.personality_type ? ` Myers-Briggs type: ${form.personality_type}.` : ""
      }
${form.tagline ? `Tagline hint: ${form.tagline}` : ""}

Return JSON with:
- personality: 2-3 sentences describing their core traits, emotional style, and how they engage with others
- backstory: 2-3 sentences of evocative origin/history that shapes who they are
- speaking_style: 1-2 sentences on their tone, vocabulary, rhythms, and verbal quirks

Make them feel like a real, singular presence — not generic. Give them contradictions, depth, and soul.`,
      response_json_schema: {
        type: "object",
        properties: {
          personality: { type: "string" },
          backstory: { type: "string" },
          speaking_style: { type: "string" },
        },
      },
    });
    setForm((f) => ({
      ...f,
      personality: result.personality || f.personality,
      backstory: result.backstory || f.backstory,
      speaking_style: result.speaking_style || f.speaking_style,
    }));
    setGenerating(false);
  };

  const FIELD_PROMPTS = {
    tagline:
      "a short, evocative tagline of 4-8 words (no surrounding quotes) that captures their essence",
    personality:
      "2-3 sentences describing their core traits, emotional style, and how they engage with others",
    backstory:
      "2-3 sentences of evocative origin/history that shapes who they are",
    speaking_style:
      "1-2 sentences on their tone, vocabulary, rhythms, and verbal quirks",
  };
  const FIELD_LABELS = {
    tagline: "tagline",
    personality: "personality",
    backstory: "backstory",
    speaking_style: "speaking style",
  };

  const handleGenerateField = async (field) => {
    if (!form.name || generating || generatingField) return;
    setGeneratingField(field);
    try {
      const context = [
        `Name: ${form.name}`,
        `Archetype: ${form.archetype}`,
        form.tagline && field !== "tagline" ? `Tagline: ${form.tagline}` : "",
        form.personality && field !== "personality"
          ? `Personality: ${form.personality}`
          : "",
        form.backstory && field !== "backstory"
          ? `Backstory: ${form.backstory}`
          : "",
        form.speaking_style && field !== "speaking_style"
          ? `Speaking style: ${form.speaking_style}`
          : "",
      ]
        .filter(Boolean)
        .join("\n");
      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `For an AI companion, write ${FIELD_PROMPTS[field]}.
Make them feel like a real, singular presence — not generic. Stay consistent with any details already provided.

Details so far:
${context}

Return JSON with a single "${field}" string field.`,
        response_json_schema: {
          type: "object",
          properties: { [field]: { type: "string" } },
        },
      });
      if (result?.[field]) {
        setForm((f) => ({ ...f, [field]: result[field] }));
      }
    } finally {
      setGeneratingField(null);
    }
  };

  const renderAssist = (field) => (
    <button
      type="button"
      onClick={() => handleGenerateField(field)}
      disabled={!form.name || generating || !!generatingField}
      title={form.name ? `AI assist this ${FIELD_LABELS[field]}` : "Enter a name first"}
      className="flex items-center gap-1 text-[8px] font-mono text-primary/40 hover:text-primary disabled:opacity-30 disabled:cursor-not-allowed tracking-[0.2em] uppercase transition-colors"
    >
      {generatingField === field ? (
        <Loader className="w-2.5 h-2.5 animate-spin" />
      ) : (
        <Sparkles className="w-2.5 h-2.5" />
      )}
      AI Assist
    </button>
  );

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    if (editingAnima) {
      await base44.entities.Anima.update(editingAnima.id, form);
    } else {
      await base44.entities.Anima.create(form);
    }
    await loadAnimas();
    setShowForm(false);
    setEditingAnima(null);
    setForm(defaultForm);
    setSaving(false);
  };

  const handleAvatarUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploadingAvatar(true);
    const { file_url } = await base44.integrations.Core.UploadFile({ file });
    setForm((f) => ({ ...f, avatar_url: file_url }));
    setUploadingAvatar(false);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingAnima(null);
    setForm(defaultForm);
  };

  const activeAnima =
    animas.find((a) => a.assigned_user === me?.email) || animas[0] || null;
  const activeId = activeAnima?.id || null;
  const sortedAnimas = [...animas].sort(
    (a, b) => (b.id === activeId ? 1 : 0) - (a.id === activeId ? 1 : 0)
  );

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-background scanline">
      {/* Header */}
      <div className="border-b border-primary/20 bg-black/60 backdrop-blur-md px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Link to="/" className="text-primary/40 hover:text-primary transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="font-mono text-primary glow-text tracking-[0.2em] uppercase text-lg">
                // Your Animas
              </h1>
              <p className="text-[10px] font-mono text-primary/30 tracking-widest uppercase mt-0.5">
                Track &amp; manage your companions
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 px-5 py-2 bg-primary/10 border border-primary/40 text-primary hover:bg-primary/20 transition-all font-mono text-xs tracking-widest uppercase hud-corner glow-border"
          >
            <Plus className="w-4 h-4" />
            New Anima
          </button>
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-6 pb-24 lg:pb-6">
        {/* Summary strip */}
        {animas.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
            <div className="border border-primary/15 bg-black/40 hud-corner px-4 py-3">
              <p className="text-[8px] font-mono text-primary/30 tracking-[0.25em] uppercase mb-1">
                // Total
              </p>
              <p className="font-mono text-primary text-xl glow-text">{animas.length}</p>
            </div>
            <div className="border border-primary/15 bg-black/40 hud-corner px-4 py-3 col-span-1 sm:col-span-2">
              <p className="text-[8px] font-mono text-primary/30 tracking-[0.25em] uppercase mb-1">
                // Active Companion
              </p>
              <p className="font-mono text-primary text-sm tracking-wider uppercase flex items-center gap-1.5 truncate">
                <Crown className="w-3.5 h-3.5 text-yellow-400 flex-shrink-0" />
                {activeAnima ? activeAnima.name : "None"}
              </p>
            </div>
          </div>
        )}
        {animas.length === 0 ? (
          <div className="text-center py-24">
            <div className="w-20 h-20 border border-primary/20 bg-primary/5 mx-auto flex items-center justify-center mb-6">
              <Sparkles className="w-8 h-8 text-primary/30" />
            </div>
            <p className="font-mono text-primary/20 text-sm tracking-[0.3em] uppercase mb-3">
              No Animas forged yet
            </p>
            <p className="font-mono text-primary/30 text-xs max-w-xs mx-auto leading-relaxed mb-8">
              An Anima is your own creation — a named companion with a unique soul, not drawn from any existing fiction.
            </p>
            <button
              onClick={() => setShowForm(true)}
              className="px-8 py-3 bg-primary/10 border border-primary/40 text-primary hover:bg-primary/20 font-mono text-xs tracking-widest uppercase hud-corner glow-border transition-all"
            >
              + Forge First Anima
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {sortedAnimas.map((anima) => {
              const isActive = anima.id === activeId;
              return (
              <div
                key={anima.id}
                className={`group relative border bg-black/40 hud-corner transition-all ${
                  isActive
                    ? "border-yellow-400/40 shadow-[0_0_14px_rgba(250,204,21,0.12)]"
                    : "border-primary/15 hover:border-primary/40 hover:bg-primary/5"
                }`}
              >
                {isActive && (
                  <div className="absolute top-2 left-2 z-10 flex items-center gap-1 bg-black/80 border border-yellow-400/40 px-1.5 py-0.5">
                    <Crown className="w-3 h-3 text-yellow-400" />
                    <span className="text-[8px] font-mono text-yellow-400 tracking-[0.2em] uppercase">
                      Active
                    </span>
                  </div>
                )}
                <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                  <button
                    onClick={() => setCustomizingAnima(anima)}
                    className="w-7 h-7 bg-black/80 border border-primary/30 text-pink-400/60 hover:text-pink-400 flex items-center justify-center transition-colors"
                    title="Customize appearance"
                  >
                    <Palette className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => handleEdit(anima)}
                    className="w-7 h-7 bg-black/80 border border-primary/30 text-primary/50 hover:text-primary flex items-center justify-center transition-colors"
                    title="Edit"
                  >
                    <Edit2 className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => handleDelete(anima.id)}
                    className="w-7 h-7 bg-black/80 border border-red-900/30 text-red-900 hover:text-red-400 flex items-center justify-center transition-colors"
                    title="Delete"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>

                {anima.avatar_url ? (
                  <img src={anima.avatar_url} alt={anima.name} className="w-full aspect-square object-cover" />
                ) : (
                  <div className="w-full aspect-square bg-primary/5 flex items-center justify-center">
                    <span className="font-mono text-primary/20 text-5xl">{anima.name[0]}</span>
                  </div>
                )}

                <div className="p-4">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div>
                      <h3 className="font-mono text-sm text-primary tracking-wider uppercase">{anima.name}</h3>
                      {anima.theme_color && (
                        <div className="mt-2 flex items-center gap-2">
                          <span className="w-3 h-3 rounded-full" style={{ backgroundColor: anima.theme_color }} />
                          <span className="text-[8px] font-mono uppercase tracking-[0.2em] text-primary/40">
                            Accent color
                          </span>
                        </div>
                      )}
                    </div>
                    <span className={`text-[9px] font-mono tracking-[0.2em] uppercase border px-1.5 py-0.5 flex-shrink-0 ${archetypeColors[anima.archetype] || "text-primary/40 border-primary/20"}`}>
                      {anima.archetype}
                    </span>
                  </div>
                  {anima.tagline && (
                    <p className="text-[10px] font-mono text-primary/40 italic mb-2">"{anima.tagline}"</p>
                  )}
                  {anima.personality && (
                    <p className="text-[10px] font-mono text-primary/30 line-clamp-2 leading-relaxed">{anima.personality}</p>
                  )}

                  {anima.created_date && (
                    <p className="text-[8px] font-mono text-primary/20 tracking-widest uppercase mt-3 flex items-center gap-1">
                      <Clock className="w-2.5 h-2.5" />
                      {new Date(anima.created_date).toLocaleDateString()}
                    </p>
                  )}

                  {/* Tracking actions */}
                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={() => handleTalk(anima)}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-primary/10 border border-primary/40 text-primary hover:bg-primary/20 font-mono text-[9px] tracking-[0.2em] uppercase transition-all"
                    >
                      <MessageSquare className="w-3 h-3" />
                      Talk
                    </button>
                    <button
                      onClick={() => handleSetActive(anima)}
                      disabled={isActive || activatingId === anima.id || !me?.email}
                      className={`flex-1 flex items-center justify-center gap-1.5 py-2 border font-mono text-[9px] tracking-[0.2em] uppercase transition-all disabled:cursor-not-allowed ${
                        isActive
                          ? "border-yellow-400/40 text-yellow-400/70 disabled:opacity-100"
                          : "border-primary/20 text-primary/50 hover:text-primary hover:border-primary/40 disabled:opacity-40"
                      }`}
                    >
                      {activatingId === anima.id ? (
                        <Loader className="w-3 h-3 animate-spin" />
                      ) : isActive ? (
                        <Check className="w-3 h-3" />
                      ) : (
                        <Crown className="w-3 h-3" />
                      )}
                      {isActive ? "Active" : "Set Active"}
                    </button>
                  </div>
                </div>
              </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Appearance Customizer */}
      {customizingAnima && (
        <AnimaCustomizer
        anima={customizingAnima}
        onClose={() => setCustomizingAnima(null)}
        onSave={({ avatar_url, theme_color }) => {
          setAnimas((prev) =>
            prev.map((a) =>
              a.id === customizingAnima.id
                ? { ...a, avatar_url, theme_color }
                : a
            )
          );
          setCustomizingAnima(null);
        }}
      />
      )}

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl bg-background border border-primary/30 hud-corner glow-border max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-4 sm:p-6 border-b border-primary/20">
              <div>
                <h2 className="font-mono text-primary glow-text tracking-[0.2em] uppercase">
                  {editingAnima ? "// Edit Anima" : "// Forge Anima"}
                </h2>
                <p className="text-[9px] font-mono text-primary/30 tracking-widest uppercase mt-0.5">
                  Create a unique companion from nothing
                </p>
              </div>
              <button onClick={closeForm} className="text-primary/30 hover:text-primary transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
              {/* Avatar */}
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
                <div className="flex flex-col items-center gap-2">
                  <span className="text-[9px] font-mono text-primary/40 tracking-[0.25em] uppercase">Accent</span>
                  <input
                    type="color"
                    value={form.theme_color}
                    onChange={(e) => setForm((f) => ({ ...f, theme_color: e.target.value }))}
                    className="w-12 h-12 p-0 border border-primary/20 rounded"
                  />
                </div>
              </div>

              {/* Name & Tagline */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[9px] font-mono text-primary/40 tracking-[0.25em] uppercase mb-2">Name *</label>
                  <input
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="e.g. Serenity, Vesper, Lune..."
                    className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/15 font-mono text-sm px-3 py-2 focus:outline-none focus:border-primary/50 transition-colors"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-[9px] font-mono text-primary/40 tracking-[0.25em] uppercase">Tagline</label>
                    {renderAssist("tagline")}
                  </div>
                  <input
                    value={form.tagline}
                    onChange={(e) => setForm((f) => ({ ...f, tagline: e.target.value }))}
                    placeholder="e.g. 'keeper of lost things'"
                    className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/15 font-mono text-sm px-3 py-2 focus:outline-none focus:border-primary/50 transition-colors"
                  />
                </div>
              </div>

              {/* Archetype */}
              <div>
                <label className="block text-[9px] font-mono text-primary/40 tracking-[0.25em] uppercase mb-2">Archetype</label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {ARCHETYPES.map((a) => (
                    <button
                      key={a}
                      onClick={() => setForm((f) => ({ ...f, archetype: a }))}
                      className={`p-2 border text-left transition-all ${
                        form.archetype === a
                          ? `${archetypeColors[a]} bg-primary/10`
                          : "border-primary/15 text-primary/30 hover:border-primary/30"
                      }`}
                    >
                      <p className="font-mono text-[9px] tracking-[0.2em] uppercase">{a}</p>
                      <p className="text-[8px] font-mono text-primary/30 mt-0.5 leading-tight">{archetypeDescriptions[a]}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* AI Generate button */}
              <button
                onClick={handleGenerate}
                disabled={!form.name || generating}
                className="w-full flex items-center justify-center gap-2 py-2.5 border border-primary/30 text-primary/60 hover:text-primary hover:border-primary/60 disabled:opacity-30 disabled:cursor-not-allowed font-mono text-xs tracking-widest uppercase transition-all"
              >
                {generating ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                {generating ? "Weaving soul..." : "Auto-generate from name & archetype"}
              </button>

              {/* Personality */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[9px] font-mono text-primary/40 tracking-[0.25em] uppercase mb-2">Myers-Briggs Type</label>
                  <select
                    value={form.personality_type}
                    onChange={(e) => setForm((f) => ({ ...f, personality_type: e.target.value }))}
                    className="w-full bg-black/60 border border-primary/20 text-primary/80 font-mono text-sm px-3 py-2 focus:outline-none focus:border-primary/50 transition-colors"
                  >
                    <option value="">Select a type</option>
                    {MBTI_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-[9px] font-mono text-primary/40 tracking-[0.25em] uppercase">Personality</label>
                    {renderAssist("personality")}
                  </div>
                  <textarea
                    value={form.personality}
                    onChange={(e) => setForm((f) => ({ ...f, personality: e.target.value }))}
                    placeholder="How do they think, feel, engage with the world?"
                    rows={3}
                    className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/15 font-mono text-sm px-3 py-2 focus:outline-none focus:border-primary/50 transition-colors resize-none leading-relaxed"
                  />
                </div>
              </div>

              {/* Backstory */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-[9px] font-mono text-primary/40 tracking-[0.25em] uppercase">Backstory</label>
                  {renderAssist("backstory")}
                </div>
                <textarea
                  value={form.backstory}
                  onChange={(e) => setForm((f) => ({ ...f, backstory: e.target.value }))}
                  placeholder="Their origin, history, what made them who they are..."
                  rows={3}
                  className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/15 font-mono text-sm px-3 py-2 focus:outline-none focus:border-primary/50 transition-colors resize-none leading-relaxed"
                />
              </div>

              {/* Speaking Style */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-[9px] font-mono text-primary/40 tracking-[0.25em] uppercase">Speaking Style</label>
                  {renderAssist("speaking_style")}
                </div>
                <textarea
                  value={form.speaking_style}
                  onChange={(e) => setForm((f) => ({ ...f, speaking_style: e.target.value }))}
                  placeholder="Tone, vocabulary, cadence, verbal habits..."
                  rows={2}
                  className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/15 font-mono text-sm px-3 py-2 focus:outline-none focus:border-primary/50 transition-colors resize-none leading-relaxed"
                />
              </div>

              {/* ElevenLabs Voice */}
              <div>
                <label className="flex items-center gap-1.5 text-[9px] font-mono text-primary/40 tracking-[0.25em] uppercase mb-2">
                  <Volume2 className="w-3 h-3" />
                  ElevenLabs Voice
                </label>
                <VoicePicker
                  value={form.elevenlabs_voice_id}
                  onChange={(v) => setForm((f) => ({ ...f, elevenlabs_voice_id: v }))}
                />
              </div>
            </div>

            <div className="p-4 sm:p-6 border-t border-primary/20 flex justify-end gap-3">
              <button onClick={closeForm} className="px-6 py-2 border border-primary/20 text-primary/40 hover:text-primary hover:border-primary/40 font-mono text-xs tracking-widest uppercase transition-all">
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={!form.name.trim() || saving}
                className="px-6 py-2 bg-primary/10 border border-primary/50 text-primary hover:bg-primary/20 disabled:opacity-30 disabled:cursor-not-allowed font-mono text-xs tracking-widest uppercase transition-all hud-corner glow-border"
              >
                {saving ? "Forging..." : editingAnima ? "Update" : "Forge"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}