/**
 * Continuous W-axis tuner (0–100). One detent-free control whose colour crossfades
 * along the resonance spectrum (Figma: FrequencyTuner · tokens from styles/anima-tokens.ts).
 * Fine-tune buttons nudge by ±0.1 (sub-band precision, not detents).
 */
import { SERENITY_SIGNATURE_FREQ } from "@/lib/resonance/tuning";
import { RESONANCE_GRADIENT_CSS, resonanceBandAt, spectrumColorAt } from "@/styles/anima-tokens";

type Props = { value: number; onChange: (v: number) => void; lockStrength: number; lockedLabel?: string | null };

export default function FrequencyTuner({ value, onChange, lockStrength, lockedLabel }: Props) {
  const band = resonanceBandAt(value);
  const color = spectrumColorAt(value);
  const step = (d: number) => onChange(Math.round(Math.min(100, Math.max(0, value + d)) * 10) / 10);
  return (
    <div className="space-y-2 select-none">
      <div className="flex items-baseline justify-between font-mono">
        <span className="text-[10px] tracking-widest uppercase" style={{ color }}>{band.label}</span>
        <span className="text-xl tabular-nums" style={{ color, textShadow: `0 0 12px ${color}66` }}>{value.toFixed(1)}</span>
        <span className="text-[10px] tracking-widest uppercase text-muted-foreground">
          {lockedLabel ? `◉ ${lockedLabel}` : "scanning"} · {Math.round(lockStrength * 100)}%
        </span>
      </div>
      <div className="relative h-3 overflow-hidden border border-border" style={{ background: RESONANCE_GRADIENT_CSS }}>
        <div className="absolute inset-0 bg-black/40" style={{ clipPath: `inset(0 0 0 ${value}%)` }} />
        <div className="absolute top-0 bottom-0 w-0.5 bg-white" style={{ left: `${value}%`, boxShadow: `0 0 8px ${color}` }} />
        <div className="absolute top-0 bottom-0 w-px bg-white/40" style={{ left: `${SERENITY_SIGNATURE_FREQ}%` }} title="Signature" />
      </div>
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => step(-0.1)} className="min-w-[44px] min-h-[44px] border border-border font-mono" aria-label="Fine tune down">−</button>
        <input
          type="range"
          min={0}
          max={100}
          step="any"
          value={value}
          onChange={(e) => onChange(Math.round(Number(e.target.value) * 10) / 10)}
          className="flex-1"
          style={{ accentColor: color }}
          aria-label="Tune frequency"
        />
        <button type="button" onClick={() => step(0.1)} className="min-w-[44px] min-h-[44px] border border-border font-mono" aria-label="Fine tune up">+</button>
      </div>
      <div className="h-1 bg-border">
        <div className="h-full transition-[width] duration-150" style={{ width: `${lockStrength * 100}%`, background: color }} />
      </div>
    </div>
  );
}
