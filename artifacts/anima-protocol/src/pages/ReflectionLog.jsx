import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { ArrowLeft, Search, Sparkles, Heart, Plus } from "lucide-react";

const MOOD_COLORS = {
  joyful: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  calm: "border-cyan-400/40 bg-cyan-400/10 text-cyan-300",
  peaceful: "border-teal-400/40 bg-teal-400/10 text-teal-300",
  hopeful: "border-lime-400/40 bg-lime-400/10 text-lime-300",
  sad: "border-blue-400/40 bg-blue-400/10 text-blue-300",
  anxious: "border-orange-400/40 bg-orange-400/10 text-orange-300",
  angry: "border-red-400/40 bg-red-400/10 text-red-300",
  conflicted: "border-purple-400/40 bg-purple-400/10 text-purple-300",
  neutral: "border-primary/20 bg-primary/5 text-primary/60",
};

function formatDate(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatTime(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export default function ReflectionLog() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    loadEntries();
  }, []);

  const loadEntries = async () => {
    setLoading(true);
    try {
      // No limit → fetch the full history so every reflection is logged.
      const data = await base44.entities.CheckIn.list("-created_date");
      // Only check-ins that captured a written reflection or gratitude note
      const withReflection = (data || []).filter(
        (c) => (c.reflection && c.reflection.trim()) || (c.gratitude && c.gratitude.trim())
      );
      setEntries(withReflection);
    } catch (err) {
      console.error("Error loading reflection log:", err);
      setEntries([]);
    } finally {
      setLoading(false);
    }
  };

  const filtered = entries.filter((e) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      (e.reflection && e.reflection.toLowerCase().includes(q)) ||
      (e.gratitude && e.gratitude.toLowerCase().includes(q)) ||
      (e.mood && e.mood.toLowerCase().includes(q)) ||
      (e.physical_state && e.physical_state.toLowerCase().includes(q)) ||
      (e.mode_used && e.mode_used.toLowerCase().includes(q))
    );
  });

  return (
    <div className="min-h-screen bg-background scanline">
      {/* Header */}
      <div className="border-b border-primary/20 bg-black/60 backdrop-blur-md px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Link to="/" className="text-primary/40 hover:text-primary transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="font-mono text-primary glow-text tracking-[0.2em] uppercase text-lg">
                // Reflection Log
              </h1>
              <p className="text-[10px] font-mono text-primary/30 tracking-widest uppercase mt-0.5">
                {filtered.length} {filtered.length === 1 ? "reflection" : "reflections"} from daily check-ins
              </p>
            </div>
          </div>
          <Link
            to="/check-in"
            className="flex items-center gap-2 px-5 py-2 bg-primary/10 border border-primary/40 text-primary hover:bg-primary/20 transition-all font-mono text-xs tracking-widest uppercase hud-corner glow-border"
          >
            <Plus className="w-4 h-4" />
            New Check-in
          </Link>
        </div>
      </div>

      <div className="max-w-4xl mx-auto p-6 pb-28 lg:pb-8 space-y-6">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary/30" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search your reflections..."
            className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-sm pl-10 pr-4 py-2.5 focus:outline-none focus:border-primary/50 transition-colors"
          />
        </div>

        {/* List */}
        {loading ? (
          <div className="text-center py-12 font-mono text-primary/30 text-sm animate-pulse">
            Loading reflection log...
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 space-y-3">
            <Sparkles className="w-10 h-10 text-primary/20 mx-auto" />
            <p className="font-mono text-primary/20 text-sm tracking-[0.3em] uppercase">
              {entries.length === 0 ? "No reflections logged yet" : "No matching reflections"}
            </p>
            {entries.length === 0 && (
              <Link
                to="/check-in"
                className="inline-block mt-2 text-primary/50 hover:text-primary font-mono text-[10px] tracking-widest uppercase border-b border-primary/30"
              >
                Record your first check-in
              </Link>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((entry) => (
              <div
                key={entry.id}
                className="border border-primary/15 bg-black/40 hover:bg-primary/5 hover:border-primary/30 p-4 hud-corner transition-all"
              >
                {/* Meta row */}
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div className="flex flex-col">
                    <span className="font-mono text-[11px] text-primary tracking-wider uppercase">
                      {formatDate(entry.created_date || entry.timestamp)}
                    </span>
                    <span className="font-mono text-[9px] text-primary/30 tracking-widest mt-0.5">
                      {formatTime(entry.created_date || entry.timestamp)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap justify-end">
                    {entry.mood && (
                      <span
                        className={`px-2 py-0.5 border text-[9px] font-mono tracking-[0.1em] uppercase ${
                          MOOD_COLORS[entry.mood] || "border-primary/15 text-primary/40"
                        }`}
                      >
                        {entry.mood}
                      </span>
                    )}
                    {entry.mood_intensity != null && (
                      <span className="px-2 py-0.5 border border-primary/15 text-[9px] font-mono tracking-[0.1em] uppercase text-primary/40">
                        {entry.mood_intensity}/10
                      </span>
                    )}
                  </div>
                </div>

                {/* Reflection */}
                {entry.reflection && entry.reflection.trim() && (
                  <p className="text-xs font-mono text-primary/80 leading-relaxed whitespace-pre-wrap">
                    {entry.reflection}
                  </p>
                )}

                {/* Gratitude */}
                {entry.gratitude && entry.gratitude.trim() && (
                  <div className="mt-3 flex items-start gap-2 border-t border-primary/10 pt-3">
                    <Heart className="w-3 h-3 text-pink-400/60 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-mono text-[8px] text-primary/30 tracking-[0.25em] uppercase mb-0.5">
                        Grateful for
                      </p>
                      <p className="text-[11px] font-mono text-primary/60 leading-relaxed whitespace-pre-wrap">
                        {entry.gratitude}
                      </p>
                    </div>
                  </div>
                )}

                {/* Footer meta */}
                {(entry.physical_state || entry.mode_used) && (
                  <div className="flex items-center gap-3 mt-3 text-[9px] font-mono text-primary/30 tracking-widest uppercase">
                    {entry.physical_state && <span>Body: {entry.physical_state}</span>}
                    {entry.mode_used && <span>Mode: {entry.mode_used}</span>}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
