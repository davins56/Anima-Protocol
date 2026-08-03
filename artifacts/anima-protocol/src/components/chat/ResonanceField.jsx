// @ts-check
import { motion } from "framer-motion";
import { RESONANCE_TIERS } from "@/hooks/useResonance";

// 0–100% bond meter shown above the chat. Fills as the exchange deepens;
// threshold ticks mark each resonance tier.
export default function ResonanceField({ value = 0, label = "DISTANT", compact = false }) {
  const v = Math.max(0, Math.min(100, value));
  const high = v >= 75;

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
        <span className="font-mono text-[8px] sm:text-[9px] tracking-[0.25em] uppercase text-primary/80">
          {label} · {v}%
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
            width: { duration: 0.6, ease: "easeOut" },
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