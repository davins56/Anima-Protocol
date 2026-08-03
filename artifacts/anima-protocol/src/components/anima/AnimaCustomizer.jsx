import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { X, Wand2, Loader, RefreshCw, Check, ChevronRight } from "lucide-react";

const FEATURES = [
  { key: "hair", label: "Hair", placeholder: "e.g. long silver wavy hair with braids", icon: "✦" },
  { key: "outfit", label: "Outfit", placeholder: "e.g. dark hooded cloak with gold trim", icon: "◈" },
  { key: "eyes", label: "Eyes", placeholder: "e.g. glowing violet eyes", icon: "◉" },
  { key: "setting", label: "Setting / Background", placeholder: "e.g. misty forest at twilight", icon: "◐" },
  { key: "mood", label: "Mood / Expression", placeholder: "e.g. serene and mysterious half-smile", icon: "◑" },
  { key: "style", label: "Art Style", placeholder: "e.g. anime illustration, painterly, photorealistic", icon: "◫" },
];

export default function AnimaCustomizer({ anima, onClose, onSave }) {
  const [prompts, setPrompts] = useState({
    hair: "",
    outfit: "",
    eyes: "",
    setting: "",
    mood: "",
    style: "",
  });
  const [generating, setGenerating] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(anima.avatar_url || "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [activeFeature, setActiveFeature] = useState("hair");

  const buildImagePrompt = () => {
    const base = `A character portrait of ${anima.name}, a ${anima.archetype || "guardian"} archetype AI companion.`;
    const personality = anima.personality ? `Personality: ${anima.personality.slice(0, 80)}.` : "";

    const featureParts = FEATURES
      .filter((f) => prompts[f.key]?.trim())
      .map((f) => {
        const labels = {
          hair: `Hair: ${prompts.hair}`,
          outfit: `Outfit: ${prompts.outfit}`,
          eyes: `Eyes: ${prompts.eyes}`,
          setting: `Setting: ${prompts.setting}`,
          mood: `Expression/mood: ${prompts.mood}`,
          style: `Art style: ${prompts.style}`,
        };
        return labels[f.key];
      })
      .join(". ");

    const defaults = [
      !prompts.style && "digital art illustration",
      !prompts.setting && "ethereal atmospheric background",
      !prompts.mood && "confident and captivating expression",
    ].filter(Boolean).join(", ");

    return `${base} ${personality} ${featureParts}. ${defaults}. High quality, detailed, dramatic lighting, character-focused portrait.`.trim();
  };

  const handleGenerate = async () => {
    setGenerating(true);
    const prompt = buildImagePrompt();
    const result = await base44.integrations.Core.GenerateImage({
      prompt,
      existing_image_urls: anima.avatar_url ? [anima.avatar_url] : undefined,
    });
    if (result?.url) setPreviewUrl(result.url);
    setGenerating(false);
  };

  const handleSave = async () => {
    setSaving(true);
    await base44.entities.Anima.update(anima.id, { avatar_url: previewUrl });
    setSaving(false);
    setSaved(true);
    setTimeout(() => {
      onSave(previewUrl);
      onClose();
    }, 800);
  };

  const hasChanges = previewUrl !== anima.avatar_url && previewUrl;
  const hasPrompts = Object.values(prompts).some((v) => v.trim());

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4">
      <div className="w-full max-w-3xl bg-background border border-primary/30 hud-corner glow-border max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-primary/20">
          <div>
            <h2 className="font-mono text-primary glow-text tracking-[0.2em] uppercase text-base">
              // Appearance Forge — {anima.name}
            </h2>
            <p className="text-[9px] font-mono text-primary/30 tracking-widest uppercase mt-0.5">
              Describe each feature and regenerate the avatar
            </p>
          </div>
          <button onClick={onClose} className="text-primary/30 hover:text-primary transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Left: Feature inputs */}
          <div className="w-1/2 border-r border-primary/15 flex flex-col overflow-hidden">
            {/* Feature tabs */}
            <div className="flex overflow-x-auto border-b border-primary/10 flex-shrink-0">
              {FEATURES.map((f) => (
                <button
                  key={f.key}
                  onClick={() => setActiveFeature(f.key)}
                  className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-2.5 font-mono text-[9px] tracking-widest uppercase transition-all border-b-2 ${
                    activeFeature === f.key
                      ? "text-primary border-primary"
                      : "text-primary/30 border-transparent hover:text-primary/60"
                  }`}
                >
                  <span>{f.icon}</span>
                  {f.label}
                  {prompts[f.key]?.trim() && (
                    <span className="w-1.5 h-1.5 rounded-full bg-primary/60 flex-shrink-0" />
                  )}
                </button>
              ))}
            </div>

            {/* Active feature input */}
            <div className="flex-1 p-5 flex flex-col gap-4">
              {FEATURES.filter((f) => f.key === activeFeature).map((feature) => (
                <div key={feature.key} className="flex-1 flex flex-col gap-3">
                  <label className="font-mono text-[9px] text-primary/50 tracking-[0.25em] uppercase flex items-center gap-2">
                    <span>{feature.icon}</span>
                    {feature.label}
                  </label>
                  <textarea
                    value={prompts[feature.key]}
                    onChange={(e) => setPrompts((p) => ({ ...p, [feature.key]: e.target.value }))}
                    placeholder={feature.placeholder}
                    rows={4}
                    className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-sm px-3 py-3 focus:outline-none focus:border-primary/50 transition-colors resize-none leading-relaxed"
                  />
                </div>
              ))}

              {/* Quick suggestions */}
              <div className="space-y-2">
                <p className="font-mono text-[8px] text-primary/30 tracking-widest uppercase">Quick suggestions</p>
                <div className="flex flex-wrap gap-1.5">
                  {getSuggestions(activeFeature).map((s) => (
                    <button
                      key={s}
                      onClick={() => setPrompts((p) => ({ ...p, [activeFeature]: s }))}
                      className="px-2 py-1 border border-primary/15 text-primary/40 hover:text-primary hover:border-primary/40 font-mono text-[9px] tracking-wider transition-all"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              {/* Summary of all set features */}
              <div className="border border-primary/10 bg-primary/5 p-3 space-y-1.5">
                <p className="font-mono text-[8px] text-primary/40 tracking-widest uppercase mb-2">Active customizations</p>
                {FEATURES.map((f) =>
                  prompts[f.key]?.trim() ? (
                    <div key={f.key} className="flex items-start gap-2">
                      <span className="font-mono text-[8px] text-primary/30 uppercase w-14 flex-shrink-0 pt-0.5">{f.label}</span>
                      <span className="font-mono text-[9px] text-primary/60 leading-relaxed">{prompts[f.key]}</span>
                      <button
                        onClick={() => setPrompts((p) => ({ ...p, [f.key]: "" }))}
                        className="text-primary/20 hover:text-primary/60 flex-shrink-0 ml-auto"
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  ) : null
                )}
                {!hasPrompts && (
                  <p className="font-mono text-[9px] text-primary/20 italic">No customizations set yet</p>
                )}
              </div>
            </div>
          </div>

          {/* Right: Preview */}
          <div className="w-1/2 flex flex-col">
            <div className="flex-1 bg-black/40 relative overflow-hidden flex items-center justify-center">
              {previewUrl ? (
                <img
                  src={previewUrl}
                  alt={anima.name}
                  className={`w-full h-full object-cover transition-opacity duration-500 ${generating ? "opacity-30" : "opacity-100"}`}
                />
              ) : (
                <div className="flex flex-col items-center gap-3 text-center p-8">
                  <div className="w-16 h-16 border border-primary/20 bg-primary/5 flex items-center justify-center">
                    <span className="font-mono text-primary/20 text-3xl">{anima.name[0]}</span>
                  </div>
                  <p className="font-mono text-[10px] text-primary/20 tracking-widest uppercase">No avatar yet</p>
                </div>
              )}

              {generating && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/40">
                  <Loader className="w-8 h-8 text-primary animate-spin" />
                  <p className="font-mono text-[10px] text-primary/60 tracking-widest uppercase animate-pulse">
                    Generating appearance...
                  </p>
                </div>
              )}

              {/* Preview label */}
              {previewUrl && !generating && (
                <div className="absolute top-2 left-2 bg-black/70 border border-primary/20 px-2 py-1">
                  <p className="font-mono text-[8px] text-primary/50 tracking-widest uppercase">
                    {hasChanges ? "● New Preview" : "Current Avatar"}
                  </p>
                </div>
              )}
            </div>

            {/* Action buttons */}
            <div className="p-4 border-t border-primary/15 space-y-3">
              <button
                onClick={handleGenerate}
                disabled={generating}
                className="w-full flex items-center justify-center gap-2 py-3 bg-primary/10 border border-primary/40 text-primary hover:bg-primary/20 disabled:opacity-40 disabled:cursor-not-allowed font-mono text-xs tracking-widest uppercase transition-all hud-corner"
              >
                {generating ? (
                  <><Loader className="w-4 h-4 animate-spin" /> Generating...</>
                ) : (
                  <><Wand2 className="w-4 h-4" /> Generate Avatar</>
                )}
              </button>

              {hasChanges && (
                <button
                  onClick={handleSave}
                  disabled={saving || saved}
                  className={`w-full flex items-center justify-center gap-2 py-2.5 border font-mono text-xs tracking-widest uppercase transition-all ${
                    saved
                      ? "border-green-400/50 bg-green-400/10 text-green-400"
                      : "border-primary/50 bg-primary/5 text-primary hover:bg-primary/15"
                  }`}
                >
                  {saved ? (
                    <><Check className="w-4 h-4" /> Saved!</>
                  ) : saving ? (
                    <><Loader className="w-4 h-4 animate-spin" /> Saving...</>
                  ) : (
                    <><Check className="w-4 h-4" /> Apply & Save</>
                  )}
                </button>
              )}

              <p className="font-mono text-[8px] text-primary/20 tracking-widest text-center">
                Fill feature prompts on the left → Generate → Save
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function getSuggestions(feature) {
  const map = {
    hair: ["long silver wavy", "short dark pixie cut", "wild crimson curls", "flowing white with starlight", "sleek obsidian braid", "auburn waves"],
    outfit: ["dark enchantress robes", "futuristic bodysuit", "ethereal white gown", "armored warrior plate", "casual streetwear", "flowing forest cloak"],
    eyes: ["glowing violet", "deep ocean blue", "golden amber", "silver starlight", "crimson red", "emerald green with slit pupils"],
    setting: ["misty enchanted forest", "futuristic neon cityscape", "ancient temple ruins", "starfield cosmos", "candlelit library", "twilight seaside"],
    mood: ["serene and mysterious", "fierce and determined", "warm and welcoming", "melancholic and distant", "playful smirk", "calm authority"],
    style: ["anime illustration", "painterly oil", "photorealistic", "watercolor fantasy", "dark gothic art", "cel-shaded comic"],
  };
  return map[feature] || [];
}