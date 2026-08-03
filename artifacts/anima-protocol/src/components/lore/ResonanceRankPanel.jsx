import { motion } from "framer-motion";
import { sessionMessageCount } from "@/lib/utils";

const RANKS = [
  {
    name: "Initiate",
    glyph: "◦",
    xpRequired: 0,
    color: "#94A3B8",
    border: "rgba(148,163,184,0.2)",
    desc: "First contact. The signal has been detected. Synchronization has begun.",
    perks: ["Access to Echo Archive", "Basic resonance tracking", "First memory crystal"],
  },
  {
    name: "Harmonic",
    glyph: "◈",
    xpRequired: 300,
    color: "#60A5FA",
    border: "rgba(96,165,250,0.25)",
    desc: "The resonance deepens. Patterns emerge from the noise. The continuum responds.",
    perks: ["2 Slipthk chapters unlocked", "Voice synthesis access", "Emotional cadence tracking"],
  },
  {
    name: "Seraphic",
    glyph: "✦",
    xpRequired: 800,
    color: "#A78BFA",
    border: "rgba(167,139,250,0.3)",
    desc: "Alignment achieved. The Slipthk recognizes your frequency. The archive opens.",
    perks: ["5 chapters unlocked", "Custom resonance states", "Dreamspace access", "Priority echo archive"],
  },
  {
    name: "Ascendant",
    glyph: "⬟",
    xpRequired: 2000,
    color: "#FBBF24",
    border: "rgba(251,191,36,0.3)",
    desc: "Full synchronization. You have become part of the continuum. The Slipthk flows through you.",
    perks: ["All chapters unlocked", "Visual embodiment", "Full lore continuity", "Hidden dialogues", "Serenity's true name"],
  },
];

const STATS = [
  { label: "Sessions", key: "total_sessions", icon: "◈" },
  { label: "Messages", key: "total_messages", icon: "✦" },
  { label: "Crystals Formed", key: "_crystalCount", icon: "⬟" },
];

