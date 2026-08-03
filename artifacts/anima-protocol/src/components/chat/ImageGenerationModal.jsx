// @ts-check
import { useState } from "react";
import { X, Wand2, Loader } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { base44 } from "@/api/base44Client";

/**
 * @param {{ isOpen?: boolean, onClose: () => void, onImageGenerated?: (url: string, prompt?: string) => void }} props
 */
export default function ImageGenerationModal({ isOpen, onClose, onImageGenerated }) {
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [generatedImage, setGeneratedImage] = useState(null);

  const handleGenerate = async () => {
    if (!prompt.trim()) return;

    setLoading(true);
    try {
      const result = await base44.integrations.Core.GenerateImage({
        prompt: prompt.trim(),
      });

      if (result?.url) {
        setGeneratedImage(result.url);
        onImageGenerated?.(result.url, prompt);
      }
    } catch (err) {
      console.error("Image generation error:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setPrompt("");
    setGeneratedImage(null);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="w-full max-w-2xl bg-background border border-primary/30 hud-corner glow-border overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-primary/20 bg-black/60">
            <div className="flex items-center gap-2">
              <Wand2 className="w-5 h-5 text-primary" />
              <h2 className="font-mono text-primary glow-text tracking-[0.2em] uppercase">
                Generate Image
              </h2>
            </div>
            <button
              onClick={handleClose}
              disabled={loading}
              className="text-primary/30 hover:text-primary transition-colors disabled:opacity-50"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Content */}
          <div className="p-6 space-y-4">
            {/* Input */}
            <div>
              <label className="block text-[9px] font-mono text-primary/40 tracking-[0.25em] uppercase mb-2">
                Image Description
              </label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Describe the image you want to generate... Be detailed and specific for best results."
                rows={4}
                disabled={loading}
                className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-sm px-3 py-2.5 focus:outline-none focus:border-primary/50 transition-colors disabled:opacity-50 resize-none"
              />
            </div>

            {/* Generated Image */}
            {generatedImage && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-2"
              >
                <p className="text-[9px] font-mono text-primary/40 tracking-[0.25em] uppercase">
                  Generated Image
                </p>
                <img
                  src={generatedImage}
                  alt="Generated"
                  className="w-full border border-primary/30 rounded max-h-96 object-cover"
                />
              </motion.div>
            )}

            {/* Loading State */}
            {loading && (
              <div className="flex items-center justify-center py-12">
                <div className="flex flex-col items-center gap-3">
                  <Loader className="w-6 h-6 text-primary animate-spin" />
                  <p className="font-mono text-[10px] text-primary/50 tracking-widest uppercase">
                    Creating image...
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex gap-3 p-6 border-t border-primary/20 bg-black/60">
            <button
              onClick={handleClose}
              disabled={loading}
              className="flex-1 px-6 py-2 border border-primary/20 text-primary/40 hover:text-primary hover:border-primary/40 disabled:opacity-30 font-mono text-xs tracking-widest uppercase transition-all"
            >
              Cancel
            </button>
            <button
              onClick={handleGenerate}
              disabled={!prompt.trim() || loading}
              className="flex-1 px-6 py-2 bg-primary/10 border border-primary/40 text-primary hover:bg-primary/20 disabled:opacity-30 font-mono text-xs tracking-widest uppercase transition-all flex items-center justify-center gap-2 hud-corner glow-border"
            >
              {loading ? (
                <>
                  <Loader className="w-3 h-3 animate-spin" />
                  Generating
                </>
              ) : (
                <>
                  <Wand2 className="w-3 h-3" />
                  Generate
                </>
              )}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}