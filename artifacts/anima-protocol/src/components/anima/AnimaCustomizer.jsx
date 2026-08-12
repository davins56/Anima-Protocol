import { useState } from "react";
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
  const [activeFeature, setActiveFeature] = useState("skin");
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
            Shape skin, hair, outfit, eyes & more · then generate a new look
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
                  <label className="font-mono text-[9px] text-primary/50 tracking-[0.25em] uppercase flex items-center gap-2">
                    <span>{feature.icon}</span>
                    {feature.label}
                  </label>
                  <textarea
                    value={prompts[feature.key]}
                    onChange={(e) =>
                      setPrompts((p) => ({
                        ...p,
                        [feature.key]: e.target.value,
                      }))
                    }
                    placeholder={feature.placeholder}
                    rows={4}
                    className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-sm px-3 py-3 focus:outline-none focus:border-primary/50 transition-colors resize-none leading-relaxed"
                  />
                </div>
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
          </div>
        </div>
      </div>
    </div>
  );

  if (isPage) return body;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4">
      {body}
    </div>
  );
}
