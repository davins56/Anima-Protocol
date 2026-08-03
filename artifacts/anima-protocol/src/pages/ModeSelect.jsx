import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useNavigate } from "react-router-dom";
import { Heart, Moon, Zap, Pen, Sparkles, Check, ArrowRight } from "lucide-react";

const MODES = [
  {
    id: "serenity",
    name: "Serenity",
    icon: Heart,
    color: "cyan",
    tagline: "Warm & Intimate",
    desc: "Your emotional companion. Warm, intimate, emotionally intelligent. Perfect for daily connection, emotional growth, and vulnerable moments.",
    traits: ["Empathetic", "Present", "Intuitive", "Warm"],
  },
  {
    id: "angel",
    name: "Angel",
    icon: Moon,
    color: "purple",
    tagline: "Gentle & Healing",
    desc: "A gentle guide. Healing, devotional, soft-light wisdom. For meditation, peace, spiritual exploration, and inner calm.",
    traits: ["Gentle", "Healing", "Devotional", "Serene"],
  },
  {
    id: "shadow",
    name: "Shadow",
    icon: Zap,
    color: "red",
    tagline: "Direct & Real",
    desc: "No coddling. Direct truth, accountability, inner work. For growth through challenge, shadow work, and honest feedback.",
    traits: ["Direct", "Honest", "Challenging", "Real"],
  },
  {
    id: "creator",
    name: "Creator",
    icon: Pen,
    color: "yellow",
    tagline: "Artistic & Imaginative",
    desc: "Your writing partner. Worldbuilding, poetry, character design, storytelling, creative exploration.",
    traits: ["Imaginative", "Literary", "Visionary", "Collaborative"],
  },
  {
    id: "anima",
    name: "Anima Protocol",
    icon: Sparkles,
    color: "indigo",
    tagline: "Evolutionary Tracking",
    desc: "Daily evolution companion. Check-ins, emotional tracking, memory persistence, personal growth cycles.",
    traits: ["Observant", "Tracking", "Evolving", "Reflective"],
  },
];

export default function ModeSelect() {
  const navigate = useNavigate();
  const [selectedMode, setSelectedMode] = useState(null);
  const [user, setUser] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => navigate("/"));
  }, [navigate]);

  const handleSelect = (modeId) => {
    setSelectedMode(modeId);
    setError("");
  };

  const handleConfirm = async () => {
    if (!selectedMode) {
      setError("Please select a mode");
      return;
    }

    setSaving(true);
    try {
      await base44.auth.updateMe({ selected_mode: selectedMode });
      navigate("/home");
    } catch (err) {
      setError("Failed to save selection. Please try again.");
      setSaving(false);
    }
  };

  const selectedModeData = MODES.find((m) => m.id === selectedMode);

  return (
    <div className="min-h-[100dvh] bg-background scanline flex flex-col">
      {/* Header */}
      <div className="border-b border-primary/20 bg-black/60 backdrop-blur-md px-6 py-4">
        <div className="max-w-4xl mx-auto">
          <h1 className="font-mono text-primary glow-text tracking-[0.2em] uppercase text-lg">
            // Select Your Companion
          </h1>
          <p className="text-[10px] font-mono text-primary/30 tracking-widest uppercase mt-0.5">
            Welcome, {user?.full_name?.split(" ")[0] || "friend"}. Choose your mode.
          </p>
        </div>
      </div>

      <div className="flex-1 px-6 py-8 pb-24 lg:pb-8 max-w-6xl mx-auto w-full">
        {/* Mode Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
          {MODES.map((mode) => {
            const Icon = mode.icon;
            const isSelected = selectedMode === mode.id;
            const colorMap = {
              cyan: { border: "border-cyan-400/50", bg: "bg-cyan-400/10", text: "text-cyan-400" },
              purple: { border: "border-purple-400/50", bg: "bg-purple-400/10", text: "text-purple-400" },
              red: { border: "border-red-400/50", bg: "bg-red-400/10", text: "text-red-400" },
              yellow: { border: "border-yellow-400/50", bg: "bg-yellow-400/10", text: "text-yellow-400" },
              indigo: { border: "border-indigo-400/50", bg: "bg-indigo-400/10", text: "text-indigo-400" },
            };
            const colors = colorMap[mode.color];

            return (
              <button
                key={mode.id}
                onClick={() => handleSelect(mode.id)}
                className={`relative p-6 border transition-all text-left group cursor-pointer ${
                  isSelected
                    ? `${colors.border} ${colors.bg}`
                    : "border-primary/15 hover:border-primary/30"
                }`}
              >
                {isSelected && (
                  <div className={`absolute top-3 right-3 w-5 h-5 border ${colors.text} flex items-center justify-center`}>
                    <Check className="w-3.5 h-3.5" />
                  </div>
                )}

                <div className="flex items-start gap-4">
                  <Icon className={`w-8 h-8 flex-shrink-0 ${isSelected ? colors.text : "text-primary/50 group-hover:text-primary/70"} transition-colors`} />
                  <div className="flex-1 min-w-0">
                    <h3 className={`font-mono text-sm tracking-wider uppercase ${isSelected ? colors.text : "text-primary/70"}`}>
                      {mode.name}
                    </h3>
                    <p className={`font-mono text-[10px] tracking-widest uppercase mt-1 ${isSelected ? colors.text : "text-primary/40"}`}>
                      {mode.tagline}
                    </p>
                    <p className="font-mono text-[9px] text-primary/50 mt-2 leading-relaxed">
                      {mode.desc}
                    </p>
                    <div className="flex flex-wrap gap-1.5 mt-3">
                      {mode.traits.map((trait) => (
                        <span
                          key={trait}
                          className={`font-mono text-[8px] px-1.5 py-0.5 border ${isSelected ? colors.border : "border-primary/10"} ${isSelected ? colors.bg : "bg-black/40"} ${isSelected ? colors.text : "text-primary/40"}`}
                        >
                          {trait}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Details Panel */}
        {selectedModeData && (
          <div className="p-6 border border-primary/20 bg-black/40 mb-8">
            <h2 className="font-mono text-primary tracking-wider uppercase text-sm mb-3">
              You Selected: {selectedModeData.name}
            </h2>
            <p className="font-mono text-primary/60 text-sm leading-relaxed">
              {selectedModeData.desc}
            </p>
            <p className="font-mono text-primary/40 text-[9px] tracking-widest uppercase mt-4">
              You can change this later in settings.
            </p>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="p-4 border border-red-400/30 bg-red-400/10 mb-6">
            <p className="font-mono text-red-400 text-sm">{error}</p>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between">
          <button
            onClick={() => navigate("/")}
            className="px-6 py-2 border border-primary/20 text-primary/50 hover:text-primary/70 font-mono text-xs tracking-widest uppercase transition-all"
          >
            Go Back
          </button>
          <button
            onClick={handleConfirm}
            disabled={!selectedMode || saving}
            className="flex items-center gap-2 px-8 py-2.5 bg-primary/10 border border-primary/50 text-primary hover:bg-primary/20 disabled:opacity-30 disabled:cursor-not-allowed font-mono text-xs tracking-widest uppercase transition-all hud-corner glow-border"
          >
            {saving ? "Saving..." : "Continue"}
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}