import { useSearchParams, useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import PortraitUploader from "@/components/character/PortraitUploader";
import { ChevronLeft, Loader, Save, Sparkles, Users, X } from "lucide-react";
import { motion } from "framer-motion";

const BUILD_OPTIONS = ["slim", "average", "athletic", "stocky", "tall", "petite", "other"];

export default function CharacterLookCustomizer() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const characterId = searchParams.get("character");
  const [tab, setTab] = useState(searchParams.get("tab") || "characters");

  const [characters, setCharacters] = useState([]);
  const [animas, setAnimas] = useState([]);
  const [customLook, setCustomLook] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    portrait_url: "",
    hair_color: "",
    eye_color: "",
    build: "average",
    distinguishing_features: [],
    clothing_style: "",
    age_appearance: "",
    skin_tone: "",
    notes: "",
  });

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (characterId) {
      loadCustomLook(characterId);
    }
  }, [characterId]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [chars, animaList] = await Promise.all([
        base44.entities.Character.list("-created_date", 100),
        base44.entities.Anima.list("-created_date", 100),
      ]);
      setCharacters(chars || []);
      setAnimas(animaList || []);

      if (!characterId && chars?.length > 0) {
        navigate(`?character=${chars[0].id}&tab=characters`);
      }
    } catch (err) {
      console.error("Error loading data:", err);
    } finally {
      setLoading(false);
    }
  };

  const loadCustomLook = async (charId) => {
    try {
      const looks = await base44.entities.CustomLook.filter({
        character_id: charId,
        is_active: true,
      });

      if (looks?.length > 0) {
        const look = looks[0];
        setCustomLook(look);
        setForm({
          portrait_url: look.portrait_url || "",
          hair_color: look.hair_color || "",
          eye_color: look.eye_color || "",
          build: look.build || "average",
          distinguishing_features: look.distinguishing_features || [],
          clothing_style: look.clothing_style || "",
          age_appearance: look.age_appearance || "",
          skin_tone: look.skin_tone || "",
          notes: look.notes || "",
        });
      } else {
        setCustomLook(null);
        setForm({
          portrait_url: "",
          hair_color: "",
          eye_color: "",
          build: "average",
          distinguishing_features: [],
          clothing_style: "",
          age_appearance: "",
          skin_tone: "",
          notes: "",
        });
      }
    } catch (err) {
      console.error("Error loading custom look:", err);
    }
  };

  const handleSave = async () => {
    if (!characterId) return;
    setSaving(true);

    try {
      const data = {
        character_id: characterId,
        ...form,
        is_active: true,
      };

      if (customLook) {
        await base44.entities.CustomLook.update(customLook.id, data);
      } else {
        await base44.entities.CustomLook.create(data);
      }

      await loadCustomLook(characterId);
      setSaving(false);
    } catch (err) {
      console.error("Error saving look:", err);
      setSaving(false);
    }
  };

  const handleAddFeature = () => {
    setForm({
      ...form,
      distinguishing_features: [...form.distinguishing_features, ""],
    });
  };

  const handleRemoveFeature = (idx) => {
    setForm({
      ...form,
      distinguishing_features: form.distinguishing_features.filter(
        (_, i) => i !== idx
      ),
    });
  };

  const handleUpdateFeature = (idx, value) => {
    const updated = [...form.distinguishing_features];
    updated[idx] = value;
    setForm({ ...form, distinguishing_features: updated });
  };

  const handleSelectCharacter = (charId) => {
    setSearchParams({ character: charId, tab: "characters" });
    setTab("characters");
  };

  const handleSelectAnima = (animaId) => {
    setSearchParams({ character: animaId, tab: "animas" });
    setTab("animas");
  };

  const list = tab === "characters" ? characters : animas;
  const selectedChar = list.find((c) => c.id === characterId);

  return (
    <div className="min-h-screen bg-background p-4 sm:p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate("/")}
            className="lg:hidden text-primary/40 hover:text-primary transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="flex-1">
            <h1 className="font-mono text-2xl sm:text-3xl text-primary glow-text tracking-[0.2em] uppercase">
              // Custom Looks
            </h1>
            <p className="text-[10px] font-mono text-primary/50 mt-1 tracking-widest">
              Upload portraits and customize visual appearance
            </p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 border-b border-primary/10">
          <button
            onClick={() => {
              setTab("characters");
              setSearchParams({ tab: "characters" });
            }}
            className={`flex items-center gap-2 px-4 py-3 border-b-2 font-mono text-[9px] tracking-widest uppercase transition-all ${
              tab === "characters"
                ? "border-primary text-primary"
                : "border-transparent text-primary/40 hover:text-primary/70"
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            Characters
          </button>
          <button
            onClick={() => {
              setTab("animas");
              setSearchParams({ tab: "animas" });
            }}
            className={`flex items-center gap-2 px-4 py-3 border-b-2 font-mono text-[9px] tracking-widest uppercase transition-all ${
              tab === "animas"
                ? "border-primary text-primary"
                : "border-transparent text-primary/40 hover:text-primary/70"
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            Animas (Serenity)
          </button>
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center h-96">
            <div className="text-center space-y-2">
              <Loader className="w-6 h-6 text-primary/40 animate-spin mx-auto" />
              <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase">
                Loading...
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            {/* Sidebar */}
            <div className="lg:col-span-1 border border-primary/20 bg-black/30 rounded p-4 h-fit max-h-96 overflow-y-auto">
              <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase mb-3">
                {tab === "characters" ? "Characters" : "Animas"}
              </p>
              <div className="space-y-2">
                {list.map((char) => (
                  <button
                    key={char.id}
                    onClick={() =>
                      tab === "characters"
                        ? handleSelectCharacter(char.id)
                        : handleSelectAnima(char.id)
                    }
                    className={`w-full text-left p-2.5 border rounded transition-all ${
                      characterId === char.id
                        ? "border-primary/40 bg-primary/10"
                        : "border-primary/15 bg-black/40 hover:border-primary/25"
                    }`}
                  >
                    <p className="font-mono text-[9px] text-primary/80 tracking-wider uppercase truncate">
                      {char.name}
                    </p>
                  </button>
                ))}
              </div>
            </div>

            {/* Editor */}
            <div className="lg:col-span-3">
              {selectedChar ? (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-6"
                >
                  {/* Header */}
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="font-mono text-lg text-primary tracking-widest uppercase">
                        {selectedChar.name}'s Look
                      </h2>
                      <p className="text-[9px] font-mono text-primary/50 mt-1">
                        {customLook ? "Editing existing look" : "Create new custom look"}
                      </p>
                    </div>
                    <button
                      onClick={handleSave}
                      disabled={saving}
                      className="flex items-center gap-2 px-4 py-2 bg-green-900/30 border border-green-400/40 text-green-400 hover:bg-green-900/50 disabled:opacity-50 transition-all font-mono text-[9px] tracking-widest uppercase"
                    >
                      <Save className="w-3.5 h-3.5" />
                      {saving ? "Saving..." : "Save Look"}
                    </button>
                  </div>

                  {/* Form Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Portrait */}
                    <div>
                      <PortraitUploader
                        currentUrl={form.portrait_url}
                        onUploadSuccess={(url) =>
                          setForm({ ...form, portrait_url: url })
                        }
                      />
                    </div>

                    {/* Attributes */}
                    <div className="space-y-4">
                      {/* Hair Color */}
                      <div>
                        <label className="text-[9px] font-mono text-primary/40 tracking-widest uppercase block mb-2">
                          Hair Color
                        </label>
                        <input
                          type="text"
                          value={form.hair_color}
                          onChange={(e) =>
                            setForm({ ...form, hair_color: e.target.value })
                          }
                          placeholder="e.g., Dark brown, silver streaks"
                          className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-[9px] px-3 py-2 focus:outline-none focus:border-primary/40 transition-colors"
                        />
                      </div>

                      {/* Eye Color */}
                      <div>
                        <label className="text-[9px] font-mono text-primary/40 tracking-widest uppercase block mb-2">
                          Eye Color
                        </label>
                        <input
                          type="text"
                          value={form.eye_color}
                          onChange={(e) =>
                            setForm({ ...form, eye_color: e.target.value })
                          }
                          placeholder="e.g., Bright blue, amber"
                          className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-[9px] px-3 py-2 focus:outline-none focus:border-primary/40 transition-colors"
                        />
                      </div>

                      {/* Skin Tone */}
                      <div>
                        <label className="text-[9px] font-mono text-primary/40 tracking-widest uppercase block mb-2">
                          Skin Tone
                        </label>
                        <input
                          type="text"
                          value={form.skin_tone}
                          onChange={(e) =>
                            setForm({ ...form, skin_tone: e.target.value })
                          }
                          placeholder="e.g., Fair, deep brown"
                          className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-[9px] px-3 py-2 focus:outline-none focus:border-primary/40 transition-colors"
                        />
                      </div>

                      {/* Age Appearance */}
                      <div>
                        <label className="text-[9px] font-mono text-primary/40 tracking-widest uppercase block mb-2">
                          Apparent Age
                        </label>
                        <input
                          type="number"
                          value={form.age_appearance}
                          onChange={(e) =>
                            setForm({ ...form, age_appearance: e.target.value })
                          }
                          placeholder="e.g., 28"
                          className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-[9px] px-3 py-2 focus:outline-none focus:border-primary/40 transition-colors"
                        />
                      </div>

                      {/* Build */}
                      <div>
                        <label className="text-[9px] font-mono text-primary/40 tracking-widest uppercase block mb-2">
                          Build
                        </label>
                        <select
                          value={form.build}
                          onChange={(e) =>
                            setForm({ ...form, build: e.target.value })
                          }
                          className="w-full bg-black/60 border border-primary/20 text-primary/80 font-mono text-[9px] px-3 py-2 focus:outline-none focus:border-primary/40 transition-colors"
                        >
                          {BUILD_OPTIONS.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* Clothing Style */}
                  <div>
                    <label className="text-[9px] font-mono text-primary/40 tracking-widest uppercase block mb-2">
                      Clothing Style
                    </label>
                    <textarea
                      value={form.clothing_style}
                      onChange={(e) =>
                        setForm({ ...form, clothing_style: e.target.value })
                      }
                      placeholder="Typical outfit, dress code, accessories..."
                      rows={3}
                      className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-[9px] px-3 py-2 focus:outline-none focus:border-primary/40 transition-colors resize-none"
                    />
                  </div>

                  {/* Distinguishing Features */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-[9px] font-mono text-primary/40 tracking-widest uppercase">
                        Distinguishing Features
                      </label>
                      <button
                        onClick={handleAddFeature}
                        className="text-[8px] font-mono text-primary/60 hover:text-primary transition-colors tracking-widest uppercase border-b border-primary/30"
                      >
                        + Add
                      </button>
                    </div>
                    <div className="space-y-2">
                      {form.distinguishing_features.map((feature, idx) => (
                        <div key={idx} className="flex gap-2">
                          <input
                            type="text"
                            value={feature}
                            onChange={(e) =>
                              handleUpdateFeature(idx, e.target.value)
                            }
                            placeholder="e.g., Scar on left cheek, silver ring"
                            className="flex-1 bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-[9px] px-3 py-1.5 focus:outline-none focus:border-primary/40 transition-colors"
                          />
                          <button
                            onClick={() => handleRemoveFeature(idx)}
                            className="text-primary/40 hover:text-red-400 transition-colors"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Notes */}
                  <div>
                    <label className="text-[9px] font-mono text-primary/40 tracking-widest uppercase block mb-2">
                      Additional Notes
                    </label>
                    <textarea
                      value={form.notes}
                      onChange={(e) =>
                        setForm({ ...form, notes: e.target.value })
                      }
                      placeholder="Any other visual details or reminders..."
                      rows={3}
                      className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-[9px] px-3 py-2 focus:outline-none focus:border-primary/40 transition-colors resize-none"
                    />
                  </div>
                </motion.div>
              ) : (
                <div className="flex items-center justify-center h-96 border border-primary/20 bg-black/30 rounded">
                  <p className="font-mono text-[10px] text-primary/40 tracking-widest uppercase">
                    Select a {tab === "characters" ? "character" : "anima"} to customize
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Info */}
        <div className="p-4 border border-primary/15 bg-black/40 rounded space-y-2">
          <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase">
            💡 How Custom Looks Work
          </p>
          <ul className="text-[9px] font-mono text-primary/60 space-y-1 ml-4">
            <li>• <strong>Portrait:</strong> Upload a custom character image</li>
            <li>• <strong>Attributes:</strong> Define hair, eyes, build, clothing, distinguishing features</li>
            <li>• <strong>Override Defaults:</strong> Custom looks replace AI-generated imagery</li>
            <li>• <strong>Multiple Looks:</strong> Create different looks and activate them</li>
            <li>• <strong>Serenity:</strong> Customize the companion AI's appearance too</li>
          </ul>
        </div>
      </div>
    </div>
  );
}