// @ts-check
import { motion } from "framer-motion";
import {
  SERENITY_PRESENCE_SRC,
  resolvePresenceSprite,
} from "@/lib/livingPresence";

/**
 * Serenity's canonical likeness, drifting around the chat composer.
 * Replaces the old geometric / rail vessel with the illustrated figure.
 *
 * @param {{
 *   character?: { name?: string, avatar_url?: string, body_url?: string, full_body_url?: string, _isAnima?: boolean, category?: string },
 *   speaking?: boolean,
 *   thinking?: boolean,
 *   onExpand?: () => void,
 * }} props
 */
export default function FloatingChatAnima({
  character,
  speaking = false,
  thinking = false,
  onExpand,
}) {
  const name = character?.name || "Serenity";
  const src = resolvePresenceSprite(character) || SERENITY_PRESENCE_SRC;

  return (
    <motion.button
      type="button"
      data-floating-chat-anima
      aria-label={`${name} — open presence stage`}
      onClick={onExpand}
      disabled={!onExpand}
      className="pointer-events-auto absolute z-20 border-0 bg-transparent p-0 cursor-pointer disabled:cursor-default"
      style={{
        right: "0.35rem",
        bottom: "calc(100% - 1.25rem)",
        width: "7.25rem",
        height: "9.5rem",
      }}
      animate={{
        x: speaking ? [0, 10, -4, 8, 0] : [0, 14, 4, -10, 0],
        y: speaking ? [0, -10, -4, -12, 0] : [0, -16, -6, -18, 0],
      }}
      transition={{
        duration: speaking ? 3.4 : 7.2,
        repeat: Infinity,
        ease: "easeInOut",
      }}
    >
      <span
        className="pointer-events-none absolute left-1/2 bottom-1 h-3 w-10 -translate-x-1/2 rounded-full bg-cyan-400/35 blur-md"
        aria-hidden="true"
      />
      <img
        src={src}
        alt=""
        data-floating-chat-anima-sprite
        draggable={false}
        className="relative h-full w-full object-contain object-bottom drop-shadow-[0_0_18px_rgba(56,189,248,0.55)]"
      />
      {thinking && (
        <motion.span
          className="absolute right-2 top-3 h-2 w-2 rounded-full bg-cyan-300"
          style={{ boxShadow: "0 0 8px rgba(103,232,249,0.9)" }}
          animate={{ opacity: [0.35, 1, 0.35], y: [0, -6, 0] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
          aria-hidden="true"
        />
      )}
    </motion.button>
  );
}
