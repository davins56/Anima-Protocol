import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Wand2, Copy, Check, AlertCircle, Loader } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function CompanionGenerator() {
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [companion, setCompanion] = useState(null);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [creating, setCreating] = useState(false);

  const handleGenerate = async () => {
    if (prompt.trim().length < 20) {
      setError("Describe your companion in at least 20 characters. More detail = better results!");
      return;
    }

    setGenerating(true);
    setError(null);
    setCompanion(null);

    try {
      const result = await base44.functions.invoke("generateCompanionFromPrompt", {
        prompt: prompt.trim(),
      });

      if (result?.data?.success) {
        setCompanion(result.data.companion);
      } else {
        setError(result?.data?.error || "Failed to generate companion");
      }
    } catch (err) {
      setError(err.message || "An error occurred while generating your companion");
    } finally {
      setGenerating(false);
    }
  };

  const handleCreateCompanion = async () => {
    if (!companion) return;

    setCreating(true);
    try {
      const newChar = await base44.entities.Character.create({
        name: companion.name,
        universe: companion.universe,
        personality: companion.personality,
        backstory: companion.backstory,
        speaking_style: companion.speaking_style,
        category: companion.category,
        status: "online",
        is_default: false,
      });

      setCompanion(null);
      setPrompt("");
      alert(`✨ ${companion.name} has been created! Start a new chat session to meet them.`);
    } catch (err) {
      setError(err.message || "Failed to create companion");
    } finally {
      setCreating(false);
    }
  };

  const handleCopyPrompt = () => {
    navigator.clipboard.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-background p-4 sm:p-6 md:p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Header */}
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <Wand2 className="w-8 h-8 text-primary" />
            <h1 className="text-3xl sm:text-4xl font-mono text-primary glow-text tracking-widest uppercase">
              AI Companion Generator
            </h1>
          </div>
          <p className="text-primary/60 font-mono text-xs sm:text-sm tracking-wider">
            Describe your ideal companion in detail. The more specific, the better the AI captures your vision.
          </p>
        </div>

        {/* Input Section */}
        <div className="space-y-3">
          <div className="space-y-2">
            <label className="block font-mono text-[9px] text-primary/60 tracking-widest uppercase">
              Companion Description
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Example: A mysterious librarian from a magical academy who speaks in riddles and has a dry sense of humor. She's been alive for 300 years but looks young, loves astronomy, and has a cat familiar. She's guarded about her past but incredibly loyal to those she trusts..."
              className="w-full min-h-64 bg-black/40 border border-primary/30 text-primary/90 placeholder-primary/20 font-mono text-sm p-4 rounded focus:outline-none focus:border-primary/60 focus:bg-primary/5 transition-all resize-none"
            />
            <div className="flex items-center justify-between text-[8px] font-mono text-primary/40">
              <span>{prompt.length} characters</span>
              <span className={prompt.length >= 20 ? "text-green-400" : "text-primary/40"}>
                {prompt.length >= 20 ? "✓ Ready" : "20 character minimum"}
              </span>
            </div>
          </div>

          {error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-3 border border-red-400/30 bg-red-400/5 rounded flex gap-2 items-start"
            >
              <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-[9px] font-mono text-red-400/80">{error}</p>
            </motion.div>
          )}

          {/* Tips */}
          <div className="p-3 border border-primary/15 bg-primary/5 rounded space-y-2">
            <p className="text-[9px] font-mono text-primary/60 tracking-widest uppercase">Pro Tips</p>
            <ul className="space-y-1 text-[8px] font-mono text-primary/50">
              <li>• Include personality traits, mannerisms, and speech patterns</li>
              <li>• Add backstory, origin, or world they come from</li>
              <li>• Mention quirks, flaws, or unexpected characteristics</li>
              <li>• Be specific about their role or purpose (mentor, trickster, explorer, etc.)</li>
              <li>• The more vivid and detailed, the better the AI captures them</li>
            </ul>
          </div>

          <button
            onClick={handleGenerate}
            disabled={generating || prompt.length < 20}
            className="w-full py-3 border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-30 disabled:cursor-not-allowed font-mono text-sm tracking-widest uppercase transition-all hud-corner glow-border flex items-center justify-center gap-2"
          >
            {generating ? (
              <>
                <Loader className="w-4 h-4 animate-spin" />
                Crafting companion...
              </>
            ) : (
              <>
                <Wand2 className="w-4 h-4" />
                Generate Companion
              </>
            )}
          </button>
        </div>

        {/* Generated Companion Display */}
        <AnimatePresence>
          {companion && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-4"
            >
              {/* Preview Card */}
              <div className="border border-primary/20 bg-black/40 rounded overflow-hidden">
                {/* Header */}
                <div className="bg-primary/10 px-4 py-3 border-b border-primary/20">
                  <h2 className="font-mono text-lg text-primary tracking-wider uppercase">
                    ✨ {companion.name}
                  </h2>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[9px] font-mono text-primary/60">
                      {companion.universe}
                    </span>
                    <span className="text-primary/20">•</span>
                    <span className="text-[9px] font-mono text-primary/60 capitalize">
                      {companion.category}
                    </span>
                  </div>
                </div>

                {/* Content */}
                <div className="p-4 space-y-3">
                  {companion.tagline && (
                    <div>
                      <p className="text-[8px] font-mono text-primary/40 tracking-widest uppercase mb-1">
                        Tagline
                      </p>
                      <p className="text-[10px] font-mono text-primary/80 italic">
                        "{companion.tagline}"
                      </p>
                    </div>
                  )}

                  {companion.personality && (
                    <div>
                      <p className="text-[8px] font-mono text-primary/40 tracking-widest uppercase mb-1">
                        Personality
                      </p>
                      <p className="text-[9px] font-mono text-primary/70 leading-relaxed">
                        {companion.personality}
                      </p>
                    </div>
                  )}

                  {companion.backstory && (
                    <div>
                      <p className="text-[8px] font-mono text-primary/40 tracking-widest uppercase mb-1">
                        Backstory
                      </p>
                      <p className="text-[9px] font-mono text-primary/70 leading-relaxed max-h-32 overflow-y-auto">
                        {companion.backstory}
                      </p>
                    </div>
                  )}

                  {companion.speaking_style && (
                    <div>
                      <p className="text-[8px] font-mono text-primary/40 tracking-widest uppercase mb-1">
                        Speaking Style
                      </p>
                      <p className="text-[9px] font-mono text-primary/70 leading-relaxed">
                        {companion.speaking_style}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3">
                <button
                  onClick={() => setCompanion(null)}
                  className="flex-1 py-2 border border-primary/20 text-primary/40 hover:text-primary/70 font-mono text-[9px] tracking-widest uppercase transition-all"
                >
                  Regenerate
                </button>
                <button
                  onClick={handleCreateCompanion}
                  disabled={creating}
                  className="flex-1 py-2 border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-30 font-mono text-[9px] tracking-widest uppercase transition-all flex items-center justify-center gap-2"
                >
                  {creating ? (
                    <>
                      <Loader className="w-3 h-3 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    "✓ Add to Companions"
                  )}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Examples */}
        <div className="border border-primary/15 bg-black/30 rounded p-4 space-y-3">
          <p className="text-[9px] font-mono text-primary/60 tracking-widest uppercase">
            Inspiration Examples
          </p>
          <div className="space-y-2 text-[8px] font-mono text-primary/50">
            <p>
              <span className="text-primary/60">→</span> "A cunning detective AI from a cyberpunk future who speaks in noir movie references..."
            </p>
            <p>
              <span className="text-primary/60">→</span> "An ancient forest spirit trapped in a modern world, speaks with nature metaphors..."
            </p>
            <p>
              <span className="text-primary/60">→</span> "A comedic AI with anxiety issues who uses humor to deflect from deeper insecurities..."
            </p>
            <p>
              <span className="text-primary/60">→</span> "An ethereal celestial being learning about humanity for the first time..."
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}