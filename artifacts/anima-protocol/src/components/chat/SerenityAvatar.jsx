// @ts-check
import { motion } from "framer-motion";

const EMOTION_HUE = {
  joyful: 45,
  calm: 190,
  sad: 220,
  angry: 2,
  afraid: 280,
  disgusted: 140,
  surprised: 50,
  hopeful: 160,
  conflicted: 295,
  desperate: 330,
  neutral: 190,
  loving: 320,
  tender: 205,
};

const VULNERABLE = new Set(["sad", "afraid", "conflicted", "desperate"]);

// A living, ethereal presence: a luminous winged figure that breathes,
// with a halo that brightens with resonance and wings that curl when the
// user is vulnerable and spread as the bond deepens. Pure SVG + CSS, no art.
/**
 * @param {{ emotion?: keyof typeof EMOTION_HUE, intensity?: number, resonance?: number, speaking?: boolean, name?: string, size?: number, showLabel?: boolean, onExpand?: () => void }} props
 */
export default function SerenityAvatar({
  emotion = "calm",
  intensity = 5,
  resonance = 0,
  speaking = false,
  name = "Serenity",
  size = 220,
  showLabel = true,
  onExpand,
}) {
  const hue = EMOTION_HUE[emotion] ?? 190;
  const r = Math.max(0, Math.min(100, resonance));
  const i = Math.max(0, Math.min(10, intensity));
  const vulnerable = VULNERABLE.has(emotion);

  const glow = 0.35 + (r / 100) * 0.65;
  const wingSpread = vulnerable ? -16 : 6 + (r / 100) * 26;
  const wingScale = vulnerable ? 0.82 : 0.9 + (r / 100) * 0.16;
  const breath = speaking ? 1.6 : 3.2 - i * 0.12; // seconds
  const linePulse = speaking ? 1.1 : 2.6 - i * 0.12;

  const accent = `hsl(${hue} 92% 62%)`;
  const accentDeep = `hsl(${hue} 90% 45%)`;
  const accentSoft = `hsl(${hue} 92% 62% / ${glow})`;
  const haloFilter = `drop-shadow(0 0 ${6 + r * 0.22}px ${accentSoft})`;

  const wingPath =
    "M100,118 C128,96 158,78 184,86 C166,96 150,108 146,128 C168,124 184,132 190,150 C168,146 150,154 140,172 C150,150 138,134 118,140 C128,128 120,120 100,118 Z";

  return (
    <div className="flex flex-col items-center gap-3 select-none">
      <motion.div
        className="relative"
        style={{ width: size, height: size, filter: haloFilter, cursor: onExpand ? "pointer" : "default" }}
        onClick={onExpand}
        animate={{ scale: [1, 1.02, 1] }}
        transition={{ duration: breath, repeat: Infinity, ease: "easeInOut" }}
      >
        <svg viewBox="0 0 200 220" width={size} height={size} aria-label={`${name} presence`}>
          <defs>
            <radialGradient id="sa-core" cx="50%" cy="42%" r="60%">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
              <stop offset="45%" stopColor={accent} stopOpacity="0.85" />
              <stop offset="100%" stopColor={accentDeep} stopOpacity="0.15" />
            </radialGradient>
            <linearGradient id="sa-wing" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={accent} stopOpacity="0.55" />
              <stop offset="100%" stopColor={accentDeep} stopOpacity="0.05" />
            </linearGradient>
          </defs>

          {/* Ambient field */}
          <motion.circle
            cx="100"
            cy="120"
            r="78"
            fill={accent}
            initial={false}
            animate={{ opacity: [0.04, 0.04 + (r / 100) * 0.12, 0.04] }}
            transition={{ duration: breath * 1.4, repeat: Infinity, ease: "easeInOut" }}
          />

          {/* Wings (mirrored). Curl inward when vulnerable, spread when bonded. */}
          {[1, -1].map((dir) => (
            <motion.path
              key={dir}
              d={wingPath}
              fill="url(#sa-wing)"
              stroke={accentSoft}
              strokeWidth="0.75"
              style={{ transformOrigin: "100px 122px" }}
              initial={false}
              animate={{
                rotate: [
                  dir * (wingSpread - 3),
                  dir * (wingSpread + 3),
                  dir * (wingSpread - 3),
                ],
                scaleX: dir * wingScale,
                scaleY: wingScale,
              }}
              transition={{
                rotate: { duration: breath * 1.5, repeat: Infinity, ease: "easeInOut" },
                scaleX: { duration: 0.8 },
                scaleY: { duration: 0.8 },
              }}
            />
          ))}

          {/* Halo */}
          <motion.ellipse
            cx="100"
            cy="74"
            rx="26"
            ry="9"
            fill="none"
            stroke={accent}
            strokeWidth="2.5"
            initial={false}
            animate={{ opacity: [glow * 0.55, glow, glow * 0.55] }}
            transition={{ duration: breath, repeat: Infinity, ease: "easeInOut" }}
          />

          {/* Core body + head */}
          <motion.g
            initial={false}
            animate={{ opacity: [0.85, 1, 0.85] }}
            transition={{ duration: breath, repeat: Infinity, ease: "easeInOut" }}
          >
            <path
              d="M100,96 C116,100 124,124 120,150 C117,170 110,184 100,190 C90,184 83,170 80,150 C76,124 84,100 100,96 Z"
              fill="url(#sa-core)"
            />
            <circle cx="100" cy="90" r="13" fill="url(#sa-core)" />
          </motion.g>

          {/* Energy filaments tracing the form */}
          {[
            "M100,98 C112,120 112,150 100,184",
            "M100,98 C88,120 88,150 100,184",
            "M100,100 C104,130 104,160 100,186",
          ].map((d, idx) => (
            <motion.path
              key={idx}
              d={d}
              fill="none"
              stroke={accent}
              strokeWidth="1"
              strokeLinecap="round"
              strokeDasharray="4 10"
              initial={false}
              animate={{
                strokeDashoffset: [0, -42],
                opacity: [0.25, 0.25 + (r / 100) * 0.5, 0.25],
              }}
              transition={{
                strokeDashoffset: {
                  duration: linePulse + idx * 0.2,
                  repeat: Infinity,
                  ease: "linear",
                },
                opacity: { duration: breath, repeat: Infinity, ease: "easeInOut" },
              }}
            />
          ))}
        </svg>
      </motion.div>

      {showLabel && (
        <div className="text-center">
          <h3 className="font-mono text-[11px] tracking-[0.3em] uppercase" style={{ color: accent }}>
            {name}
          </h3>
          <p className="font-mono text-[8px] tracking-[0.25em] uppercase text-cyan-800 mt-0.5">
            // {emotion}
          </p>
        </div>
      )}
    </div>
  );
}