import { useRef, useState } from "react";
import { ImagePlus, Loader, Upload, X } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { persistPortraitWithInlineFallback } from "@/lib/characterAvatarUpload";

/**
 * Compact avatar upload / URL field used when creating or reviewing an Anima.
 *
 * @param {{
 *   value?: string,
 *   onChange: (url: string) => void,
 *   nameHint?: string,
 *   onGenerate?: () => Promise<void> | void,
 *   generating?: boolean,
 *   generateLabel?: string,
 *   onBusyChange?: (busy: boolean) => void,
 * }} props
 */
export default function AvatarUploadField({
  value = "",
  onChange,
  nameHint = "",
  onGenerate,
  generating = false,
  generateLabel = "Generate Portrait",
  onBusyChange,
}) {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    onBusyChange?.(true);
    setError("");
    try {
      const persisted = await persistPortraitWithInlineFallback(file, (payload) =>
        base44.integrations.Core.UploadFile(payload),
      );
      onChange(persisted.url);
      if (persisted.warning) setError(persisted.warning);
    } catch (err) {
      setError(err?.message || "Upload failed — try another image.");
    } finally {
      setUploading(false);
      onBusyChange?.(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const busy = uploading || generating;
  const initial = (nameHint || "?").trim().charAt(0).toUpperCase() || "?";

  return (
    <div className="space-y-2">
      <label className="block text-[9px] font-mono text-primary/40 tracking-[0.25em] uppercase">
        Custom Avatar
      </label>
      <div className="flex items-center gap-4">
        <div className="relative w-20 h-20 border border-primary/30 bg-primary/5 overflow-hidden flex-shrink-0">
          {value ? (
            <>
              <img
                src={value}
                alt="avatar"
                className="w-full h-full object-cover"
              />
              <button
                type="button"
                onClick={() => onChange("")}
                disabled={busy}
                className="absolute top-1 right-1 p-0.5 bg-black/70 border border-primary/30 text-primary/70 hover:text-primary disabled:opacity-40"
                aria-label="Clear avatar"
              >
                <X className="w-3 h-3" />
              </button>
            </>
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <span className="font-mono text-primary/20 text-2xl">{initial}</span>
            </div>
          )}
        </div>

        <div className="space-y-2 flex-1 min-w-0">
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            onChange={handleFileSelect}
            className="hidden"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
              className="flex items-center gap-2 px-3 py-2 border border-primary/20 text-primary/50 hover:text-primary hover:border-primary/40 font-mono text-[10px] tracking-widest uppercase cursor-pointer transition-all disabled:opacity-40"
            >
              {uploading ? (
                <Loader className="w-3 h-3 animate-spin" />
              ) : (
                <Upload className="w-3 h-3" />
              )}
              {uploading ? "Uploading..." : value ? "Change Image" : "Upload Avatar"}
            </button>
            {typeof onGenerate === "function" ? (
              <button
                type="button"
                onClick={() => onGenerate()}
                disabled={busy}
                className="flex items-center gap-2 px-3 py-2 border border-primary/20 text-primary/50 hover:text-primary hover:border-primary/40 font-mono text-[10px] tracking-widest uppercase transition-all disabled:opacity-40"
              >
                {generating ? (
                  <Loader className="w-3 h-3 animate-spin" />
                ) : (
                  <ImagePlus className="w-3 h-3" />
                )}
                {generating ? "Generating..." : generateLabel}
              </button>
            ) : null}
          </div>
          <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Or paste image URL..."
            disabled={busy}
            className="w-full bg-black/60 border border-primary/15 text-primary/70 placeholder-primary/15 font-mono text-[10px] px-3 py-2 focus:outline-none focus:border-primary/40 transition-colors disabled:opacity-40"
          />
          {error ? (
            <p className="text-[10px] font-mono text-red-400/90">{error}</p>
          ) : (
            <p className="text-[9px] font-mono text-primary/30">
              Upload your own look, or paste a URL. Leave empty to use a default later.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
