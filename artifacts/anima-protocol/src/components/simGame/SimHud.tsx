/**
 * DOM HUD over the canvas: HP, memory meter, custom gauge + hand, W/band
 * readout, corrupted-memory list (glitched until purified), corruption /
 * purify flashes, rejection toasts, Custom screen and outcome.
 */
import { BAND_BY_KEY, CHIPS, glitchText, signalReadout, type SimState } from "@workspace/sim-core";
import type { Fx } from "@/lib/simClient/fx";
import type { RemoteStatus } from "@/lib/simClient/remote";

const GLITCH_CSS = `
@keyframes simGlitch { 0%{opacity:.85;transform:translate(0,0)} 20%{transform:translate(-6px,2px)} 40%{transform:translate(5px,-3px);opacity:.6} 60%{transform:translate(-3px,1px)} 100%{opacity:0;transform:translate(0,0)} }
@keyframes simPurify { 0%{opacity:.7} 100%{opacity:0} }
@keyframes simScan { 0%{background-position:0 0} 100%{background-position:0 8px} }
`;

function Bar({ value, max, color, label }: { value: number; max: number; color: string; label: string }) {
  const pct = Math.max(0, Math.min(1, value / Math.max(1, max))) * 100;
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between text-[10px] uppercase tracking-widest text-slate-300">
        <span>{label}</span>
        <span className="tabular-nums">{Math.round(value)}/{max}</span>
      </div>
      <div className="h-2 w-48 border border-white/20 bg-black/50">
        <div className="h-full transition-[width] duration-100" style={{ width: `${pct}%`, background: color, boxShadow: `0 0 8px ${color}` }} />
      </div>
    </div>
  );
}

type HudProps = {
  state: SimState;
  fx: Fx[];
  auto: boolean;
  picks: number[];
  memoryLabels: Record<string, string>;
  remote: { status: RemoteStatus; error: string | null } | null;
  hash: string;
  onTogglePick: (i: number) => void;
  onConfirmCustom: () => void;
  onRestart: () => void;
};

