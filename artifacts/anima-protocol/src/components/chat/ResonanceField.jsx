// @ts-check
import { AnimatePresence, motion } from "framer-motion";
import { RESONANCE_TIERS } from "@/hooks/useResonance";
import { formatMeterDelta, useMeterDelta } from "@/hooks/useMeterDelta";

// 0–100% bond meter shown above the chat. Fills as the exchange deepens;
// threshold ticks mark each resonance tier. A short "+2" / "−3" flash shows
// how much the last turn moved it. `resetKey` (companion + data source) keeps
// a companion switch or the first server read from flashing as a change.
export default function ResonanceField({ value = 0, label = "DISTANT", compact = false, resetKey = null }) {
  const v = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  const high = v >= 75;
  const { delta, pulse } = useMeterDelta(v, { resetKey });

  return (
    <div
      className={`w-full ${compact ? "px-3 py-1.5" : "px-3 sm:px-4 py-2"} border-b border-primary/15 bg-black/40 backdrop-blur-sm`}
      role="meter"
      aria-valuenow={v}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Resonance Field"
    >
      <div className="flex items-center justify-between mb-1">
        <span className="font-mono text-[8px] sm:text-[9px] tracking-[0.3em] uppercase text-primary/60">
          // Resonance Field
        </span>
        <span className="flex items-center gap-1.5 font-mono text-[8px] sm:text-[9px] tracking-[0.25em] uppercase text-primary/80">
          <AnimatePresence>
            {delta != null && (
              <motion.span
                key={pulse}
                data-testid="resonance-delta"
                aria-live="polite"
                className={delta > 0 ? "text-cyan-300" : "text-rose-300"}
                initial={{ opacity: 0, y: delta > 0 ? 4 : -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.35 }}
              >
                {formatMeterDelta(delta)}
              </motion.span>
            )}
          </AnimatePresence>
          <span>
            {label} · {v}%
          </span>
        </span>
      </div>

      <div className="relative h-1.5 rounded-full bg-primary/10 overflow-hidden border border-primary/15">
        <motion.div
          className="h-full rounded-full"
          style={{
            background:
              "linear-gradient(90deg, hsl(190 90% 45%), hsl(190 95% 60%), hsl(200 95% 70%))",
            boxShadow: high ? "0 0 10px hsl(190 95% 60% / 0.8)" : "0 0 5px hsl(190 90% 55% / 0.4)",
          }}
          initial={false}
          animate={{
            width: `${v}%`,
            opacity: high ? [0.85, 1, 0.85] : 1,
          }}
          transition={{
            width: { duration: 0.9, ease: [0.22, 1, 0.36, 1] },
            opacity: { duration: 1.4, repeat: high ? Infinity : 0, ease: "easeInOut" },
          }}
        />

        {/* tier threshold ticks */}
        {RESONANCE_TIERS.filter((t) => t.min > 0).map((t) => (
          <span
            key={t.min}
            className="absolute top-0 bottom-0 w-px bg-black/50"
            style={{ left: `${t.min}%` }}
          />
        ))}
      </div>
    </div>
  );
}