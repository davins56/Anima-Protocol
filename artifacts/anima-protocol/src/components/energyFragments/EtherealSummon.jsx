import { motion } from "framer-motion";
import { elementTheme } from "@/lib/energyFragments/theme";

const GLOW_FILTER = `
  <filter id="ether-glow" x="-40%" y="-40%" width="180%" height="180%">
    <feGaussianBlur stdDeviation="2.4" result="blur"/>
    <feMerge>
      <feMergeNode in="blur"/>
      <feMergeNode in="SourceGraphic"/>
    </feMerge>
  </filter>
`;

function WeaponPaths({ kind, color }) {
  const c = color;
  switch (kind) {
    case "cannon":
      return (
        <>
          <ellipse cx="78" cy="80" rx="18" ry="28" fill="none" stroke={c} strokeWidth="2.2" opacity="0.85" />
          <rect x="78" y="68" width="86" height="24" rx="8" fill="none" stroke={c} strokeWidth="2" />
          <rect x="156" y="72" width="28" height="16" rx="3" fill="none" stroke={c} strokeWidth="1.6" />
          <circle cx="196" cy="80" r="7" fill={c} opacity="0.55" />
        </>
      );
    case "sword":
      return (
        <>
          <path d="M118 28 L126 28 L132 148 L112 148 Z" fill="none" stroke={c} strokeWidth="2" />
          <path d="M122 28 L124 148" stroke={c} strokeWidth="1" opacity="0.5" />
          <rect x="96" y="148" width="52" height="6" fill="none" stroke={c} strokeWidth="1.8" />
          <rect x="114" y="154" width="16" height="22" rx="3" fill="none" stroke={c} strokeWidth="1.8" />
        </>
      );
    case "bomb":
      return (
        <>
          <circle cx="122" cy="92" r="36" fill="none" stroke={c} strokeWidth="2.2" />
          <path d="M122 56 L122 40 L138 28" fill="none" stroke={c} strokeWidth="1.8" />
          <circle cx="142" cy="24" r="5" fill={c} opacity="0.7" />
        </>
      );
    case "spreader":
      return (
        <>
          <path d="M70 80 L150 70 L150 90 L70 80 Z" fill="none" stroke={c} strokeWidth="2" />
          <path d="M150 80 L190 50 M150 80 L200 80 M150 80 L190 110" stroke={c} strokeWidth="1.6" />
          <circle cx="190" cy="50" r="4" fill={c} opacity="0.6" />
          <circle cx="200" cy="80" r="4" fill={c} opacity="0.6" />
          <circle cx="190" cy="110" r="4" fill={c} opacity="0.6" />
        </>
      );
    case "shield":
    case "wrap":
      return (
        <>
          <path d="M122 30 L174 52 L174 108 C174 140 122 168 122 168 C122 168 70 140 70 108 L70 52 Z" fill="none" stroke={c} strokeWidth="2.2" />
          <path d="M122 48 L156 64 L156 108 C156 128 122 148 122 148" fill="none" stroke={c} strokeWidth="1.2" opacity="0.5" />
        </>
      );
    case "hammer":
      return (
        <>
          <rect x="88" y="36" width="68" height="36" rx="4" fill="none" stroke={c} strokeWidth="2.2" />
          <rect x="114" y="72" width="16" height="88" fill="none" stroke={c} strokeWidth="2" />
        </>
      );
    case "fist":
      return (
        <>
          <rect x="78" y="64" width="88" height="56" rx="14" fill="none" stroke={c} strokeWidth="2.2" />
          <path d="M92 64 L92 48 L108 48 L108 64 M118 64 L118 42 L134 42 L134 64 M144 64 L144 50 L160 50 L160 64" fill="none" stroke={c} strokeWidth="1.6" />
        </>
      );
    case "arrow":
      return (
        <>
          <path d="M60 50 L200 80 L60 70 Z" fill="none" stroke={c} strokeWidth="1.6" />
          <path d="M60 80 L200 100 L60 110 Z" fill="none" stroke={c} strokeWidth="1.6" />
          <path d="M60 120 L200 90 L60 140 Z" fill="none" stroke={c} strokeWidth="1.6" />
        </>
      );
    case "tower":
      return (
        <>
          <path d="M122 20 L148 168 L96 168 Z" fill="none" stroke={c} strokeWidth="2" />
          <path d="M122 20 L122 168" stroke={c} strokeWidth="1" opacity="0.45" />
        </>
      );
    case "orbit":
    case "orb":
    case "lockon":
      return (
        <>
          <circle cx="122" cy="90" r="22" fill="none" stroke={c} strokeWidth="2" />
          <ellipse cx="122" cy="90" rx="70" ry="22" fill="none" stroke={c} strokeWidth="1.4" />
          <ellipse cx="122" cy="90" rx="22" ry="70" fill="none" stroke={c} strokeWidth="1.4" />
          <circle cx="192" cy="90" r="5" fill={c} opacity="0.8" />
        </>
      );
    case "gyre":
      return (
        <>
          <path d="M122 30 C170 50 170 130 122 150 C74 130 74 50 122 30" fill="none" stroke={c} strokeWidth="2" />
          <path d="M122 50 C150 64 150 116 122 130 C94 116 94 64 122 50" fill="none" stroke={c} strokeWidth="1.4" />
        </>
      );
    case "mend":
    case "wick":
      return (
        <>
          <circle cx="122" cy="96" r="36" fill="none" stroke={c} strokeWidth="2" />
          <path d="M122 68 L122 124 M96 96 L148 96" stroke={c} strokeWidth="2.2" />
        </>
      );
    case "prism":
      return (
        <>
          <path d="M122 28 L176 150 L68 150 Z" fill="none" stroke={c} strokeWidth="2" />
          <path d="M122 28 L122 150" stroke={c} strokeWidth="1" opacity="0.5" />
          <path d="M96 110 L148 110" stroke={c} strokeWidth="1" opacity="0.5" />
        </>
      );
    case "gravity":
      return (
        <>
          <circle cx="122" cy="96" r="16" fill={c} opacity="0.35" />
          <circle cx="122" cy="96" r="40" fill="none" stroke={c} strokeWidth="1.4" />
          <circle cx="122" cy="96" r="64" fill="none" stroke={c} strokeWidth="1" opacity="0.5" />
        </>
      );
    case "rift":
      return (
        <>
          <path d="M118 24 L126 24 L132 168 L112 168 Z" fill="none" stroke={c} strokeWidth="1.8" />
          <path d="M80 80 L164 112 M80 112 L164 80" stroke={c} strokeWidth="1.2" opacity="0.6" />
        </>
      );
    case "sigil":
      return (
        <>
          <circle cx="122" cy="88" r="28" fill="none" stroke={c} strokeWidth="2" />
          <path d="M122 40 L122 136 M94 70 L150 106 M94 106 L150 70" stroke={c} strokeWidth="1.4" />
          <path d="M88 148 L156 148 L148 168 L96 168 Z" fill="none" stroke={c} strokeWidth="1.6" />
        </>
      );
    default:
      return (
        <>
          <circle cx="122" cy="96" r="44" fill="none" stroke={c} strokeWidth="2" />
          <circle cx="122" cy="96" r="18" fill="none" stroke={c} strokeWidth="1.4" />
          <path d="M122 40 L122 152 M68 96 L176 96" stroke={c} strokeWidth="1.2" opacity="0.6" />
        </>
      );
  }
}

