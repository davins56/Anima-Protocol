import { useState } from "react";
<<<<<<< HEAD
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
  const [themeColor, setThemeColor] = useState(anima.theme_color || "#00e5e5");
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
    await base44.entities.Anima.update(anima.id, {
      avatar_url: previewUrl,
      theme_color: themeColor,
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => {
      onSave({ avatar_url: previewUrl, theme_color: themeColor });
      onClose();
    }, 800);
  };

  const hasChanges = (previewUrl !== anima.avatar_url && previewUrl) || themeColor !== (anima.theme_color || "#00e5e5");
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
=======
import { base44, uploadDataUrl } from "@/api/base44Client";
import {
  APPEARANCE_FEATURES,
  buildAppearanceImagePrompt,
  getAppearanceSuggestions,
  normalizeAppearancePrompts,
} from "@/lib/animaAppearance";
import { X, Wand2, Loader, Check, Palette } from "lucide-react";

const THEME_PRESETS = [
  "#00e5e5",
  "#a78bfa",
  "#f472b6",
  "#fbbf24",
  "#34d399",
  "#fb7185",
  "#60a5fa",
  "#e2e8f0",
];

/**
 * Customise the look of a personal Anima.
 * @param {{ anima: object, onClose?: () => void, onSave?: (patch: object) => void, variant?: "modal" | "page" }} props
 */
