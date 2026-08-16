// @ts-check
import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import LivingPresence from "./LivingPresence";
import ResonanceField from "./ResonanceField";
import {
  emotionCss,
  getEmotionPalette,
  highlightedCastId,
  lastSpokenLine,
} from "@/lib/livingPresence";

/**
 * Cinematic full-body stage: floor light, emotion aura, living figures,
 * last line as dialogue, and a speak bar.
 *
 * @param {{
 *   open: boolean,
 *   onClose: () => void,
 *   cast: Array<{ id: string, name?: string, avatar_url?: string, build?: string }>,
 *   characterEmotions?: Record<string, { emotion?: string, intensity?: number }>,
 *   resonance?: { value?: number, label?: string },
 *   speaking?: boolean,
 *   thinking?: boolean,
 *   messages?: Array<object>,
 *   onSend: (text: string) => void,
 *   isLoading?: boolean,
 * }} props
 */
export default function LivingPresenceStage({
  open,
  onClose,
  cast = [],
  characterEmotions = {},
  resonance,
  speaking = false,
  thinking = false,
  messages,
  onSend,
  isLoading = false,
}) {
  const inputRef = useRef(/** @type {HTMLInputElement | null} */ (null));
  const last = lastSpokenLine(messages);
  const leadId = highlightedCastId(cast, last, speaking);
  const lead = cast.find((c) => c.id === leadId) || cast[0];
  const leadEmotion = (lead && characterEmotions[lead.id]?.emotion) || "calm";
  const palette = getEmotionPalette(leadEmotion);
  const dialogue =
    last?.content && last.role !== "user"
      ? String(last.content).replace(/\[[^\]]*\]/g, "").trim()
      : "";

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (/** @type {KeyboardEvent} */ e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const t = setTimeout(() => inputRef.current?.focus(), 180);
    return () => {
      window.removeEventListener("keydown", onKey);
      clearTimeout(t);
    };
  }, [open, onClose]);

  if (!open) return null;

  const figureSize = cast.length > 2 ? 280 : cast.length === 2 ? 340 : 420;

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label="Living presence stage"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[9999] flex flex-col items-center overflow-hidden"
      data-living-presence-stage
      style={{
        background: `radial-gradient(ellipse at 50% 38%, hsl(${palette.hue} ${palette.sat}% 8% / 0.95), rgba(0,0,0,0.98) 70%)`,
      }}
    >
      <StageAura hue={palette.hue} sat={palette.sat} />

      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[42%]"
        style={{
          background: `radial-gradient(ellipse at 50% 0%, ${emotionCss(leadEmotion, 0.28)}, transparent 68%)`,
          transform: "perspective(520px) rotateX(62deg)",
          transformOrigin: "center top",
        }}
      />

      <button
        type="button"
        onClick={onClose}
        className="absolute top-5 right-5 z-20 font-mono text-[10px] tracking-[0.25em] uppercase text-primary/70 hover:text-primary border border-primary/30 hover:border-primary/60 rounded px-3 py-1.5 transition-colors"
      >
        ✕ Exit
      </button>

      {resonance && (
        <div className="relative z-10 w-full max-w-md px-6 pt-8">
          <ResonanceField value={resonance.value} label={resonance.label} />
        </div>
      )}

      <div className="relative z-10 flex-1 flex items-end justify-center gap-2 sm:gap-6 px-4 min-h-0 w-full">
        {cast.length === 0 ? (
          <p className="font-mono text-xs text-primary/50 uppercase tracking-widest mb-24">
            No companions on stage
          </p>
        ) : (
          cast.map((character) => {
            const em = characterEmotions[character.id] || {};
            const isLead = character.id === lead?.id;
            return (
              <LivingPresence
                key={character.id}
                character={character}
                emotion={em.emotion || "calm"}
                intensity={em.intensity ?? 5}
                resonance={isLead ? resonance?.value ?? 0 : Math.max(0, (resonance?.value ?? 0) * 0.6)}
                speaking={speaking && isLead}
                thinking={thinking && isLead}
                highlighted={isLead}
                size={isLead ? figureSize : Math.round(figureSize * 0.78)}
                detail={isLead}
                showLabel
              />
            );
          })
        )}
      </div>

      <div className="relative z-10 w-full max-w-lg px-6 pb-5 pt-2 flex flex-col gap-3">
        {dialogue ? (
          <p
            className="font-mono text-sm text-primary/85 leading-relaxed whitespace-pre-wrap text-center max-h-[18vh] overflow-y-auto"
            data-stage-dialogue
          >
            {lead?.name ? (
              <span className="block text-[10px] tracking-[0.28em] uppercase mb-1" style={{ color: emotionCss(leadEmotion) }}>
                {lead.name}
              </span>
            ) : null}
            {dialogue}
          </p>
        ) : null}

        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const input = form.elements.namedItem("stage-line");
            if (!(input instanceof HTMLInputElement)) return;
            const text = input.value.trim();
            if (!text || isLoading) return;
            input.value = "";
            onSend(text);
          }}
        >
          <input
            ref={inputRef}
            name="stage-line"
            placeholder={lead?.name ? `Speak to ${lead.name}...` : "Speak..."}
            className="flex-1 bg-black/50 border border-primary/30 focus:border-primary/70 rounded px-4 py-2.5 font-mono text-sm text-primary placeholder:text-primary/30 outline-none"
            autoComplete="off"
          />
          <button
            type="submit"
            disabled={isLoading}
            className="font-mono text-[11px] tracking-widest uppercase text-black bg-primary/90 hover:bg-primary disabled:opacity-40 rounded px-4 transition-colors"
          >
            {isLoading ? "..." : "Send"}
          </button>
        </form>
      </div>
    </motion.div>
  );
}

/**
 * @param {{ hue: number, sat: number }} props
 */
function StageAura({ hue, sat }) {
  const canvasRef = useRef(/** @type {HTMLCanvasElement | null} */ (null));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;

    let raf = 0;
    let running = true;
    const particles = Array.from({ length: 48 }, () => ({
      x: Math.random(),
      y: Math.random(),
      r: 0.6 + Math.random() * 1.8,
      s: 0.08 + Math.random() * 0.22,
      a: 0.15 + Math.random() * 0.4,
    }));

    const resize = () => {
      canvas.width = canvas.clientWidth;
      canvas.height = canvas.clientHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    const tick = () => {
      if (!running) return;
      const { width, height } = canvas;
      ctx.clearRect(0, 0, width, height);
      for (const p of particles) {
        p.y -= p.s / 120;
        if (p.y < -0.02) p.y = 1.02;
        ctx.beginPath();
        ctx.fillStyle = `hsla(${hue}, ${sat}%, 70%, ${p.a})`;
        ctx.arc(p.x * width, p.y * height, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);

    return () => {
      running = false;
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [hue, sat]);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 w-full h-full opacity-70"
      aria-hidden="true"
    />
  );
}
