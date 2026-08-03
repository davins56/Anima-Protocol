import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Loader, Save, Wand2, AlertTriangle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function AIBehaviorDashboard({ characterId, characterName }) {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [autoConfiguring, setAutoConfiguring] = useState(false);
  const [showAgeGate, setShowAgeGate] = useState(false);
  const [pendingMatureChange, setPendingMatureChange] = useState(null); // { field, value }
  const [ageVerified, setAgeVerified] = useState(() => localStorage.getItem("anima_age_verified_mature") === "true");

  useEffect(() => {
    loadConfig();
  }, [characterId]);

  const loadConfig = async () => {
    setLoading(true);
    try {
      const configs = await base44.entities.AIBehaviorConfig.filter({
        character_id: characterId,
      });
      if (configs?.length > 0) {
        setConfig(configs[0]);
      } else {
        const newConfig = await base44.entities.AIBehaviorConfig.create({
          character_id: characterId,
          verbosity: 50,
          emotional_intensity: 60,
          lore_compliance: 70,
        });
        setConfig(newConfig);
      }
    } catch (err) {
      console.error("Error loading config:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    try {
      await base44.entities.AIBehaviorConfig.update(config.id, {
        verbosity: config.verbosity,
        emotional_intensity: config.emotional_intensity,
        lore_compliance: config.lore_compliance,
        vibrato: config.vibrato,
        lewdity: config.lewdity,
        sexuality: config.sexuality,
        humor: config.humor,
        sarcasm: config.sarcasm,
        aggressiveness: config.aggressiveness,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error("Error saving config:", err);
    } finally {
      setSaving(false);
    }
  };

  const MATURE_FIELDS = ["lewdity", "sexuality"];

  const updateValue = (field, value) => {
    // If it's a mature field and user hasn't verified age, show gate
    if (MATURE_FIELDS.includes(field) && value > 0 && !ageVerified) {
      setPendingMatureChange({ field, value });
      setShowAgeGate(true);
      return;
    }
    setConfig((prev) => ({ ...prev, [field]: value }));
    setSaved(false);
  };

  const handleAgeConfirm = () => {
    localStorage.setItem("anima_age_verified_mature", "true");
    setAgeVerified(true);
    setShowAgeGate(false);
    if (pendingMatureChange) {
      setConfig((prev) => ({ ...prev, [pendingMatureChange.field]: pendingMatureChange.value }));
      setSaved(false);
      setPendingMatureChange(null);
    }
  };

  const handleAgeCancel = () => {
    setShowAgeGate(false);
    setPendingMatureChange(null);
  };

  const handleAutoConfig = async () => {
    setAutoConfiguring(true);
    try {
      const result = await base44.functions.invoke("analyzeCharacterForBehavior", {
        character_name: characterName,
      });

      if (result?.data) {
        const traits = result.data;
        setConfig((prev) => ({
          ...prev,
          verbosity: traits.verbosity || 50,
          emotional_intensity: traits.emotional_intensity || 60,
          lore_compliance: traits.lore_compliance || 70,
          vibrato: traits.vibrato || 50,
          lewdity: traits.lewdity || 30,
          sexuality: traits.sexuality || 40,
          humor: traits.humor || 50,
          sarcasm: traits.sarcasm || 40,
          aggressiveness: traits.aggressiveness || 30,
        }));
        setSaved(false);
      }
    } catch (err) {
      console.error("Error analyzing character:", err);
    } finally {
      setAutoConfiguring(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader className="w-5 h-5 text-primary/60 animate-spin" />
      </div>
    );
  }

  if (!config) return null;

  const sliders = [
    {
      id: "verbosity",
      label: "Verbosity",
      icon: "💬",
      description: "How detailed vs. concise the AI responds",
      min: "Concise",
      max: "Verbose",
      value: config.verbosity,
    },
    {
      id: "emotional_intensity",
      label: "Emotional Intensity",
      icon: "❤️",
      description: "How emotionally expressive vs. neutral",
      min: "Stoic",
      max: "Emotional",
      value: config.emotional_intensity,
    },
    {
      id: "lore_compliance",
      label: "Lore Compliance",
      icon: "📖",
      description: "How strictly to follow established world facts",
      min: "Flexible",
      max: "Strict",
      value: config.lore_compliance,
    },
    {
      id: "vibrato",
      label: "Vibrato",
      icon: "🎵",
      description: "Expressiveness and variation in vocal/writing delivery",
      min: "Monotone",
      max: "Expressive",
      value: config.vibrato,
    },
    {
      id: "lewdity",
      label: "Lewdity",
      icon: "🔞",
      description: "Level of explicit/suggestive content",
      min: "Family-Friendly",
      max: "Explicit",
      value: config.lewdity,
    },
    {
      id: "sexuality",
      label: "Sexuality",
      icon: "💋",
      description: "How openly sexual or flirtatious in interactions",
      min: "Neutral",
      max: "Flirtatious",
      value: config.sexuality,
    },
    {
      id: "humor",
      label: "Humor",
      icon: "😄",
      description: "Tendency to make jokes and be comedic",
      min: "Serious",
      max: "Comedic",
      value: config.humor,
    },
    {
      id: "sarcasm",
      label: "Sarcasm",
      icon: "😏",
      description: "Use of sarcasm and ironic expressions",
      min: "Sincere",
      max: "Sarcastic",
      value: config.sarcasm,
    },
    {
      id: "aggressiveness",
      label: "Aggressiveness",
      icon: "⚡",
      description: "How confrontational or hostile in tone",
      min: "Gentle",
      max: "Hostile",
      value: config.aggressiveness,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="mb-6 flex items-start justify-between">
        <div className="flex-1">
          <h2 className="font-mono text-sm text-primary tracking-wider uppercase mb-1">
            {characterName}
          </h2>
          <p className="font-mono text-[9px] text-primary/40">
            Fine-tune AI behavior for this character
          </p>
        </div>
        <button
          onClick={handleAutoConfig}
          disabled={autoConfiguring}
          title="Analyze character and auto-configure sliders"
          className="ml-3 flex items-center gap-1.5 px-2.5 py-1.5 border border-cyan-400/30 bg-cyan-400/5 text-cyan-400 hover:bg-cyan-400/10 disabled:opacity-50 font-mono text-[8px] tracking-widest uppercase rounded transition-all flex-shrink-0"
        >
          {autoConfiguring ? (
            <>
              <Loader className="w-3 h-3 animate-spin" />
              <span className="hidden sm:inline">Analyzing</span>
            </>
          ) : (
            <>
              <Wand2 className="w-3 h-3" />
              <span className="hidden sm:inline">Auto-Configure</span>
            </>
          )}
        </button>
      </div>

      <div className="max-h-96 overflow-y-auto space-y-5 pr-2">
        {sliders.map((slider) => (
          <motion.div
            key={slider.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-4 border border-primary/20 bg-black/40 rounded hover:border-primary/30 transition-colors"
          >
            <div className="flex items-start justify-between mb-3">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-lg">{slider.icon}</span>
                  <h3 className="font-mono text-xs text-primary tracking-wider uppercase">
                    {slider.label}
                  </h3>
                </div>
                <p className="text-[8px] font-mono text-primary/40">
                  {slider.description}
                </p>
              </div>
              <span className="font-mono text-lg text-primary/80 w-10 text-right">
                {slider.value}
              </span>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-[8px] font-mono text-primary/50 w-14 text-right">
                {slider.min}
              </span>
              <input
                type="range"
                min="0"
                max="100"
                step="5"
                value={slider.value}
                onChange={(e) =>
                  updateValue(slider.id, parseInt(e.target.value))
                }
                className="flex-1 accent-primary cursor-pointer"
              />
              <span className="text-[8px] font-mono text-primary/50 w-14">
                {slider.max}
              </span>
            </div>

            {/* Mini visualization */}
            <div className="mt-2 h-1 bg-black/60 rounded overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-primary/40 to-primary transition-all"
                style={{ width: `${slider.value}%` }}
              />
            </div>
          </motion.div>
        ))}
      </div>

      {/* Save Button */}
      <motion.button
        onClick={handleSave}
        disabled={saving || saved}
        animate={saved ? { scale: 1 } : {}}
        className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 font-mono text-xs tracking-widest uppercase rounded transition-all ${
          saved
            ? "bg-green-900/20 border border-green-500/40 text-green-400"
            : "bg-primary/10 border border-primary/40 text-primary hover:bg-primary/20 disabled:opacity-50"
        }`}
      >
        <Save className="w-4 h-4" />
        {saved ? "Saved!" : saving ? "Saving..." : "Save Configuration"}
      </motion.button>

      {/* Info */}
      <div className="p-3 border border-primary/15 bg-primary/5 rounded mt-2">
        <p className="text-[8px] font-mono text-primary/50 leading-relaxed">
          Fine-tune how your character behaves—from tone and humor to content maturity. These settings directly influence AI responses during conversations.
        </p>
      </div>

      {/* Age Verification Modal */}
      <AnimatePresence>
        {showAgeGate && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm p-4"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-sm bg-background border border-rose-500/40 p-6 space-y-4"
            >
              <div className="flex items-center gap-3">
                <AlertTriangle className="w-5 h-5 text-rose-400 flex-shrink-0" />
                <h2 className="font-mono text-rose-400 tracking-[0.2em] uppercase text-sm">Age Verification Required</h2>
              </div>

              <div className="border border-rose-500/20 bg-rose-950/30 px-4 py-3">
                <p className="font-mono text-[10px] text-rose-300/80 tracking-wider leading-relaxed">
                  You are adjusting a mature content setting (<span className="text-rose-400 font-bold">{pendingMatureChange?.field}</span>). This controls explicit or sexual AI-generated content.
                </p>
              </div>

              <p className="font-mono text-xs text-primary/60 leading-relaxed">
                By continuing, you confirm that you are{" "}
                <span className="text-rose-400 font-bold">18 years of age or older</span>{" "}
                and consent to enabling mature AI content for this character.
              </p>

              <div className="flex gap-3 pt-1">
                <button
                  onClick={handleAgeCancel}
                  className="flex-1 px-4 py-2 border border-primary/20 text-primary/50 hover:text-primary hover:border-primary/40 font-mono text-xs tracking-widest uppercase transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAgeConfirm}
                  className="flex-1 px-4 py-2 bg-rose-900/30 border border-rose-500/60 text-rose-400 hover:bg-rose-900/50 font-mono text-xs tracking-widest uppercase transition-all"
                >
                  I Am 18+ — Confirm
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}