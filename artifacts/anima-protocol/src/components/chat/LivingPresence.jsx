// @ts-check
import { motion } from "framer-motion";
import {
  getPose,
  getIdleSway,
  emotionCss,
  resolvePresenceSprite,
  SERENITY_PRESENCE_SRC,
  SERENITY_PRESENCE_DETAIL_SRC,
} from "@/lib/livingPresence";

/**
 * Full-body living companion on the messages screen: Serenity's illustrated
 * figure (or the companion's portrait) floats, breathes, and glows from
 * emotion + speaking state — not a geometric vessel mesh.
 *
 * @param {{
 *   character?: { id?: string, name?: string, avatar_url?: string, body_url?: string, full_body_url?: string, build?: string, _isAnima?: boolean, category?: string },
 *   emotion?: string,
 *   intensity?: number,
 *   resonance?: number,
 *   speaking?: boolean,
 *   thinking?: boolean,
 *   highlighted?: boolean,
 *   size?: number,
 *   showLabel?: boolean,
 *   detail?: boolean,
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
  detail = false,
  onExpand,
}) {
  const name = character?.name || "Companion";
  const pose = getPose(emotion, intensity);
  const r = Math.max(0, Math.min(100, Number(resonance) || 0));
  const accent = emotionCss(emotion, 1);
  const accentSoft = emotionCss(emotion, 0.55 + (r / 100) * 0.35);
  const glow = 0.28 + (r / 100) * 0.55 + (highlighted ? 0.12 : 0);
  const breath = speaking ? Math.max(1.2, pose.breath * 0.55) : pose.breath;
  const sway = getIdleSway(speaking, pose.bounce);
  const width = Math.round(size * 0.78);
  const dim = highlighted ? 1 : 0.72;
  const spriteSrc = resolvePresenceSprite(character, { detail });
  const usesCanonical =
    spriteSrc === SERENITY_PRESENCE_SRC || spriteSrc === SERENITY_PRESENCE_DETAIL_SRC;

  return (
    <div
      className="flex flex-col items-center gap-2 select-none"
      style={{ opacity: dim }}
      data-living-presence
      data-emotion={pose.emotion}
      data-speaking={speaking ? "true" : "false"}
      data-thinking={thinking ? "true" : "false"}
      data-presence-kind={usesCanonical ? "serenity" : spriteSrc ? "portrait" : "fallback"}
    >
      <button
        type="button"
        className="relative bg-transparent border-0 p-0 cursor-pointer"
        style={{
          width,
          height: size,
          filter: `drop-shadow(0 0 ${14 + r * 0.22}px ${accentSoft})`,
        }}
        onClick={onExpand}
        disabled={!onExpand}
        aria-label={`${name} living presence${onExpand ? ", open stage" : ""}`}
      >
        <motion.div
          className="relative"
          style={{ width, height: size }}
          animate={{
            rotate: pose.bounce
              ? [-sway, sway, -sway]
              : [-sway * 0.6, sway * 0.6, -sway * 0.6],
            y: pose.bounce ? [0, -8 - pose.intensity * 4, 0] : [0, -4, 0],
          }}
          transition={{ duration: breath, repeat: Infinity, ease: "easeInOut" }}
        >
          <div
            className="pointer-events-none absolute left-1/2 bottom-[2%] -translate-x-1/2 rounded-full blur-md"
            style={{
              width: width * 0.62,
              height: 18,
              background: emotionCss(emotion, 0.35 + glow * 0.25),
            }}
            aria-hidden="true"
          />

          <motion.div
            className="pointer-events-none absolute inset-0"
            style={{
              background: `radial-gradient(ellipse at 50% 42%, ${emotionCss(emotion, 0.22 + glow * 0.18)}, transparent 68%)`,
            }}
            animate={{ opacity: [0.55, 0.9, 0.55] }}
            transition={{ duration: breath * 1.3, repeat: Infinity, ease: "easeInOut" }}
            aria-hidden="true"
          />

          {spriteSrc ? (
            <motion.img
              src={spriteSrc}
              alt=""
              data-presence-sprite
              className="relative z-10 h-full w-full object-contain object-bottom"
              draggable={false}
              animate={{
                scale: speaking ? [1, 1.03, 1] : [1, 1.012, 1],
                filter: speaking
                  ? [
                      `brightness(1.05) saturate(1.08)`,
                      `brightness(1.18) saturate(1.15)`,
                      `brightness(1.05) saturate(1.08)`,
                    ]
                  : `brightness(${0.96 + glow * 0.12})`,
              }}
              transition={{ duration: breath, repeat: Infinity, ease: "easeInOut" }}
            />
          ) : (
            <div
              className="relative z-10 flex h-full w-full items-center justify-center font-mono text-4xl"
              style={{ color: accent }}
            >
              {name[0]?.toUpperCase() || "?"}
            </div>
          )}

          {thinking && (
            <motion.span
              className="absolute z-20 rounded-full"
              style={{
                width: 8,
                height: 8,
                background: accent,
                boxShadow: `0 0 10px ${accent}`,
              }}
              animate={{
                left: ["72%", "82%", "50%", "18%", "72%"],
                top: ["10%", "4%", "2%", "4%", "10%"],
                opacity: [0.4, 1, 0.5, 1, 0.4],
              }}
              transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
              aria-hidden="true"
            />
          )}
        </motion.div>
      </button>

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
