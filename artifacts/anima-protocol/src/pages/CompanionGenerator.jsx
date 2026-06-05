import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { autoAssignCharacterPhoto } from "@/lib/seedCharacters";
import { track } from "@/lib/analytics";
import { Wand2, Copy, Check, AlertCircle, Loader } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";

export default function CompanionGenerator() {
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [companion, setCompanion] = useState(null);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [creating, setCreating] = useState(false);

  const handleGenerate = async () => {
    if (prompt.trim().length < 2) {
      setError("Enter a character name or a short description to get started.");
      return;
    }

    setGenerating(true);
    setError(null);
    setCompanion(null);

    try {
      const result = await base44.functions.invoke("generateCompanionFromPrompt", {
        prompt: prompt.trim(),
      });

      if (result?.success && result.companion) {
        setCompanion(result.companion);
      } else {
        setError(result?.error || "Failed to generate companion");
      }
    } catch (err) {
      setError(err.message || "An error occurred while generating your companion");
    } finally {
      setGenerating(false);
    }
  };

  const updateField = (field, value) =>
    setCompanion((prev) => (prev ? { ...prev, [field]: value } : prev));

  const handleCreateCompanion = async () => {
    if (!companion) return;
    if (!companion.name?.trim()) {
      setError("Give your companion a name before adding them.");
      return;
    }

    setCreating(true);
    try {
      const newChar = await base44.entities.Character.create({
        name: companion.name.trim(),
        universe: companion.universe || "",
        personality: companion.personality || "",
        backstory: companion.backstory || "",
        speaking_style: companion.speaking_style || "",
        category: companion.category || "",
        tagline: companion.tagline || "",
        traits: companion.traits || "",
        status: "online",
        is_default: false,
      });

      // Auto-search a portrait in the background — never blocks creation.
      autoAssignCharacterPhoto(newChar).catch(() => {});

      track("character_created", {
        creation_method: "ai_prompt",
        universe: companion.universe || "unknown",
        category: companion.category || "unknown",
      });

      setCompanion(null);
      setPrompt("");
      toast.success(`✨ ${companion.name} has been created! Start a new chat session to meet them.`);
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
            Name a real character or describe an original. The AI researches them on the web and prefills their profile — edit anything before adding.
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
              placeholder="Name a real character — e.g. 'Sherlock Holmes' or 'Hermione Granger from Harry Potter' — and the AI will research them. Or describe an original: 'A mysterious librarian from a magical academy who speaks in riddles, has been alive for 300 years, and is fiercely loyal to those she trusts...'"
              className="w-full min-h-64 bg-black/40 border border-primary/30 text-primary/90 placeholder-primary/20 font-mono text-sm p-4 rounded focus:outline-none focus:border-primary/60 focus:bg-primary/5 transition-all resize-none"
            />
            <div className="flex items-center justify-between text-[8px] font-mono text-primary/40">
              <span>{prompt.length} characters</span>
              <span className={prompt.trim().length >= 2 ? "text-green-400" : "text-primary/40"}>
                {prompt.trim().length >= 2 ? "✓ Ready" : "Name or describe a character"}
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
              <li>• Just a name works — the AI researches real characters for you</li>
              <li>• Add the universe (e.g. "from Harry Potter") to disambiguate</li>
              <li>• For originals, include personality, mannerisms, and speech patterns</li>
              <li>• Mention backstory, origin, quirks, flaws, or their role</li>
              <li>• Everything is prefilled and fully editable before you add them</li>
            </ul>
          </div>

          <button
            onClick={handleGenerate}
            disabled={generating || prompt.trim().length < 2}
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
              {/* Editable Prefilled Profile */}
              <div className="border border-primary/20 bg-black/40 rounded overflow-hidden">
                {/* Header */}
                <div className="bg-primary/10 px-4 py-3 border-b border-primary/20 flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-mono text-lg text-primary tracking-wider uppercase">
                      ✨ {companion.name || "Unnamed"}
                    </h2>
                    <p className="text-[8px] font-mono text-primary/40 tracking-wider mt-1">
                      Review &amp; edit before adding — every field is yours to refine.
                    </p>
                  </div>
                  {companion.is_real_character && (
                    <span className="shrink-0 text-[8px] font-mono text-green-400/90 border border-green-400/40 bg-green-400/5 rounded px-2 py-1 tracking-widest uppercase">
                      🔎 AI Researched
                    </span>
                  )}
                </div>

                {/* Editable fields */}
                <div className="p-4 space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <Field
                      label="Name"
                      value={companion.name}
                      onChange={(v) => updateField("name", v)}
                    />
                    <Field
                      label="Universe"
                      value={companion.universe}
                      onChange={(v) => updateField("universe", v)}
                    />
                    <Field
                      label="Category"
                      value={companion.category}
                      onChange={(v) => updateField("category", v)}
                    />
                  </div>

                  <Field
                    label="Tagline"
                    value={companion.tagline}
                    onChange={(v) => updateField("tagline", v)}
                  />
                  <Field
                    label="Personality"
                    value={companion.personality}
                    onChange={(v) => updateField("personality", v)}
                    multiline
                  />
                  <Field
                    label="Backstory"
                    value={companion.backstory}
                    onChange={(v) => updateField("backstory", v)}
                    multiline
                  />
                  <Field
                    label="Speaking Style"
                    value={companion.speaking_style}
                    onChange={(v) => updateField("speaking_style", v)}
                    multiline
                  />
                  <Field
                    label="Traits"
                    value={companion.traits}
                    onChange={(v) => updateField("traits", v)}
                  />
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

function Field({ label, value, onChange, multiline = false }) {
  return (
    <div>
      <label className="block text-[8px] font-mono text-primary/40 tracking-widest uppercase mb-1">
        {label}
      </label>
      {multiline ? (
        <textarea
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          className="w-full bg-black/40 border border-primary/30 text-primary/90 font-mono text-[10px] leading-relaxed p-2 rounded focus:outline-none focus:border-primary/60 focus:bg-primary/5 transition-all resize-y"
        />
      ) : (
        <input
          type="text"
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-black/40 border border-primary/30 text-primary/90 font-mono text-[10px] p-2 rounded focus:outline-none focus:border-primary/60 focus:bg-primary/5 transition-all"
        />
      )}
    </div>
  );
}