export default function AnimaCustomizer({
  anima,
  onClose,
  onSave,
  variant = "modal",
}) {
  const [prompts, setPrompts] = useState(() =>
    normalizeAppearancePrompts(anima?.appearance_prompts),
  );
  const [generating, setGenerating] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(anima?.avatar_url || "");
  const [themeColor, setThemeColor] = useState(anima?.theme_color || "#00e5e5");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [activeFeature, setActiveFeature] = useState("hair");
  const [error, setError] = useState("");

  const isPage = variant === "page";

  const handleGenerate = async () => {
    setGenerating(true);
    setError("");
    setSaved(false);
    try {
      const prompt = buildAppearanceImagePrompt(anima, prompts);
      const result = await base44.integrations.Core.GenerateImage({
        prompt,
        existing_image_urls: anima?.avatar_url ? [anima.avatar_url] : undefined,
      });
      if (!result?.url) {
        throw new Error("No image was returned. Try again in a moment.");
      }
      setPreviewUrl(result.url);
    } catch (err) {
      if (err?.name === "AbortError") return;
      const msg =
        err?.code === "content_policy"
          ? "That look was blocked by the safety filter. Try a different description."
          : err?.code === "rate_limit"
            ? "The image service is busy right now. Please try again shortly."
            : err?.code === "auth_error"
              ? "Image generation is temporarily unavailable. Please try again later."
              : err?.message || "Failed to generate appearance.";
      setError(msg);
    } finally {
      setGenerating(false);
    }
  };

  const handleSave = async () => {
    if (!anima?.id) return;
    setSaving(true);
    setError("");
    try {
      let avatar_url = previewUrl;
      // Persist generated/edited portraits to object storage instead of storing
      // large base64 blobs on the Anima entity.
      if (typeof avatar_url === "string" && avatar_url.startsWith("data:")) {
        avatar_url = await uploadDataUrl(avatar_url);
      }

      const patch = {
        avatar_url,
        theme_color: themeColor,
        appearance_prompts: normalizeAppearancePrompts(prompts),
      };
      await base44.entities.Anima.update(anima.id, patch);
      setPreviewUrl(avatar_url);
      setSaved(true);
      onSave?.(patch);
      if (!isPage) {
        setTimeout(() => onClose?.(), 800);
      }
    } catch (err) {
      setError(err?.message || "Failed to save appearance.");
    } finally {
      setSaving(false);
    }
  };

  const hasPromptChanges = APPEARANCE_FEATURES.some(
    (f) =>
      (prompts[f.key] || "").trim() !==
      (anima?.appearance_prompts?.[f.key] || "").trim(),
  );
  const hasAvatarChange =
    Boolean(previewUrl) && previewUrl !== (anima?.avatar_url || "");
  const hasThemeChange = themeColor !== (anima?.theme_color || "#00e5e5");
  const hasChanges = hasAvatarChange || hasThemeChange || hasPromptChanges;
  const hasPrompts = Object.values(prompts).some((v) => v.trim());

  const shellClass = isPage
    ? "w-full bg-background border border-primary/30 hud-corner glow-border flex flex-col"
    : "w-full max-w-3xl bg-background border border-primary/30 hud-corner glow-border max-h-[92vh] flex flex-col";

  const body = (
    <div className={shellClass}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-primary/20">
        <div className="min-w-0">
          <h2 className="font-mono text-primary glow-text tracking-[0.2em] uppercase text-sm sm:text-base truncate">
            // Customise Anima — {anima?.name || "Your Anima"}
          </h2>
          <p className="text-[9px] font-mono text-primary/30 tracking-widest uppercase mt-0.5">
            Shape hair, outfit, eyes & more · then generate a new look
          </p>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="text-primary/30 hover:text-primary transition-colors flex-shrink-0 ml-3"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      <div className="flex flex-1 overflow-hidden flex-col md:flex-row min-h-0">
        {/* Left: Feature inputs */}
        <div className="md:w-1/2 border-b md:border-b-0 md:border-r border-primary/15 flex flex-col overflow-hidden min-h-[280px] md:min-h-0">
          <div className="flex overflow-x-auto border-b border-primary/10 flex-shrink-0">
            {APPEARANCE_FEATURES.map((f) => (
              <button
                key={f.key}
                type="button"
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

          <div className="flex-1 p-4 sm:p-5 flex flex-col gap-4 overflow-y-auto">
            {APPEARANCE_FEATURES.filter((f) => f.key === activeFeature).map(
              (feature) => (
                <div key={feature.key} className="flex flex-col gap-3">
>>>>>>> origin/main
                  <label className="font-mono text-[9px] text-primary/50 tracking-[0.25em] uppercase flex items-center gap-2">
                    <span>{feature.icon}</span>
                    {feature.label}
                  </label>
                  <textarea
                    value={prompts[feature.key]}
<<<<<<< HEAD
                    onChange={(e) => setPrompts((p) => ({ ...p, [feature.key]: e.target.value }))}
=======
                    onChange={(e) =>
                      setPrompts((p) => ({
                        ...p,
                        [feature.key]: e.target.value,
                      }))
                    }
>>>>>>> origin/main
                    placeholder={feature.placeholder}
                    rows={4}
                    className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-sm px-3 py-3 focus:outline-none focus:border-primary/50 transition-colors resize-none leading-relaxed"
                  />
                </div>
<<<<<<< HEAD
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
=======
              ),
            )}

            <div className="space-y-2">
              <p className="font-mono text-[8px] text-primary/30 tracking-widest uppercase">
                Quick suggestions
              </p>
              <div className="flex flex-wrap gap-1.5">
                {getAppearanceSuggestions(activeFeature).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() =>
                      setPrompts((p) => ({ ...p, [activeFeature]: s }))
                    }
                    className="px-2 py-1 border border-primary/15 text-primary/40 hover:text-primary hover:border-primary/40 font-mono text-[9px] tracking-wider transition-all"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            <div className="border border-primary/10 bg-primary/5 p-3 space-y-1.5">
              <p className="font-mono text-[8px] text-primary/40 tracking-widest uppercase mb-2">
                Active customizations
              </p>
              {APPEARANCE_FEATURES.map((f) =>
                prompts[f.key]?.trim() ? (
                  <div key={f.key} className="flex items-start gap-2">
                    <span className="font-mono text-[8px] text-primary/30 uppercase w-14 flex-shrink-0 pt-0.5">
                      {f.label}
                    </span>
                    <span className="font-mono text-[9px] text-primary/60 leading-relaxed">
                      {prompts[f.key]}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setPrompts((p) => ({ ...p, [f.key]: "" }))
                      }
                      className="text-primary/20 hover:text-primary/60 flex-shrink-0 ml-auto"
                      aria-label={`Clear ${f.label}`}
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </div>
                ) : null,
              )}
              {!hasPrompts && (
                <p className="font-mono text-[9px] text-primary/20 italic">
                  No customizations set yet — pick a feature or use a suggestion
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Right: Preview */}
        <div className="md:w-1/2 flex flex-col min-h-[320px]">
          <div className="flex-1 bg-black/40 relative overflow-hidden flex items-center justify-center min-h-[220px]">
            {previewUrl ? (
              <img
                src={previewUrl}
                alt={anima?.name || "Anima"}
                className={`w-full h-full object-cover transition-opacity duration-500 ${generating ? "opacity-30" : "opacity-100"}`}
              />
            ) : (
              <div className="flex flex-col items-center gap-3 text-center p-8">
                <div className="w-16 h-16 border border-primary/20 bg-primary/5 flex items-center justify-center">
                  <span className="font-mono text-primary/20 text-3xl">
                    {(anima?.name || "?")[0]}
                  </span>
                </div>
                <p className="font-mono text-[10px] text-primary/20 tracking-widest uppercase">
                  No avatar yet
                </p>
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

            {previewUrl && !generating && (
              <div className="absolute top-2 left-2 bg-black/70 border border-primary/20 px-2 py-1">
                <p className="font-mono text-[8px] text-primary/50 tracking-widest uppercase">
                  {hasAvatarChange ? "● New Preview" : "Current Avatar"}
                </p>
              </div>
            )}
          </div>

          <div className="p-4 border-t border-primary/15 space-y-3">
            <div className="space-y-2">
              <label className="font-mono text-[8px] text-primary/40 tracking-widest uppercase flex items-center gap-1.5">
                <Palette className="w-3 h-3" />
                Theme accent
              </label>
              <div className="flex flex-wrap items-center gap-2">
                {THEME_PRESETS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => {
                      setThemeColor(c);
                      setSaved(false);
                    }}
                    className={`w-6 h-6 border transition-all ${
                      themeColor === c
                        ? "border-primary scale-110"
                        : "border-primary/20 hover:border-primary/50"
                    }`}
                    style={{ backgroundColor: c }}
                    aria-label={`Theme ${c}`}
                    title={c}
                  />
                ))}
                <input
                  type="color"
                  value={themeColor}
                  onChange={(e) => {
                    setThemeColor(e.target.value);
                    setSaved(false);
                  }}
                  className="w-8 h-6 bg-transparent border border-primary/20 cursor-pointer"
                  aria-label="Custom theme color"
                />
              </div>
            </div>

            {error && (
              <p className="font-mono text-[10px] text-red-400/90 leading-relaxed border border-red-400/30 bg-red-950/20 px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="button"
              onClick={handleGenerate}
              disabled={generating || saving}
              className="w-full flex items-center justify-center gap-2 py-3 bg-primary/10 border border-primary/40 text-primary hover:bg-primary/20 disabled:opacity-40 disabled:cursor-not-allowed font-mono text-xs tracking-widest uppercase transition-all hud-corner"
            >
              {generating ? (
                <>
                  <Loader className="w-4 h-4 animate-spin" /> Generating...
                </>
              ) : (
                <>
                  <Wand2 className="w-4 h-4" /> Generate Look
                </>
              )}
            </button>

            {hasChanges && (
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || saved || generating}
                className={`w-full flex items-center justify-center gap-2 py-2.5 border font-mono text-xs tracking-widest uppercase transition-all disabled:cursor-not-allowed ${
                  saved
                    ? "border-green-400/50 bg-green-400/10 text-green-400"
                    : "border-primary/50 bg-primary/5 text-primary hover:bg-primary/15"
                }`}
              >
                {saved ? (
                  <>
                    <Check className="w-4 h-4" /> Saved!
                  </>
                ) : saving ? (
                  <>
                    <Loader className="w-4 h-4 animate-spin" /> Saving...
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4" /> Apply & Save
                  </>
                )}
              </button>
            )}

            <p className="font-mono text-[8px] text-primary/20 tracking-widest text-center">
              Describe features → Generate Look → Apply & Save
            </p>
>>>>>>> origin/main
          </div>
        </div>
      </div>
    </div>
  );
<<<<<<< HEAD
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
=======

  if (isPage) return body;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4">
      {body}
    </div>
  );
}
>>>>>>> origin/main
