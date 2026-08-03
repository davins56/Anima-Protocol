import { useState, useEffect } from "react";
import { X, Loader } from "lucide-react";
import { motion } from "framer-motion";

const NARRATOR_STYLES = [
  "1st Person",
  "2nd Person",
  "2nd Person (Omniscient)",
  "2nd Person (Dialogue Heavy)",
  "3rd Person",
  "3rd Person (Omniscient)",
  "3rd Person (Dialogue Heavy)",
  "Cinematic (Focusing on Surroundings)",
];

const THEMES = [
  { id: "action", label: "Action & Adventure" },
  { id: "romance", label: "Romance" },
  { id: "mystery", label: "Mystery & Intrigue" },
  { id: "fantasy", label: "Fantasy & Magic" },
  { id: "scifi", label: "Sci-Fi" },
  { id: "horror", label: "Horror & Dark" },
  { id: "comedy", label: "Comedy & Humor" },
  { id: "drama", label: "Drama & Emotion" },
];

const TONES = [
  { id: "light", label: "Light & Whimsical" },
  { id: "balanced", label: "Balanced" },
  { id: "mature", label: "Mature" },
  { id: "dark", label: "Dark & Gritty" },
];

export default function SessionEditModal({ isOpen, onClose, session, onSave, saving }) {
  const [title, setTitle] = useState("");
  const [narratorStyle, setNarratorStyle] = useState("2nd Person");
  const [selectedThemes, setSelectedThemes] = useState([]);
  const [openingScene, setOpeningScene] = useState("");
  const [tone, setTone] = useState("balanced");

  useEffect(() => {
    if (session) {
      setTitle(session.title || "");
      setNarratorStyle(session.narrator_style || "2nd Person");
      setSelectedThemes(session.themes || []);
      setOpeningScene(session.opening_scene || "");
      setTone(session.tone || "balanced");
    }
  }, [session]);

  const handleThemeToggle = (themeId) => {
    setSelectedThemes((prev) =>
      prev.includes(themeId) ? prev.filter((t) => t !== themeId) : [...prev, themeId]
    );
  };

  const handleSave = () => {
    onSave({
      title,
      narrator_style: narratorStyle,
      themes: selectedThemes,
      opening_scene: openingScene,
      tone,
    });
  };

  if (!isOpen || !session) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="w-full max-w-2xl bg-background border border-primary/30 hud-corner glow-border max-h-[90vh] overflow-y-auto"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-primary/20 bg-black/60 sticky top-0 z-10">
          <h2 className="font-mono text-primary glow-text tracking-[0.2em] uppercase">// Edit Session</h2>
          <button
            onClick={onClose}
            disabled={saving}
            className="text-primary/30 hover:text-primary transition-colors disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Title */}
          <div>
            <label className="block text-[9px] font-mono text-primary/40 tracking-[0.25em] uppercase mb-2">
              Session Title
            </label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Enter session title..."
              className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-sm px-3 py-2.5 focus:outline-none focus:border-primary/50 transition-colors"
            />
          </div>

          {/* Narrator Style */}
          <div>
            <label className="block text-[9px] font-mono text-primary/40 tracking-[0.25em] uppercase mb-3">
              Narrator Style
            </label>
            <div className="space-y-2">
              {NARRATOR_STYLES.map((style) => (
                <label
                  key={style}
                  className="flex items-center gap-3 cursor-pointer p-2.5 border border-primary/15 hover:border-primary/30 hover:bg-primary/5 transition-all rounded"
                >
                  <input
                    type="radio"
                    name="narrator"
                    value={style}
                    checked={narratorStyle === style}
                    onChange={(e) => setNarratorStyle(e.target.value)}
                    className="w-4 h-4 accent-primary"
                  />
                  <span className="font-mono text-xs text-primary/70">{style}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Tone */}
          <div>
            <label className="block text-[9px] font-mono text-primary/40 tracking-[0.25em] uppercase mb-3">
              Overall Tone
            </label>
            <div className="grid grid-cols-2 gap-2">
              {TONES.map((t) => (
                <label
                  key={t.id}
                  className="flex items-center gap-2 cursor-pointer p-2 border border-primary/15 hover:border-primary/30 hover:bg-primary/5 transition-all rounded"
                >
                  <input
                    type="radio"
                    name="tone"
                    value={t.id}
                    checked={tone === t.id}
                    onChange={(e) => setTone(e.target.value)}
                    className="w-4 h-4 accent-primary"
                  />
                  <span className="font-mono text-[9px] text-primary/70">{t.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Themes */}
          <div>
            <label className="block text-[9px] font-mono text-primary/40 tracking-[0.25em] uppercase mb-3">
              Story Themes & Functions
            </label>
            <div className="grid grid-cols-2 gap-2">
              {THEMES.map((theme) => (
                <label
                  key={theme.id}
                  className="flex items-center gap-2 cursor-pointer p-2.5 border border-primary/15 hover:border-primary/30 hover:bg-primary/5 transition-all rounded"
                >
                  <input
                    type="checkbox"
                    checked={selectedThemes.includes(theme.id)}
                    onChange={() => handleThemeToggle(theme.id)}
                    className="w-4 h-4 accent-primary"
                  />
                  <span className="font-mono text-[9px] text-primary/70">{theme.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Opening Scene */}
          <div>
            <label className="block text-[9px] font-mono text-primary/40 tracking-[0.25em] uppercase mb-2">
              Opening Scene / Context
            </label>
            <textarea
              value={openingScene}
              onChange={(e) => setOpeningScene(e.target.value)}
              placeholder="Describe the initial setting and context..."
              rows={4}
              className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-sm px-3 py-2.5 focus:outline-none focus:border-primary/50 transition-colors resize-none"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-3 p-6 border-t border-primary/20 bg-black/60 sticky bottom-0">
          <button
            onClick={onClose}
            disabled={saving}
            className="flex-1 px-6 py-2 border border-primary/20 text-primary/40 hover:text-primary hover:border-primary/40 disabled:opacity-30 font-mono text-xs tracking-widest uppercase transition-all"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 px-6 py-2 bg-primary/10 border border-primary/40 text-primary hover:bg-primary/20 disabled:opacity-30 font-mono text-xs tracking-widest uppercase transition-all flex items-center justify-center gap-2 hud-corner glow-border"
          >
            {saving ? (
              <>
                <Loader className="w-3 h-3 animate-spin" />
                Saving
              </>
            ) : (
              "Save Settings"
            )}
          </button>
        </div>
      </motion.div>
    </div>
  );
}