/**
 * Ethereal weapon stage. The summoned form is always translucent glass-light,
 * never a solid prop — ghost barrel, afterimage blade, drifting motes.
 */
export default function EtherealSummon({ fragment, combo = null, compact = false }) {
  const theme = elementTheme(fragment?.element || "void");
  const kind = combo?.summon || fragment?.summon || "cannon";
  const title = combo?.name || fragment?.name || "Fragment";
  const size = compact ? 180 : 260;

  return (
    <div className="relative flex flex-col items-center justify-center" style={{ minHeight: compact ? 200 : 280 }}>
      <motion.div
        aria-hidden
        className="absolute inset-0"
        style={{
          background: `radial-gradient(ellipse at center, ${theme.fill} 0%, transparent 68%)`,
        }}
        animate={{ opacity: [0.45, 0.9, 0.45] }}
        transition={{ duration: 2.4, repeat: Infinity }}
      />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <motion.span
          key={i}
          aria-hidden
          className="absolute w-1 h-1 rounded-full"
          style={{ background: theme.color, left: `${18 + i * 12}%`, top: `${20 + (i % 3) * 22}%` }}
          animate={{ y: [-6, 8, -6], opacity: [0.15, 0.9, 0.15] }}
          transition={{ duration: 2 + i * 0.2, repeat: Infinity, delay: i * 0.15 }}
        />
      ))}
      <motion.svg
        width={size}
        height={size * 0.78}
        viewBox="0 0 244 196"
        className="relative"
        style={{ filter: `drop-shadow(0 0 18px ${theme.glow})` }}
        initial={{ opacity: 0, scale: 0.86, rotate: -6 }}
        animate={{ opacity: [0.55, 1, 0.72, 1], scale: 1, rotate: 0 }}
        transition={{ duration: 1.1, ease: "easeOut" }}
      >
        <defs dangerouslySetInnerHTML={{ __html: GLOW_FILTER }} />
        <g filter="url(#ether-glow)" opacity="0.95">
          <WeaponPaths kind={kind} color={theme.color} />
        </g>
        <g opacity="0.28" transform="translate(6,4)">
          <WeaponPaths kind={kind} color={theme.color} />
        </g>
      </motion.svg>
      <motion.p
        className="relative mt-1 font-mono text-[10px] tracking-[0.35em] uppercase"
        style={{ color: theme.color }}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
      >
        {combo ? `Resonance · ${title}` : `Summon · ${title}`}
      </motion.p>
      <p className="relative mt-1 max-w-xs text-center font-mono text-[9px] tracking-wide text-primary/45">
        {combo?.description || fragment?.summonNote || "Weapon takes an ethereal form — glass-steel, no mass."}
      </p>
    </div>
  );
}
