import { useState, useEffect } from "react";
import { X, Wand2, Loader, Check, RotateCcw } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { editImage } from "@/api/base44Client";

const PRESETS = [
  { label: "Cyberpunk Neon", prompt: "Transform this into a cyberpunk neon portrait with glowing cyan and magenta light, sleek futuristic style, dark background." },
  { label: "Ethereal Glow", prompt: "Give this an ethereal, dreamlike glow with soft luminous light and a mystical atmosphere." },
  { label: "Anime", prompt: "Reimagine this as a high-quality anime character illustration, clean linework and vibrant colors." },
  { label: "Oil Painting", prompt: "Render this as a classical oil painting with rich textured brushstrokes." },
  { label: "Marble Statue", prompt: "Transform this into a polished white marble statue with dramatic lighting." },
  { label: "Watercolor", prompt: "Render this as a delicate watercolor painting with soft washes of color." },
];

function downscaleDataUrl(src, maxSize, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onerror = () => reject(new Error("Failed to load image"));
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.src = src;
  });
}

export default function AvatarAIEditModal({ isOpen, sourceImage, onClose, onApply }) {
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (isOpen) {
      setPrompt("");
      setError("");
      setResult(null);
      setLoading(false);
      setApplying(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleGenerate = async () => {
    if (!prompt.trim() || !sourceImage || loading) return;
    setLoading(true);
    setError("");
    try {
      const res = await editImage({ image: sourceImage, prompt: prompt.trim() });
      if (res?.image) setResult(res.image);
      else setError("No image was returned. Try a different prompt.");
    } catch (err) {
      console.error("AI image edit failed:", err);
      setError(err?.message || "Couldn't edit that photo. Try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleApply = async () => {
    if (!result) return;
    setApplying(true);
    setError("");
    try {
      const small = await downscaleDataUrl(result, 512, 0.85);
      await onApply(small);
      onClose();
    } catch (err) {
      console.error("Failed to apply AI photo:", err);
      setError("Couldn't save that photo. Try again.");
      setApplying(false);
    }
  };

  const preview = result || sourceImage;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-md bg-[#070707] border border-cyan-500/30 hud-corner glow-border overflow-hidden max-h-[90vh] overflow-y-auto"
        >
          <div className="flex items-center justify-between p-4 border-b border-cyan-500/20 bg-black/60">
            <div className="flex items-center gap-2">
              <Wand2 className="w-4 h-4 text-cyan-400" />
              <h2 className="font-mono text-cyan-400 text-sm tracking-[0.2em] uppercase">
                AI Edit Photo
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-cyan-400/50 hover:text-cyan-400 transition-colors"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-5 space-y-5">
            <div className="flex justify-center">
              <div className="relative w-40 h-40 border border-cyan-400/20 p-1 bg-black/50">
                {preview ? (
                  <img src={preview} alt="Preview" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-cyan-950/20" />
                )}
                {loading && (
                  <div className="absolute inset-1 flex flex-col items-center justify-center gap-2 bg-black/75">
                    <Loader className="w-6 h-6 text-cyan-400 animate-spin" />
                    <span className="font-mono text-[8px] tracking-widest text-cyan-400/70 uppercase">
                      Generating...
                    </span>
                  </div>
                )}
                <div className="absolute -top-1 -left-1 w-3 h-3 border-t-2 border-l-2 border-cyan-400" />
                <div className="absolute -bottom-1 -right-1 w-3 h-3 border-b-2 border-r-2 border-cyan-400" />
                {result && (
                  <span className="absolute top-1 right-1 font-mono text-[7px] tracking-widest text-cyan-300 bg-black/70 px-1 py-0.5 uppercase">
                    AI
                  </span>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {PRESETS.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    disabled={loading || applying}
                    onClick={() => setPrompt(p.prompt)}
                    className="font-mono text-[9px] tracking-wider uppercase px-2 py-1 border border-cyan-500/25 text-cyan-400/70 hover:text-cyan-300 hover:border-cyan-400/60 transition-colors disabled:opacity-40"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                disabled={loading || applying}
                rows={3}
                placeholder="Describe how to transform the photo..."
                className="w-full bg-black/50 border border-cyan-500/25 px-3 py-2 font-mono text-xs text-cyan-100 placeholder:text-cyan-700 focus:outline-none focus:border-cyan-400/60 resize-none"
              />
            </div>

            {error && (
              <p className="font-mono text-[10px] tracking-wider text-red-400/90" role="alert">
                {error}
              </p>
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleGenerate}
                disabled={!prompt.trim() || loading || applying}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-cyan-500/10 border border-cyan-500/50 text-cyan-300 hover:bg-cyan-500/20 font-mono text-[11px] tracking-[0.2em] uppercase transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {loading ? <Loader className="w-4 h-4 animate-spin" /> : result ? <RotateCcw className="w-4 h-4" /> : <Wand2 className="w-4 h-4" />}
                {result ? "Regenerate" : "Generate"}
              </button>
              {result && (
                <button
                  type="button"
                  onClick={handleApply}
                  disabled={applying || loading}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-cyan-400/20 border border-cyan-400 text-cyan-200 hover:bg-cyan-400/30 font-mono text-[11px] tracking-[0.2em] uppercase transition-all disabled:opacity-40"
                >
                  {applying ? <Loader className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  Apply
                </button>
              )}
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
