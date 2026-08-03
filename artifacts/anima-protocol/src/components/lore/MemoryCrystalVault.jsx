import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Link } from "react-router-dom";

const MILESTONE_CONFIG = {
  first_contact: { label: "First Contact", glyph: "◦", color: "#34D399" },
  deep_resonance: { label: "Deep Resonance", glyph: "⬟", color: "#A78BFA" },
  revelation: { label: "Revelation", glyph: "◈", color: "#60A5FA" },
  emotional_peak: { label: "Emotional Peak", glyph: "✦", color: "#F472B6" },
  lore_unlock: { label: "Lore Unlock", glyph: "⟡", color: "#FBBF24" },
  relationship_milestone: { label: "Bond Formed", glyph: "◉", color: "#FB923C" },
  shadow_confrontation: { label: "Shadow Work", glyph: "⬡", color: "#F87171" },
};

export default function MemoryCrystalVault({ crystals, sessions }) {
  const [selected, setSelected] = useState(null);
  const [filter, setFilter] = useState("all");

  const sessionMap = Object.fromEntries(sessions.map(s => [s.id, s]));

  const filtered = filter === "all"
    ? crystals
    : crystals.filter(c => c.milestone_type === filter);

  const typesPresent = [...new Set(crystals.map(c => c.milestone_type))];

  const totalXP = crystals.reduce((sum, c) => sum + (c.resonance_xp_awarded || 0), 0);

  return (
    <div className="space-y-5">
      {/* Summary */}
      <div className="flex items-center justify-between p-4 border"
        style={{ borderColor: "rgba(167,139,250,0.15)", background: "rgba(124,58,237,0.04)" }}>
        <div>
          <p className="font-mono text-2xl font-bold" style={{ color: "#E0D9FF" }}>
            {crystals.length}
          </p>
          <p className="font-mono text-[9px] tracking-widest uppercase" style={{ color: "rgba(167,139,250,0.5)" }}>
            Memory Crystals Formed
          </p>
        </div>
        <div className="text-center">
          <p className="font-mono text-2xl font-bold" style={{ color: "#A78BFA" }}>
            {totalXP.toLocaleString()}
          </p>
          <p className="font-mono text-[9px] tracking-widest uppercase" style={{ color: "rgba(167,139,250,0.5)" }}>
            XP from Crystals
          </p>
        </div>
        <div className="text-right">
          <p className="font-mono text-2xl font-bold" style={{ color: "#60A5FA" }}>
            {typesPresent.length}
          </p>
          <p className="font-mono text-[9px] tracking-widest uppercase" style={{ color: "rgba(167,139,250,0.5)" }}>
            Milestone Types
          </p>
        </div>
      </div>

      {/* Filter */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setFilter("all")}
          className="px-3 py-1.5 border font-mono text-[8px] tracking-widest uppercase transition-all"
          style={{
            borderColor: filter === "all" ? "rgba(167,139,250,0.4)" : "rgba(255,255,255,0.06)",
            background: filter === "all" ? "rgba(124,58,237,0.12)" : "transparent",
            color: filter === "all" ? "#A78BFA" : "rgba(255,255,255,0.25)",
          }}
        >
          All ({crystals.length})
        </button>
        {typesPresent.map(type => {
          const cfg = MILESTONE_CONFIG[type];
          if (!cfg) return null;
          const count = crystals.filter(c => c.milestone_type === type).length;
          return (
            <button
              key={type}
              onClick={() => setFilter(type)}
              className="px-3 py-1.5 border font-mono text-[8px] tracking-widest uppercase transition-all"
              style={{
                borderColor: filter === type ? `${cfg.color}50` : "rgba(255,255,255,0.06)",
                background: filter === type ? `${cfg.color}10` : "transparent",
                color: filter === type ? cfg.color : "rgba(255,255,255,0.25)",
              }}
            >
              {cfg.glyph} {cfg.label} ({count})
            </button>
          );
        })}
      </div>

      {/* Crystal Grid */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 space-y-3">
          <div className="text-4xl text-white/10">✦</div>
          <p className="font-mono text-[10px] tracking-[0.3em] uppercase" style={{ color: "rgba(167,139,250,0.3)" }}>
            No memory crystals yet
          </p>
          <p className="font-mono text-[9px]" style={{ color: "rgba(255,255,255,0.15)" }}>
            Crystals form from significant conversations. Begin a session to create your first echo.
          </p>
          <Link to="/" className="inline-block mt-2 font-mono text-[9px] tracking-widest uppercase px-4 py-2 border transition-all hover:bg-violet-500/10"
            style={{ borderColor: "rgba(139,92,246,0.25)", color: "rgba(167,139,250,0.6)" }}>
            Begin Session →
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((crystal, idx) => {
            const cfg = MILESTONE_CONFIG[crystal.milestone_type] || MILESTONE_CONFIG.first_contact;
            const color = crystal.crystal_color || cfg.color;
            const session = sessionMap[crystal.session_id];
            const isSelected = selected?.id === crystal.id;

            return (
              <motion.div
                key={crystal.id}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: idx * 0.04 }}
                onClick={() => setSelected(isSelected ? null : crystal)}
                className="relative cursor-pointer overflow-hidden border transition-all"
                style={{
                  borderColor: isSelected ? `${color}60` : `${color}20`,
                  background: isSelected ? `${color}08` : "rgba(255,255,255,0.02)",
                }}
              >
                {/* Crystal shine effect */}
                <div className="absolute top-0 right-0 w-20 h-20 rounded-full blur-[30px] opacity-20 pointer-events-none"
                  style={{ background: color }} />

                <div className="relative z-10 p-4 space-y-3">
                  {/* Glyph + Type */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xl" style={{ color }}>{cfg.glyph}</span>
                      <span className="font-mono text-[8px] tracking-widest uppercase" style={{ color: `${color}70` }}>
                        {cfg.label}
                      </span>
                    </div>
                    <span className="font-mono text-[8px]" style={{ color: "rgba(255,255,255,0.2)" }}>
                      +{crystal.resonance_xp_awarded || 0} XP
                    </span>
                  </div>

                  {/* Title */}
                  <h3 className="font-mono text-sm font-semibold tracking-wide leading-tight" style={{ color }}>
                    {crystal.title}
                  </h3>

                  {/* Excerpt */}
                  {crystal.excerpt && (
                    <p className="font-mono text-[9px] leading-relaxed line-clamp-3"
                      style={{ color: "rgba(220,210,255,0.45)" }}>
                      "{crystal.excerpt}"
                    </p>
                  )}

                  {/* Footer */}
                  <div className="flex items-center justify-between pt-2 border-t"
                    style={{ borderColor: `${color}15` }}>
                    <span className="font-mono text-[8px]" style={{ color: "rgba(255,255,255,0.2)" }}>
                      {crystal.character_name || "Unknown"}
                    </span>
                    <span className="font-mono text-[8px]" style={{ color: "rgba(255,255,255,0.15)" }}>
                      {new Date(crystal.created_date).toLocaleDateString()}
                    </span>
                  </div>
                </div>

                {/* Expanded Detail */}
                <AnimatePresence>
                  {isSelected && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="border-t px-4 py-3 space-y-2"
                      style={{ borderColor: `${color}20` }}
                    >
                      {session && (
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-[8px] text-white/30">Session</span>
                          <Link
                            to={`/chat/${crystal.session_id}`}
                            onClick={e => e.stopPropagation()}
                            className="font-mono text-[8px] tracking-widest uppercase transition-colors hover:opacity-80 truncate max-w-32"
                            style={{ color }}
                          >
                            {session.title || "Untitled"} →
                          </Link>
                        </div>
                      )}
                      {crystal.emotional_tone && (
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-[8px] text-white/30">Tone</span>
                          <span className="font-mono text-[8px]" style={{ color: "rgba(220,210,255,0.5)" }}>
                            {crystal.emotional_tone}
                          </span>
                        </div>
                      )}
                      {crystal.message_index !== undefined && (
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-[8px] text-white/30">Message</span>
                          <span className="font-mono text-[8px]" style={{ color: "rgba(220,210,255,0.5)" }}>
                            #{crystal.message_index}
                          </span>
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}