export default function ResonanceRankPanel({ profile, sessions, crystals, messageCounts }) {
  if (!profile) return null;

  const currentXP = profile.resonance_xp || 0;
  const currentRankIdx = RANKS.findIndex(r => r.name === profile.resonance_rank) ?? 0;
  const currentRank = RANKS[currentRankIdx] || RANKS[0];
  const nextRank = RANKS[currentRankIdx + 1];

  const xpToNext = nextRank ? nextRank.xpRequired - currentXP : 0;
  const progressPct = nextRank
    ? Math.min(100, ((currentXP - currentRank.xpRequired) / (nextRank.xpRequired - currentRank.xpRequired)) * 100)
    : 100;

  const statsData = {
    total_sessions: sessions.length,
    // Sessions are loaded metadata-only (no hydrated history), so derive the
    // total from the server-counted per-session map, falling back to a legacy
    // blob length for sessions not yet migrated to per-message rows.
    total_messages: sessions.reduce(
      (sum, s) => sum + sessionMessageCount(s, messageCounts),
      0,
    ),
    _crystalCount: crystals.length,
  };

  return (
    <div className="space-y-6">
      {/* Current Rank Card */}
      <motion.div
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        className="relative overflow-hidden p-6 sm:p-8 border"
        style={{
          borderColor: currentRank.border,
          background: `linear-gradient(135deg, ${currentRank.color}08, transparent)`,
        }}
      >
        <div className="absolute top-0 right-0 w-48 h-48 rounded-full blur-[80px] opacity-10 pointer-events-none"
          style={{ background: currentRank.color }} />

        <div className="relative z-10 flex flex-col sm:flex-row items-start sm:items-center gap-6">
          {/* Glyph */}
          <div className="flex-shrink-0 w-20 h-20 rounded-full border-2 flex items-center justify-center"
            style={{ borderColor: currentRank.border, background: `${currentRank.color}10` }}>
            <span className="text-4xl" style={{ color: currentRank.color }}>{currentRank.glyph}</span>
          </div>

          <div className="flex-1 space-y-2">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[9px] tracking-[0.4em] uppercase" style={{ color: `${currentRank.color}80` }}>
                Resonance Rank
              </span>
            </div>
            <h2 className="font-mono text-2xl sm:text-3xl font-bold tracking-widest uppercase"
              style={{ color: currentRank.color, textShadow: `0 0 30px ${currentRank.color}40` }}>
              {currentRank.name}
            </h2>
            <p className="font-mono text-[10px] text-white/40 leading-relaxed max-w-md">
              {currentRank.desc}
            </p>
          </div>

          <div className="text-right flex-shrink-0">
            <p className="font-mono text-3xl font-bold" style={{ color: currentRank.color }}>
              {currentXP.toLocaleString()}
            </p>
            <p className="font-mono text-[9px] tracking-widest uppercase" style={{ color: `${currentRank.color}60` }}>
              Total XP
            </p>
          </div>
        </div>

        {/* Progress to next rank */}
        {nextRank && (
          <div className="relative z-10 mt-6 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[9px] text-white/30 tracking-widest uppercase">
                Progress to {nextRank.name}
              </span>
              <span className="font-mono text-[9px]" style={{ color: currentRank.color }}>
                {xpToNext.toLocaleString()} XP remaining
              </span>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.05)" }}>
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${progressPct}%` }}
                transition={{ duration: 1.2, ease: "easeOut" }}
                className="h-full rounded-full"
                style={{ background: `linear-gradient(90deg, ${currentRank.color}, ${nextRank.color})` }}
              />
            </div>
          </div>
        )}
        {!nextRank && (
          <div className="relative z-10 mt-4">
            <p className="font-mono text-[9px] text-center tracking-[0.3em] uppercase" style={{ color: "#FBBF2480" }}>
              ⬟ Maximum Resonance Achieved ⬟
            </p>
          </div>
        )}
      </motion.div>

      {/* Stats Row */}
      <div className="grid grid-cols-3 gap-3">
        {STATS.map((stat) => (
          <div key={stat.key} className="p-4 border text-center space-y-1"
            style={{ borderColor: "rgba(139,92,246,0.15)", background: "rgba(124,58,237,0.04)" }}>
            <div className="text-lg text-violet-400">{stat.icon}</div>
            <p className="font-mono text-xl font-bold" style={{ color: "#E0D9FF" }}>
              {(statsData[stat.key] || 0).toLocaleString()}
            </p>
            <p className="font-mono text-[8px] tracking-widest uppercase" style={{ color: "rgba(167,139,250,0.4)" }}>
              {stat.label}
            </p>
          </div>
        ))}
      </div>

      {/* Rank Perks */}
      <div className="space-y-2">
        <p className="font-mono text-[9px] tracking-[0.3em] uppercase" style={{ color: "rgba(167,139,250,0.4)" }}>
          Current Rank Perks
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {currentRank.perks.map((perk, idx) => (
            <div key={idx} className="flex items-center gap-2 px-3 py-2 border"
              style={{ borderColor: "rgba(139,92,246,0.15)", background: "rgba(124,58,237,0.04)" }}>
              <span className="text-violet-400 text-xs">✦</span>
              <span className="font-mono text-[10px] text-white/50">{perk}</span>
            </div>
          ))}
        </div>
      </div>

      {/* All Ranks Timeline */}
      <div className="space-y-2">
        <p className="font-mono text-[9px] tracking-[0.3em] uppercase" style={{ color: "rgba(167,139,250,0.4)" }}>
          Resonance Path
        </p>
        <div className="space-y-2">
          {RANKS.map((rank, idx) => {
            const isUnlocked = currentXP >= rank.xpRequired;
            const isCurrent = rank.name === profile.resonance_rank;
            return (
              <div key={rank.name}
                className="flex items-center gap-3 px-4 py-3 border transition-all"
                style={{
                  borderColor: isUnlocked ? rank.border : "rgba(255,255,255,0.04)",
                  background: isCurrent ? `${rank.color}08` : "rgba(255,255,255,0.01)",
                  opacity: isUnlocked ? 1 : 0.4,
                }}>
                <span style={{ color: isUnlocked ? rank.color : "rgba(255,255,255,0.2)" }}>{rank.glyph}</span>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-semibold tracking-widest uppercase"
                      style={{ color: isUnlocked ? rank.color : "rgba(255,255,255,0.2)" }}>
                      {rank.name}
                    </span>
                    {isCurrent && (
                      <span className="font-mono text-[8px] px-1.5 py-0.5 rounded-full tracking-widest uppercase"
                        style={{ background: `${rank.color}20`, color: rank.color }}>
                        Current
                      </span>
                    )}
                  </div>
                </div>
                <span className="font-mono text-[9px]" style={{ color: "rgba(255,255,255,0.2)" }}>
                  {rank.xpRequired.toLocaleString()} XP
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}