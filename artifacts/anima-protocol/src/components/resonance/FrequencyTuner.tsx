/** Band-colored frequency dial with fine-tune and lock indicator. */
import { BANDS, bandOf, SERENITY_SIGNATURE_FREQ } from "@/lib/resonance/tuning";

type Props = { value: number; onChange: (v: number) => void; lockStrength: number; lockedLabel?: string | null };

export default function FrequencyTuner({ value, onChange, lockStrength, lockedLabel }: Props) {
  const band = bandOf(value);
  const step = (d: number) => onChange(Math.round(Math.min(100, Math.max(0, value + d)) * 10) / 10);
  return (
    <div className="space-y-2 select-none">
      <div className="flex items-baseline justify-between font-mono">
        <span className="text-[10px] tracking-widest uppercase" style={{ color: band.color }}>{band.label}</span>
        <span className="text-xl tabular-nums" style={{ color: band.color }}>{value.toFixed(1)}</span>
        <span className="text-[10px] tracking-widest uppercase text-muted-foreground">
          {lockedLabel ? `◉ ${lockedLabel}` : "scanning"} · {Math.round(lockStrength * 100)}%
        </span>
      </div>
      <div className="relative h-3 flex overflow-hidden border border-border">
        {BANDS.map((b) => (
          <div key={b.band} style={{ width: `${b.max - b.min}%`, background: b.color, opacity: b.band === band.band ? 0.7 : 0.2 }} />
        ))}
        <div className="absolute top-0 bottom-0 w-0.5 bg-white" style={{ left: `${value}%` }} />
        <div className="absolute top-0 bottom-0 w-px bg-white/40" style={{ left: `${SERENITY_SIGNATURE_FREQ}%` }} title="Signature" />
      </div>
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => step(-1)} className="min-w-[44px] min-h-[44px] border border-border font-mono">−</button>
        <input
          type="range"
          min={0}
          max={100}
          step={0.1}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="flex-1"
          aria-label="Tune frequency"
        />
        <button type="button" onClick={() => step(1)} className="min-w-[44px] min-h-[44px] border border-border font-mono">+</button>
      </div>
      <div className="h-1 bg-border">
        <div className="h-full transition-[width] duration-150" style={{ width: `${lockStrength * 100}%`, background: band.color }} />
      </div>
    </div>
  );
}
