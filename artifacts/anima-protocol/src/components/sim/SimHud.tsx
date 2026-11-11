/**
 * Readability + tension HUD: W-axis mini-gauge (spectrum, every unit's W,
 * phase ghost), signal clarity/comms, HP/memory, Custom gauge, loaded chips.
 * W control reuses the Resonance FrequencyTuner (continuous, no detents) so
 * tuning in the scan map and phasing in battle are the same gesture.
 */
import { useMemo } from "react";
import FrequencyTuner from "@/components/resonance/FrequencyTuner";
import { RESONANCE_GRADIENT_CSS } from "@/styles/anima-tokens";
import {
  BAND_BY_KEY,
  CHIPS,
  MAX_PHASE_DW,
  bandAt,
  glitchText,
  phaseCost,
  signalReadout,
  type SimState,
} from "@/lib/sim/engine";

export function WGauge({ state, previewW }: { state: SimState; previewW: number | null }) {
  return (
    <div className="relative h-4 border border-white/20" style={{ background: RESONANCE_GRADIENT_CSS }} aria-label="W axis">
      {state.units.filter((u) => u.hp > 0).map((u) => (
        <div
          key={u.id}
          className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 ${u.side === "player" ? "w-2 h-5 bg-white" : "w-2 h-2 rotate-45"}`}
          style={{ left: `${u.phase ? u.phase.toW : u.w}%`, background: u.side === "player" ? undefined : BAND_BY_KEY[u.band].color, boxShadow: "0 0 6px #000" }}
          title={u.side === "player" ? "Navi" : u.kind}
        />
      ))}
      {previewW !== null && (
        <div className="absolute top-0 bottom-0 w-0.5 bg-white/60 border-dashed" style={{ left: `${previewW}%` }} title="Phase target" />
      )}
    </div>
  );
}

const COMMS: Record<string, string> = {
  noise: "I can barely— the static is eating my voice—",
  ambient: "I'm here, but the signal keeps drifting.",
  data: "Reading you. Lattice is stable.",
  rare: "Clear and bright. I can see their patterns.",
  serenity: "I'm with you. Every word, every frequency.",
};

export default function SimHud(props: {
  state: SimState;
  previewW: number | null;
  setPreviewW: (w: number | null) => void;
  onPhase: () => void;
  companionName: string;
}) {
  const { state, previewW, setPreviewW, onPhase, companionName } = props;
  const navi = state.units[0];
  const sig = signalReadout(state);
  const target = previewW ?? navi.w;
  const dw = target - navi.w;
  const cost = phaseCost(dw);
  const portal = state.portals.some((p) => [p.a, p.b].some((c) => c.col === navi.col && c.row === navi.row));
  const comms = useMemo(() => glitchText(COMMS[sig.band.key], 1 - sig.clarity, String(Math.floor(state.tick / 10))), [sig.band.key, sig.clarity, state.tick]);
  const canPhase = !navi.phase && Math.abs(dw) >= 0.5 && (portal || (Math.abs(dw) <= MAX_PHASE_DW && state.memory >= cost));

  return (
    <div className="space-y-2 font-mono text-[11px]">
      <div className="grid grid-cols-3 gap-2">
        <div>
          <p className="text-muted-foreground uppercase tracking-widest">HP</p>
          <div className="h-2 bg-white/10"><div className="h-full bg-emerald-400" style={{ width: `${(navi.hp / navi.maxHp) * 100}%` }} /></div>
        </div>
        <div>
          <p className="text-muted-foreground uppercase tracking-widest">Memory</p>
          <div className="h-2 bg-white/10"><div className="h-full bg-violet-400" style={{ width: `${state.memory}%` }} /></div>
        </div>
        <div>
          <p className="text-muted-foreground uppercase tracking-widest">Custom</p>
          <div className="h-2 bg-white/10"><div className={`h-full ${state.custom.gauge >= 1 ? "bg-amber-300 animate-pulse" : "bg-cyan-400"}`} style={{ width: `${state.custom.gauge * 100}%` }} /></div>
        </div>
      </div>
      <WGauge state={state} previewW={previewW} />
      <div className="flex items-center gap-2">
        <span style={{ color: sig.band.color }}>{companionName}:</span>
        <span className="truncate" style={{ opacity: 0.45 + 0.55 * sig.clarity }}>{comms}</span>
        <span className="ml-auto tabular-nums" style={{ color: sig.band.color }}>clarity {Math.round(sig.clarity * 100)}% · ×{sig.chipPower.toFixed(2)}</span>
      </div>
      <FrequencyTuner value={target} onChange={(v) => setPreviewW(v)} lockStrength={Math.max(0, 1 - Math.abs(dw) / MAX_PHASE_DW)} lockedLabel={bandAt(target).key} />
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={!canPhase}
          onClick={onPhase}
          className="min-h-[44px] flex-1 border font-mono uppercase tracking-widest disabled:opacity-40"
          style={{ borderColor: bandAt(target).color, color: bandAt(target).color }}
        >
          {navi.phase ? "Phasing…" : portal ? "Phase via gate · free" : `Phase → ${target.toFixed(1)} · ${cost} mem`}
        </button>
        <div className="flex gap-1" aria-label="Loaded chips">
          {state.hand.map((c, i) => (
            <span key={i} className="px-1.5 py-1 border text-[10px]" style={{ borderColor: BAND_BY_KEY[CHIPS[c].band].color, opacity: i === 0 ? 1 : 0.55 }}>
              {CHIPS[c].name}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
