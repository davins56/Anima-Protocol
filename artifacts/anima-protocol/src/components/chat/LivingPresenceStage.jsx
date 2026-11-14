// @ts-check
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window === "undefined" ? 1024 : window.innerWidth,
  );
  const last = lastSpokenLine(messages);
  const leadId = highlightedCastId(cast, last, speaking);
  const lead = cast.find((c) => c.id === leadId) || cast[0];
  const leadEmotion = (lead && characterEmotions[lead.id]?.emotion) || "calm";
  const palette = getEmotionPalette(leadEmotion);
  const dialogue =
    last?.content && last.role !== "user"
      ? String(last.content)
          .replace(/\[[^\]]*\]/g, "")
          .trim()
      : "";

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (/** @type {KeyboardEvent} */ e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    onResize();
    // Opening Stage on a phone should not immediately open the keyboard and
    // shrink the scene. Desktop keyboard users still land on the speak field.
    const t = window.matchMedia?.("(pointer: fine)")?.matches
      ? setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 180)
      : null;
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
      if (t != null) clearTimeout(t);
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  const figureSize = Math.min(
    cast.length > 2 ? 280 : cast.length === 2 ? 340 : 420,
    Math.max(1, Math.floor((viewportWidth - 32) / 0.78)),
  );

  // Chat's animated ancestors create a containing/stacking context for fixed
  // descendants. Escape it so the modal cannot be clipped below the tab bar.
  return createPortal(
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label="Living presence stage"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-x-0 top-0 z-[9999] flex min-h-0 flex-col items-center overflow-hidden"
      data-living-presence-stage
      style={{
        height: "var(--app-height, 100dvh)",
        maxHeight: "var(--app-height, 100dvh)",
        paddingTop: "env(safe-area-inset-top, 0px)",
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

      <div className="relative z-20 flex w-full shrink-0 justify-end px-4 py-3">
        <button
          type="button"
          onClick={onClose}
          className="font-mono text-[10px] tracking-[0.25em] uppercase text-primary/70 hover:text-primary border border-primary/30 hover:border-primary/60 rounded px-3 py-2 transition-colors"
        >
          ✕ Exit
        </button>
      </div>

      {resonance && (
        <div className="relative z-10 w-full max-w-md shrink-0 px-6 pb-2">
          <ResonanceField value={resonance.value} label={resonance.label} resetKey={resonance.source ?? null} />
        </div>
      )}

      <div
        className="relative z-10 min-h-0 w-full flex-1 overflow-y-auto overscroll-y-contain touch-pan-y"
        style={{ WebkitOverflowScrolling: "touch" }}
        tabIndex={0}
        aria-label="Stage content"
        data-stage-scroll
      >
        <div className="flex min-h-full flex-col items-center justify-end gap-3 px-4 pb-3 pt-4">
          <div className="flex w-full shrink-0 flex-wrap items-end justify-center gap-2 sm:gap-6">
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
                    resonance={
                      isLead
                        ? (resonance?.value ?? 0)
                        : Math.max(0, (resonance?.value ?? 0) * 0.6)
                    }
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

          {dialogue ? (
            <p
              className="w-full max-w-lg shrink-0 break-words px-2 font-mono text-sm text-primary/85 leading-relaxed whitespace-pre-wrap text-center"
              data-stage-dialogue
            >
              {lead?.name ? (
                <span
                  className="block text-[10px] tracking-[0.28em] uppercase mb-1"
                  style={{ color: emotionCss(leadEmotion) }}
                >
                  {lead.name}
                </span>
              ) : null}
              {dialogue}
            </p>
          ) : null}
        </div>
      </div>

      <div
        className="relative z-10 w-full max-w-lg shrink-0 px-4 pt-2"
        style={{
          paddingBottom:
            "calc(var(--safe-bottom, env(safe-area-inset-bottom, 0px)) + 1rem)",
        }}
        data-stage-composer
      >
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
            className="min-w-0 flex-1 bg-black/50 border border-primary/30 focus:border-primary/70 rounded px-4 py-2.5 font-mono text-base text-primary placeholder:text-primary/30 outline-none"
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
    </motion.div>,
    document.body,
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
      if (typeof requestAnimationFrame === "function") {
        raf = requestAnimationFrame(tick);
      }
    };
    if (typeof requestAnimationFrame === "function") {
      raf = requestAnimationFrame(tick);
    }

    return () => {
      running = false;
      if (typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(raf);
      }
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
