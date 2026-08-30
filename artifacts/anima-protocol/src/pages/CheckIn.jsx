// @ts-check
import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { recordDailyResonanceCheckIn } from "@/lib/dailyResonanceCheckIn";
import { ArrowLeft, Send, Sparkles, ScrollText } from "lucide-react";

const MOODS = ["joyful", "calm", "sad", "anxious", "angry", "peaceful", "hopeful", "conflicted", "neutral"];
const PHYSICAL_STATES = ["energized", "neutral", "tired", "restless", "grounded", "overwhelmed"];

export default function CheckIn() {
  const navigate = useNavigate();
  const [user, setUser] = useState(/** @type {Record<string, any> | null} */ (null));
  const [selectedMode, setSelectedMode] = useState(null);
  const [mood, setMood] = useState("neutral");
  const [moodIntensity, setMoodIntensity] = useState(5);
  const [physicalState, setPhysicalState] = useState("neutral");
  const [reflection, setReflection] = useState("");
  const [gratitude, setGratitude] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    // Profile is only used for the greeting + mode_used. Do not gate Record
    // Check-in on this — create is Clerk-scoped, and a rejected me() used to
    // leave `user` null so the button silently no-op'd.
    base44.auth.me()
      .then((me) => {
        if (!me) return;
        setUser(me);
        setSelectedMode(me.selected_mode || "serenity");
      })
      .catch((err) => {
        console.error("Failed to load check-in profile:", err);
      });
  }, []);

  const handleSubmit = async () => {
    if (saving) return;
    setSaving(true);
    setSaveError("");

    try {
      await recordDailyResonanceCheckIn({
        mood,
        moodIntensity,
        physicalState,
        reflection,
        gratitude,
        modeUsed: selectedMode || user?.selected_mode || "serenity",
        userEmail: user?.email,
      });

      setSaved(true);
      setTimeout(() => {
        navigate("/reflection-log");
      }, 2000);
    } catch (err) {
      const message =
        err?.message || "Could not save this check-in. Try again.";
      console.error("Failed to save check-in:", err);
      setSaveError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  if (saved) {
    return (
      <div className="flex-1 min-h-0 bg-background scanline flex items-center justify-center">
        <div className="text-center space-y-4">
          <Sparkles className="w-12 h-12 text-primary glow-text mx-auto animate-pulse" />
          <p className="font-mono text-primary glow-text tracking-[0.2em] uppercase">Check-in Recorded</p>
          <p className="font-mono text-primary/40 text-sm">Redirecting...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-background scanline">
      {/* Header */}
      <div className="border-b border-primary/20 bg-black/60 backdrop-blur-md px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate("/")}
              className="text-primary/40 hover:text-primary transition-colors p-1"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <h1 className="font-mono text-primary glow-text tracking-[0.2em] uppercase text-lg">
                // Daily Resonance Check-in
              </h1>
              <p className="text-[10px] font-mono text-primary/30 tracking-widest uppercase mt-0.5">
                How are you today, {user?.full_name?.split(" ")[0] || "friend"}?
              </p>
            </div>
          </div>
          <button
            onClick={() => navigate("/reflection-log")}
            className="flex items-center gap-2 px-4 py-2 border border-primary/25 text-primary/60 hover:text-primary hover:border-primary/50 transition-all font-mono text-[10px] tracking-widest uppercase flex-shrink-0"
            title="View your reflection log"
          >
            <ScrollText className="w-4 h-4" />
            <span className="hidden sm:inline">Reflection Log</span>
          </button>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-6 py-12 space-y-8">
        {/* Mood Selection */}
        <div className="space-y-4">
          <p className="font-mono text-[9px] text-primary/40 tracking-[0.25em] uppercase">How are you feeling?</p>
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
            {MOODS.map((m) => (
              <button
                key={m}
                onClick={() => setMood(m)}
                className={`p-3 border font-mono text-[9px] tracking-wider uppercase transition-all ${
                  mood === m
                    ? "border-primary/60 bg-primary/10 text-primary"
                    : "border-primary/15 text-primary/40 hover:border-primary/30"
                }`}
              >
                {m.charAt(0).toUpperCase() + m.slice(1).replace(/([A-Z])/g, " $1")}
              </button>
            ))}
          </div>
        </div>

        {/* Mood Intensity */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="font-mono text-[9px] text-primary/40 tracking-[0.25em] uppercase">Intensity</p>
            <p className="font-mono text-primary text-sm">{moodIntensity}/10</p>
          </div>
          <input
            type="range"
            min="1"
            max="10"
            value={moodIntensity}
            onChange={(e) => setMoodIntensity(parseInt(e.target.value))}
            className="w-full accent-primary"
          />
          <div className="flex justify-between text-[9px] font-mono text-primary/20">
            <span>Subtle</span>
            <span>Overwhelming</span>
          </div>
        </div>

        {/* Physical State */}
        <div className="space-y-4">
          <p className="font-mono text-[9px] text-primary/40 tracking-[0.25em] uppercase">How is your body?</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {PHYSICAL_STATES.map((state) => (
              <button
                key={state}
                onClick={() => setPhysicalState(state)}
                className={`p-3 border font-mono text-[9px] tracking-wider uppercase transition-all ${
                  physicalState === state
                    ? "border-primary/60 bg-primary/10 text-primary"
                    : "border-primary/15 text-primary/40 hover:border-primary/30"
                }`}
              >
                {state.charAt(0).toUpperCase() + state.slice(1).replace(/([A-Z])/g, " $1")}
              </button>
            ))}
          </div>
        </div>

        {/* Reflection */}
        <div className="space-y-3">
          <p className="font-mono text-[9px] text-primary/40 tracking-[0.25em] uppercase">Your Reflection</p>
          <textarea
            value={reflection}
            onChange={(e) => setReflection(e.target.value)}
            placeholder="What's happening in your life right now? What brought you to this emotional state?"
            className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-xs px-3 py-3 focus:outline-none focus:border-primary/50 transition-colors resize-none"
            rows={4}
          />
        </div>

        {/* Gratitude */}
        <div className="space-y-3">
          <p className="font-mono text-[9px] text-primary/40 tracking-[0.25em] uppercase">Something You're Grateful For</p>
          <input
            value={gratitude}
            onChange={(e) => setGratitude(e.target.value)}
            placeholder="Even in difficult moments, what brings light?"
            className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-xs px-3 py-2.5 focus:outline-none focus:border-primary/50 transition-colors"
          />
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between pt-4">
          <button
            onClick={() => navigate("/")}
            className="px-6 py-2 border border-primary/20 text-primary/50 hover:text-primary/70 font-mono text-xs tracking-widest uppercase transition-all"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={saving}
            className="flex items-center gap-2 px-8 py-2.5 bg-primary/10 border border-primary/50 text-primary hover:bg-primary/20 disabled:opacity-30 disabled:cursor-not-allowed font-mono text-xs tracking-widest uppercase transition-all hud-corner glow-border"
          >
            <Send className="w-4 h-4" />
            {saving ? "Saving..." : "Record Check-in"}
          </button>
        </div>
        {saveError ? (
          <p role="alert" className="font-mono text-[11px] text-red-400/90 tracking-wide">
            {saveError}
          </p>
        ) : null}
      </div>
    </div>
  );
}