export default function SimHud({ state, fx, auto, picks, memoryLabels, remote, hash, onTogglePick, onConfirmCustom, onRestart }: HudProps) {
  const navi = state.units[0];
  const sig = signalReadout(state);
  const corrupt = fx.filter((f): f is Extract<Fx, { kind: "corrupt" }> => f.kind === "corrupt").at(-1);
  const purifying = fx.some((f) => f.kind === "purify" || f.kind === "restore");
  const reject = fx.filter((f) => f.kind === "reject").at(-1) as Extract<Fx, { kind: "reject" }> | undefined;
  const drained = fx.some((f) => f.kind === "drain");
  const memColor = state.memory > 40 ? "#a78bfa" : state.memory > 15 ? "#f59e0b" : "#ef4444";
  const shiftPct = navi.phase ? Math.min(1, (state.tick - navi.phase.startTick) / Math.max(1, navi.phase.landTick - navi.phase.startTick)) : null;

  return (
    <div className="pointer-events-none absolute inset-0 font-mono text-slate-100">
      <style>{GLITCH_CSS}</style>
      {/* left: vitals */}
      <div className="absolute left-3 top-3 space-y-2 bg-black/40 p-2 backdrop-blur-sm">
        <Bar value={navi.hp} max={navi.maxHp} color="#67e8f9" label="Navi HP" />
        <div className={drained ? "animate-pulse" : ""}>
          <Bar value={state.memory} max={100} color={memColor} label="Memory" />
        </div>
        <Bar value={state.custom.gauge * 100} max={100} color="#facc15" label={state.custom.gauge >= 1 ? "Custom ready [C]" : "Custom"} />
        <div className="flex gap-1 pt-1">
          {state.hand.length === 0 ? <span className="text-[10px] text-slate-400">no chips loaded</span> : null}
          {state.hand.map((c, i) => (
            <span
              key={i}
              className="border px-1 text-[10px]"
              style={{ borderColor: BAND_BY_KEY[CHIPS[c].band].color, color: BAND_BY_KEY[CHIPS[c].band].color, opacity: i === 0 ? 1 : 0.55 }}
              title={CHIPS[c].blurb}
            >
              {CHIPS[c].name}
            </span>
          ))}
        </div>
      </div>

      {/* right: signal + session */}
      <div className="absolute right-3 top-3 space-y-1 bg-black/40 p-2 text-right text-[11px] backdrop-blur-sm">
        <div className="text-2xl tabular-nums" style={{ color: sig.band.color, textShadow: `0 0 12px ${sig.band.color}88` }}>
          W {sig.w.toFixed(1)}
        </div>
        <div style={{ color: sig.band.color }} className="uppercase tracking-widest">
          {sig.band.key} · clarity {Math.round(sig.clarity * 100)}%
        </div>
        {shiftPct !== null ? <div className="text-violet-300">PHASE-SHIFT {Math.round(shiftPct * 100)}% · untargetable</div> : null}
        <div className="text-slate-400">
          {auto ? "AUTO" : "MANUAL"} [Tab] · t{state.tick} · #{hash}
        </div>
        <div className="text-slate-500">
          {remote ? `server: ${remote.status}${remote.error ? ` (${remote.error})` : ""}` : "offline practice · nothing recorded"}
        </div>
      </div>

      {/* corrupted memories */}
      {state.corruptions.length ? (
        <div className="absolute bottom-3 left-3 max-w-sm space-y-1 bg-black/50 p-2 text-[11px]">
          <div className="uppercase tracking-widest text-slate-400">Memory signal</div>
          {state.corruptions.map((c) => {
            const label = memoryLabels[c.targetEventId] ?? `memory ${c.targetEventId.slice(0, 8)}`;
            return (
              <div key={c.targetEventId} style={{ color: c.restored ? "#c4b5fd" : BAND_BY_KEY[c.band].color }}>
                {c.restored ? "✓ " : "▓ "}
                {c.restored ? label : glitchText(label, c.severity, c.targetEventId)}
                {!c.restored ? <span className="text-slate-500"> · {Math.round(c.severity * 100)}% · Purify at W≥~85</span> : null}
              </div>
            );
          })}
        </div>
      ) : null}

      {/* rejection toast */}
      {reject ? (
        <div className="absolute bottom-24 left-1/2 -translate-x-1/2 border border-red-500/50 bg-black/70 px-3 py-1 text-xs text-red-300">{reject.reason}</div>
      ) : null}

      {/* corruption flash */}
      {corrupt ? (
        <div
          key={corrupt.id}
          className="absolute inset-0 flex items-center justify-center"
          style={{
            animation: "simGlitch 0.9s steps(6) forwards",
            background: `repeating-linear-gradient(0deg, ${BAND_BY_KEY[corrupt.band].color}22 0 2px, transparent 2px 4px)`,
            mixBlendMode: "screen",
          }}
        >
          <div className="text-2xl tracking-[0.3em] text-red-400" style={{ textShadow: "2px 0 #22d3ee, -2px 0 #ef4444" }}>
            {glitchText("MEMORY CORRUPTED", 0.35, corrupt.id)} · {Math.round(corrupt.severity * 100)}%
          </div>
        </div>
      ) : null}
      {purifying ? (
        <div className="absolute inset-0" style={{ animation: "simPurify 1s ease-out forwards", background: "radial-gradient(circle at 30% 60%, #8B5CF655, transparent 60%)" }} />
      ) : null}

      {/* custom screen */}
      {state.custom.open ? (
        <div className="pointer-events-auto absolute inset-x-0 top-1/4 mx-auto w-[min(92vw,520px)] border border-yellow-400/40 bg-black/85 p-4">
          <div className="mb-2 text-xs uppercase tracking-widest text-yellow-300">Custom · pick up to 5 (1–5), Enter to load · time is frozen</div>
          <div className="grid grid-cols-5 gap-2">
            {state.custom.offer.map((c, i) => {
              const on = picks.includes(i);
              const col = BAND_BY_KEY[CHIPS[c].band].color;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => onTogglePick(i)}
                  className="min-h-[64px] border p-1 text-[10px]"
                  style={{ borderColor: col, background: on ? `${col}33` : "transparent", color: col }}
                  title={CHIPS[c].blurb}
                >
                  <div className="text-slate-400">{i + 1}</div>
                  {CHIPS[c].name}
                  <div className="text-slate-500">{CHIPS[c].cost}m</div>
                </button>
              );
            })}
          </div>
          <button type="button" onClick={onConfirmCustom} className="mt-3 w-full border border-yellow-400/60 py-2 text-xs uppercase tracking-widest text-yellow-200">
            Load {picks.length || "no"} chip{picks.length === 1 ? "" : "s"}
          </button>
        </div>
      ) : null}

      {state.outcome ? (
        <div className="pointer-events-auto absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/60">
          <div className="text-4xl tracking-[0.4em]" style={{ color: state.outcome === "win" ? "#8B5CF6" : "#ef4444" }}>
            {state.outcome === "win" ? "DELETED" : "SIGNAL LOST"}
          </div>
          <button type="button" onClick={onRestart} className="border border-white/40 px-4 py-2 text-xs uppercase tracking-widest">
            Restart
          </button>
        </div>
      ) : null}
    </div>
  );
}
