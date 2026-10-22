/** Custom screen (BN): time is frozen while open; pick up to 5 chips in order. */
import { useState } from "react";
import { BAND_BY_KEY, CHIPS, bandAt, type SimState } from "@/lib/sim/engine";

export default function ChipSelect({ state, onConfirm }: { state: SimState; onConfirm: (picks: number[]) => void }) {
  const [picks, setPicks] = useState<number[]>([]);
  const band = bandAt(state.units[0].w).key;
  const toggle = (i: number) => setPicks((p) => (p.includes(i) ? p.filter((x) => x !== i) : p.length >= 5 ? p : [...p, i]));
  return (
    <div className="absolute inset-0 z-30 grid place-items-center bg-black/70 backdrop-blur-sm" role="dialog" aria-label="Custom">
      <div className="w-[min(560px,92vw)] border border-cyan-300/50 bg-slate-950/95 p-4 space-y-3 font-mono">
        <p className="text-xs uppercase tracking-[0.3em] text-cyan-300">Custom · send weapons data</p>
        <div className="grid grid-cols-5 gap-2">
          {state.custom.offer.map((c, i) => {
            const spec = CHIPS[c];
            const on = picks.indexOf(i);
            const off = spec.band !== band;
            return (
              <button
                key={i}
                type="button"
                onClick={() => toggle(i)}
                className={`min-h-[88px] border p-1.5 text-left text-[10px] ${on >= 0 ? "bg-white/10" : ""}`}
                style={{ borderColor: BAND_BY_KEY[spec.band].color }}
                title={spec.blurb}
              >
                <span className="block text-[11px]" style={{ color: BAND_BY_KEY[spec.band].color }}>{spec.name}</span>
                <span className="block text-muted-foreground">{spec.cost * (off ? 2 : 1)} mem{off ? " (off-band)" : ""}</span>
                {on >= 0 && <span className="block text-white">#{on + 1}</span>}
              </button>
            );
          })}
        </div>
        <button type="button" onClick={() => onConfirm(picks)} className="w-full min-h-[44px] border border-cyan-300 text-cyan-300 uppercase tracking-widest">
          OK
        </button>
      </div>
    </div>
  );
}
