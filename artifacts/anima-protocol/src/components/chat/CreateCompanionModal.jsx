import { useState } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import { base44 } from "@/api/base44Client";

const ARCHETYPES = [
  { name: "Guardian", emoji: "🛡️", description: "Protective and wise" },
  { name: "Muse", emoji: "✨", description: "Creative and inspiring" },
  { name: "Sage", emoji: "📚", description: "Knowledgeable and thoughtful" },
  { name: "Trickster", emoji: "🎭", description: "Playful and clever" },
];

export default function CreateCompanionModal({ onComplete, userEmail }) {
  const [step, setStep] = useState("welcome"); // welcome, details, loading, done
  const [name, setName] = useState("");
  const [archetype, setArchetype] = useState("Muse");
  const [tagline, setTagline] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleCreate = async () => {
    if (!name.trim()) {
      setError("Please give your companion a name");
      return;
    }

    setLoading(true);
    setStep("loading");
    setError("");

    try {
      const companion = await base44.entities.Anima.create({
        name: name.trim(),
        archetype,
        tagline: tagline.trim() || `Your ${archetype} companion`,
        assigned_user: userEmail,
        avatar_url: "https://serenity-sm2kts5ggj.replit.app/serenity-default.jpg", // Default avatar
        personality: `You are ${name}, a ${archetype.toLowerCase()} companion. ${tagline || "You provide guidance and support."}`,
        speaking_style: "Warm, thoughtful, and personable",
      });

      setStep("done");
      setTimeout(() => {
        onComplete(companion);
      }, 1500);
    } catch (err) {
      console.error("Error creating companion:", err);
      setError("Failed to create companion. Please try again.");
      setStep("details");
      setLoading(false);
    }
  };

  if (step === "welcome") {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      >
        <motion.div
          initial={{ scale: 0.9, y: 20 }}
          animate={{ scale: 1, y: 0 }}
          className="w-full max-w-2xl bg-background border border-primary/30 rounded-xl p-8 text-center space-y-6"
        >
          <div className="flex justify-center">
            <div className="relative">
              <div className="absolute inset-0 bg-primary/20 blur-3xl rounded-full scale-150 animate-pulse" />
              <Sparkles className="w-16 h-16 text-primary relative" />
            </div>
          </div>

          <div>
            <h1 className="text-3xl sm:text-4xl font-mono text-primary glow-text mb-2 tracking-widest uppercase">
              Welcome
            </h1>
            <p className="text-primary/60 font-mono text-sm tracking-wider">
              Create your first AI companion
            </p>
          </div>

          <p className="text-primary/70 max-w-md mx-auto leading-relaxed">
            Every journey begins with a guide. Your AI companion will be your constant support, adapting to who you are and helping you explore new narratives and experiences.
          </p>

          <button
            onClick={() => setStep("details")}
            className="px-8 py-3 bg-primary/10 border border-primary/50 text-primary hover:bg-primary/20 transition-all font-mono text-sm tracking-widest uppercase hud-corner glow-border"
          >
            Create Companion
          </button>
        </motion.div>
      </motion.div>
    );
  }

  if (step === "details") {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      >
        <motion.div
          initial={{ scale: 0.9, y: 20 }}
          animate={{ scale: 1, y: 0 }}
          className="w-full max-w-2xl bg-background border border-primary/30 rounded-xl p-8 space-y-6"
        >
          <h2 className="text-2xl font-mono text-primary glow-text tracking-widest uppercase">
            Design Your Companion
          </h2>

          {/* Name */}
          <div className="space-y-2">
            <label className="text-xs font-mono text-primary/60 tracking-widest uppercase">
              Companion Name
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Luna, Atlas, Spark"
              className="w-full bg-black/60 border border-primary/30 text-primary/90 placeholder-primary/20 font-mono text-sm px-4 py-3 focus:outline-none focus:border-primary/60 focus:bg-primary/5 transition-all"
            />
          </div>

          {/* Archetype */}
          <div className="space-y-3">
            <label className="text-xs font-mono text-primary/60 tracking-widest uppercase">
              Archetype
            </label>
            <div className="grid grid-cols-2 gap-3">
              {ARCHETYPES.map((arch) => (
                <button
                  key={arch.name}
                  onClick={() => setArchetype(arch.name)}
                  className={`p-3 border rounded text-left transition-all ${
                    archetype === arch.name
                      ? "border-primary/60 bg-primary/10"
                      : "border-primary/20 bg-black/40 hover:border-primary/40"
                  }`}
                >
                  <div className="text-2xl mb-1">{arch.emoji}</div>
                  <p className="font-mono text-sm text-primary tracking-wide uppercase">
                    {arch.name}
                  </p>
                  <p className="text-[9px] text-primary/50 mt-1">{arch.description}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Tagline */}
          <div className="space-y-2">
            <label className="text-xs font-mono text-primary/60 tracking-widest uppercase">
              Tagline (Optional)
            </label>
            <input
              value={tagline}
              onChange={(e) => setTagline(e.target.value)}
              placeholder="e.g., Your guide through endless stories"
              className="w-full bg-black/60 border border-primary/30 text-primary/90 placeholder-primary/20 font-mono text-sm px-4 py-3 focus:outline-none focus:border-primary/60 focus:bg-primary/5 transition-all"
            />
          </div>

          {error && (
            <div className="p-3 border border-red-400/30 bg-red-400/5 rounded text-red-400 text-sm font-mono">
              {error}
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={() => setStep("welcome")}
              disabled={loading}
              className="flex-1 px-6 py-2.5 border border-primary/20 text-primary/60 hover:text-primary/80 disabled:opacity-50 font-mono text-xs tracking-widest uppercase transition-all"
            >
              Back
            </button>
            <button
              onClick={handleCreate}
              disabled={loading || !name.trim()}
              className="flex-1 px-6 py-2.5 bg-primary/10 border border-primary/40 text-primary hover:bg-primary/20 disabled:opacity-30 disabled:cursor-not-allowed font-mono text-xs tracking-widest uppercase transition-all hud-corner glow-border flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Sparkles className="w-3 h-3" />
                  Create Companion
                </>
              )}
            </button>
          </div>
        </motion.div>
      </motion.div>
    );
  }

  if (step === "loading" || step === "done") {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      >
        <motion.div
          initial={{ scale: 0.9, y: 20 }}
          animate={{ scale: 1, y: 0 }}
          className="text-center space-y-4"
        >
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
            className="flex justify-center"
          >
            <Sparkles className="w-12 h-12 text-primary" />
          </motion.div>
          <p className="font-mono text-primary tracking-widest uppercase text-sm">
            {step === "loading" ? "Creating your companion..." : "Welcome!"}
          </p>
        </motion.div>
      </motion.div>
    );
  }
}