// @ts-check
import { useId, useMemo } from "react";
import { motion } from "framer-motion";
import {
  getPose,
  getBuildMetrics,
  getEmotionPalette,
  getIdleSway,
  emotionCss,
} from "@/lib/livingPresence";

/**
 * Full-body living companion: portrait-as-face on a luminous vessel that
 * breathes, sways, and gestures from emotion + speaking state.
 *
 * @param {{
 *   character?: { id?: string, name?: string, avatar_url?: string, build?: string },
 *   emotion?: string,
 *   intensity?: number,
 *   resonance?: number,
 *   speaking?: boolean,
 *   thinking?: boolean,
 *   highlighted?: boolean,
 *   size?: number,
 *   showLabel?: boolean,
 *   onExpand?: () => void,
 * }} props
 */
export default function LivingPresence({
  character,
  emotion = "calm",
  intensity = 5,
  resonance = 0,
  speaking = false,
  thinking = false,
  highlighted = true,
  size = 280,
  showLabel = true,
  onExpand,
}) {
  const uid = useId().replace(/:/g, "");
  const name = character?.name || "Companion";
  const avatarUrl = character?.avatar_url;
  const pose = useMemo(() => getPose(emotion, intensity), [emotion, intensity]);
  const build = useMemo(() => getBuildMetrics(character?.build), [character?.build]);
  const palette = getEmotionPalette(emotion);
  const r = Math.max(0, Math.min(100, Number(resonance) || 0));
  const accent = emotionCss(emotion, 1);
  const accentSoft = emotionCss(emotion, 0.55 + (r / 100) * 0.35);
  const accentDeep = `hsl(${palette.hue} ${palette.sat}% ${Math.max(28, palette.light - 18)}%)`;
  const glow = 0.28 + (r / 100) * 0.55 + (highlighted ? 0.12 : 0);
  const breath = speaking ? Math.max(1.2, pose.breath * 0.55) : pose.breath;
  const sway = getIdleSway(speaking, pose.bounce);
  const width = Math.round(size * (240 / 540));
  const dim = highlighted ? 1 : 0.72;

  const coreId = `lp-core-${uid}`;
  const wingId = `lp-wing-${uid}`;
  const floorId = `lp-floor-${uid}`;

  return (
    <div
      className="flex flex-col items-center gap-2 select-none"
      style={{ opacity: dim }}
      data-living-presence
      data-emotion={pose.emotion}
      data-speaking={speaking ? "true" : "false"}
      data-thinking={thinking ? "true" : "false"}
    >
      <motion.button
        type="button"
        className="relative bg-transparent border-0 p-0 cursor-pointer"
        style={{
          width,
          height: size,
          filter: `drop-shadow(0 0 ${10 + r * 0.18}px ${accentSoft})`,
        }}
        onClick={onExpand}
        disabled={!onExpand}
        aria-label={`${name} living presence${onExpand ? ", open stage" : ""}`}
        animate={{
          rotate: pose.bounce
            ? [-sway, sway, -sway]
            : [-sway * 0.6, sway * 0.6, -sway * 0.6],
          y: pose.bounce ? [0, -6 - pose.intensity * 4, 0] : [0, -2, 0],
        }}
        transition={{ duration: breath, repeat: Infinity, ease: "easeInOut" }}
      >
        <svg
          viewBox="0 0 240 540"
          width={width}
          height={size}
          aria-hidden="true"
          className="overflow-visible"
        >
          <defs>
            <radialGradient id={coreId} cx="50%" cy="35%" r="70%">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.92" />
              <stop offset="42%" stopColor={accent} stopOpacity="0.82" />
              <stop offset="100%" stopColor={accentDeep} stopOpacity="0.12" />
            </radialGradient>
            <linearGradient id={wingId} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={accent} stopOpacity="0.5" />
              <stop offset="100%" stopColor={accentDeep} stopOpacity="0.04" />
            </linearGradient>
            <radialGradient id={floorId} cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor={accent} stopOpacity="0.45" />
              <stop offset="100%" stopColor={accent} stopOpacity="0" />
            </radialGradient>
            <clipPath id={`lp-head-${uid}`}>
              <circle cx="120" cy="108" r="50" />
            </clipPath>
          </defs>

          {/* Floor light */}
          <ellipse cx="120" cy="518" rx={68 * build.stance} ry="14" fill={`url(#${floorId})`} />

          {/* Ambient aura */}
          <motion.ellipse
            cx="120"
            cy="280"
            rx={90 * build.shoulder}
            ry="210"
            fill={accent}
            initial={false}
            animate={{ opacity: [0.03, 0.03 + glow * 0.12, 0.03] }}
            transition={{ duration: breath * 1.3, repeat: Infinity, ease: "easeInOut" }}
          />

          {/* Cape / energy wings */}
          {[1, -1].map((dir) => (
            <motion.path
              key={dir}
              d="M120,210 C150,190 186,176 204,198 C178,206 164,228 160,258 C188,250 206,268 210,300 C180,292 158,310 148,338 C162,300 148,250 120,236 Z"
              fill={`url(#${wingId})`}
              stroke={accentSoft}
              strokeWidth="0.8"
              style={{ transformOrigin: "120px 240px" }}
              initial={false}
              animate={{
                rotate: [
                  dir * (pose.vulnerable ? -8 : 4 + r * 0.12),
                  dir * (pose.vulnerable ? -4 : 8 + r * 0.16),
                  dir * (pose.vulnerable ? -8 : 4 + r * 0.12),
                ],
                scaleX: dir * (pose.vulnerable ? 0.78 : 0.92 + r / 400),
              }}
              transition={{ duration: breath * 1.45, repeat: Infinity, ease: "easeInOut" }}
            />
          ))}

          <motion.g
            style={{ transformOrigin: "120px 300px" }}
            animate={{
              rotate: pose.lean,
              scaleX: build.torso,
              scaleY: build.height,
            }}
            transition={{ duration: 0.6 }}
          >
            {/* Legs */}
            <motion.g
              animate={{ x: speaking ? [0, 1.5, 0] : [0, 0.6, 0] }}
              transition={{ duration: breath * 1.1, repeat: Infinity, ease: "easeInOut" }}
            >
              <path
                d={`M${120 - pose.stanceWidth * build.stance},330 C${108 - pose.stanceWidth},390 ${104 - pose.stanceWidth},450 ${100 - pose.stanceWidth * 0.6},505 L${118 - pose.stanceWidth * 0.4},505 C${122 - pose.stanceWidth},430 118,370 120,330 Z`}
                fill={`url(#${coreId})`}
                opacity="0.88"
              />
              <path
                d={`M${120 + pose.stanceWidth * build.stance},330 C${132 + pose.stanceWidth},390 ${136 + pose.stanceWidth},450 ${140 + pose.stanceWidth * 0.6},505 L${122 + pose.stanceWidth * 0.4},505 C${118 + pose.stanceWidth},430 122,370 120,330 Z`}
                fill={`url(#${coreId})`}
                opacity="0.88"
              />
            </motion.g>

            {/* Torso */}
            <motion.path
              d="M120,188 C150,196 164,240 158,292 C154,338 140,360 120,368 C100,360 86,338 82,292 C76,240 90,196 120,188 Z"
              fill={`url(#${coreId})`}
              animate={{ scaleY: speaking ? [1, 1.035, 1] : [1, 1.02, 1] }}
              style={{ transformOrigin: "120px 280px" }}
              transition={{ duration: breath, repeat: Infinity, ease: "easeInOut" }}
            />

            {/* Arms */}
            <Arm
              side="left"
              accent={accent}
              coreId={coreId}
              rotate={pose.armL.rotate + (speaking ? -10 : thinking ? 10 : 0)}
              lift={pose.armL.lift + pose.shoulderLift}
              speaking={speaking}
              breath={breath}
            />
            <Arm
              side="right"
              accent={accent}
              coreId={coreId}
              rotate={pose.armR.rotate + (speaking ? 12 : thinking ? 16 : 0)}
              lift={pose.armR.lift + pose.shoulderLift}
              speaking={speaking}
              breath={breath}
            />

            {/* Neck */}
            <rect x="112" y="154" width="16" height="38" rx="7" fill={`url(#${coreId})`} />

            {/* Head vessel (portrait sits on top via overlay) */}
            <motion.g
              style={{ transformOrigin: "120px 108px" }}
              animate={{
                rotate: pose.headTilt + (thinking ? 8 : 0),
                y: pose.headDrop,
              }}
              transition={{ duration: 0.55 }}
            >
              <circle
                cx="120"
                cy="108"
                r="54"
                fill="none"
                stroke={accent}
                strokeWidth="2.2"
                opacity={0.55 + glow * 0.4}
              />
              <circle cx="120" cy="108" r="50" fill={`url(#${coreId})`} />
              {avatarUrl ? (
                <image
                  href={avatarUrl}
                  x="70"
                  y="58"
                  width="100"
                  height="100"
                  clipPath={`url(#lp-head-${uid})`}
                  preserveAspectRatio="xMidYMid slice"
                />
              ) : (
                <text
                  x="120"
                  y="118"
                  textAnchor="middle"
                  fill={accent}
                  fontSize="36"
                  fontFamily="ui-monospace, monospace"
                >
                  {name[0]?.toUpperCase() || "?"}
                </text>
              )}

              {/* Viseme — mouth glow over the lower face */}
              <motion.ellipse
                cx="120"
                cy="138"
                rx="10"
                ry="5"
                fill={accent}
                style={{ transformOrigin: "120px 138px" }}
                animate={
                  speaking
                    ? { scaleY: [0.25, 1.15, 0.4, 0.95, 0.25], opacity: [0.35, 0.85, 0.5, 0.8, 0.35] }
                    : { scaleY: 0.2, opacity: 0.15 }
                }
                transition={
                  speaking
                    ? { duration: 0.42, repeat: Infinity, ease: "easeInOut" }
                    : { duration: 0.25 }
                }
              />
            </motion.g>
          </motion.g>

          {/* Energy filaments */}
          {["M120,190 C138,250 138,330 120,430", "M120,190 C102,250 102,330 120,430"].map((d, idx) => (
            <motion.path
              key={idx}
              d={d}
              fill="none"
              stroke={accent}
              strokeWidth="1.1"
              strokeLinecap="round"
              strokeDasharray="5 12"
              initial={false}
              animate={{
                strokeDashoffset: [0, -48],
                opacity: speaking ? [0.45, 0.9, 0.45] : [0.18, 0.18 + (r / 100) * 0.4, 0.18],
              }}
              transition={{
                strokeDashoffset: {
                  duration: (speaking ? 1.1 : 2.8) + idx * 0.2,
                  repeat: Infinity,
                  ease: "linear",
                },
                opacity: { duration: breath, repeat: Infinity, ease: "easeInOut" },
              }}
            />
          ))}

          {/* Thinking orbit */}
          {thinking && (
            <motion.circle
              cx="168"
              cy="72"
              r="5"
              fill={accent}
              animate={{
                cx: [168, 178, 120, 62, 168],
                cy: [72, 40, 28, 40, 72],
                opacity: [0.4, 1, 0.5, 1, 0.4],
              }}
              transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
            />
          )}
        </svg>
      </motion.button>

      {showLabel && (
        <div className="text-center px-1">
          <h3
            className="font-mono text-[11px] tracking-[0.28em] uppercase"
            style={{ color: accent }}
          >
            {name}
          </h3>
          <p className="font-mono text-[8px] tracking-[0.22em] uppercase text-cyan-800 mt-0.5">
            // {thinking ? "thinking" : speaking ? "speaking" : pose.emotion}
          </p>
        </div>
      )}
    </div>
  );
}

function Arm({ side, accent, coreId, rotate, lift, speaking, breath }) {
  const origin = side === "left" ? "92px 210px" : "148px 210px";
  const d =
    side === "left"
      ? "M96,208 C70,250 58,310 64,356 C72,360 84,352 86,330 C90,290 98,240 108,214 Z"
      : "M144,208 C170,250 182,310 176,356 C168,360 156,352 154,330 C150,290 142,240 132,214 Z";

  return (
    <motion.path
      d={d}
      fill={`url(#${coreId})`}
      stroke={accent}
      strokeWidth="0.6"
      strokeOpacity="0.35"
      style={{ transformOrigin: origin }}
      initial={false}
      animate={{
        rotate: speaking ? [rotate - 6, rotate + 8, rotate - 4, rotate] : rotate,
        y: -lift,
      }}
      transition={
        speaking
          ? { duration: Math.max(1.1, breath * 0.7), repeat: Infinity, ease: "easeInOut" }
          : { duration: 0.55 }
      }
    />
  );
}
