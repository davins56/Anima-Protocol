/**
 * /resonance/arena — 4D net battle launched from a hostile resonance node.
 * ?node=<resonance_nodes.id>&w=<tuned W>&character=<companion id>&name=<display>
 */
import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import SimHud from "@/components/sim/SimHud";
import ChipSelect from "@/components/sim/ChipSelect";
import SovereignPresenceStage from "@/components/anima/SovereignPresenceStage";
import { useCharacterVessel } from "@/hooks/useCharacterVessel";
import { useSimBattle } from "@/lib/sim/useSimBattle";
import { createSimSession, localSimConfig } from "@/lib/sim/simApi";
import { vesselToBattleModel } from "@/lib/sim/vesselModel";
import { signalReadout, type SimConfig } from "@/lib/sim/engine";
import { RESONANCE_STOPS } from "@/styles/anima-tokens";
import { simToEmotion } from "@/lib/vessel/emotionState";
import { traitsFor } from "@/lib/vessel/vesselTraits";
import { useVesselEmotion } from "@/hooks/useVesselEmotion";

const SimArena3D = lazy(() => import("@/components/sim/SimArena3D"));

export default function SimArena() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const nodeId = params.get("node");
  const startW = Math.min(100, Math.max(0, Number(params.get("w") ?? 94) || 94));
  const characterId = params.get("character") || "serenity";
  const name = params.get("name") || "Serenity";
  const [config, setConfig] = useState<SimConfig | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [previewW, setPreviewW] = useState<number | null>(null);
  const [presence, setPresence] = useState(false);
  const { vessel } = useCharacterVessel(characterId);
  const model = useMemo(() => vesselToBattleModel(vessel?.config, name), [vessel, name]);

  useEffect(() => {
    let live = true;
    createSimSession({ character_id: characterId, node_id: nodeId, start_w: startW })
      .then(({ session }) => {
        if (!live) return;
        setSessionId(session.id);
        setConfig(session.config);
      })
      .catch(() => live && setConfig(localSimConfig({ characterId, startW, nodeBandW: Number(params.get("nodeW") ?? 10) })));
    return () => {
      live = false;
    };
  }, [characterId, nodeId, startW, params]);

  const { state, fx, dispatch, sync, lastReject } = useSimBattle(config, sessionId);
  // Emotional vessel-shift: battle state (HP, threat, W clarity, corruption, outcome) → the companion's traits row.
  const traits = useMemo(() => traitsFor({ id: characterId, name }), [characterId, name]);
  const emotionTarget = state ? simToEmotion(state) : null;
  const { shift } = useVesselEmotion(traits, emotionTarget);

  const phase = useCallback(() => {
    if (previewW === null) return;
    dispatch({ t: "phase", toW: previewW });
    setPreviewW(null);
  }, [dispatch, previewW]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!state || state.custom.open) return;
      const k = e.key;
      if (k === "ArrowUp") dispatch({ t: "move", dc: 0, dr: -1 });
      else if (k === "ArrowDown") dispatch({ t: "move", dc: 0, dr: 1 });
      else if (k === "ArrowLeft") dispatch({ t: "move", dc: -1, dr: 0 });
      else if (k === "ArrowRight") dispatch({ t: "move", dc: 1, dr: 0 });
      else if (k === " ") dispatch({ t: "buster" });
      else if (k === "f" || k === "F") dispatch({ t: "chip" });
      else if (k === "c" || k === "C") dispatch({ t: "custom_open" });
      else if (k === "p" || k === "P") dispatch({ t: "purify" });
      else if (k === "Enter") phase();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state, dispatch, phase]);

  if (!state) {
    return <div className="flex-1 grid place-items-center bg-black font-mono text-xs text-cyan-300/70">Jacking in…</div>;
  }
  const sig = signalReadout(state);
  const open = state.corruptions.filter((c) => !c.restored).length;

  return (
    <div className="relative flex-1 min-h-0 flex flex-col bg-black text-foreground">
      <div className="relative flex-1 min-h-[52vh]">
        <Suspense fallback={<div className="absolute inset-0 grid place-items-center font-mono text-xs text-cyan-300/60">Compiling arena…</div>}>
          <SimArena3D state={state} fx={fx} model={model} previewW={previewW} shift={shift} />
        </Suspense>
        {/* visual noise = 1 − clarity */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 mix-blend-screen"
          style={{
            opacity: sig.noise * 0.35,
            background: `repeating-linear-gradient(0deg, ${RESONANCE_STOPS[0][1]}33 0 1px, transparent 1px 3px)`,
            animation: "pulse 0.2s steps(2) infinite",
          }}
        />
        <div className="absolute top-2 left-2 right-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest">
          <button type="button" onClick={() => navigate("/resonance")} className="border border-border px-2 py-1.5">✕ Jack out</button>
          <span style={{ color: sig.band.color }}>{sig.band.key} · W {sig.w.toFixed(1)}</span>
          {open > 0 && <span className="text-red-300">◈ {open} memor{open === 1 ? "y" : "ies"} corrupted — Purify on violet</span>}
          <span className="ml-auto text-muted-foreground">{sync === "verified" ? "✓ server-verified" : sync === "rejected" ? "⚠ unverified" : sync === "local" ? "local practice" : "syncing"}</span>
        </div>
        {lastReject && <p className="absolute bottom-2 left-2 font-mono text-[10px] text-amber-300/80">{lastReject}</p>}
        {state.custom.open && <ChipSelect state={state} onConfirm={(picks) => dispatch({ t: "custom_pick", picks })} />}
        {state.outcome && (
          <div className="absolute inset-0 z-30 grid place-items-center bg-black/70">
            <div className="text-center space-y-3 font-mono">
              <p className="text-2xl tracking-[0.3em]" style={{ color: state.outcome === "win" ? "#8B5CF6" : "#B91C1C" }}>
                {state.outcome === "win" ? "DELETED" : "LOGGED OUT"}
              </p>
              <p className="text-xs text-muted-foreground">
                {state.corruptions.length} corruption{state.corruptions.length === 1 ? "" : "s"} · {state.corruptions.filter((c) => c.restored).length} purified
                {sessionId ? " · logged to memory" : ""}
              </p>
              <div className="flex gap-2 justify-center">
                <button type="button" onClick={() => setPresence(true)} className="min-h-[44px] px-4 border border-violet-400 text-violet-300 text-xs uppercase tracking-widest">Sovereign Presence</button>
                <button type="button" onClick={() => navigate("/resonance")} className="min-h-[44px] px-4 border border-border text-xs uppercase tracking-widest">Back to scan</button>
              </div>
            </div>
          </div>
        )}
      </div>
      <div className="p-3 border-t border-border bg-black/70 space-y-2">
        <SimHud state={state} previewW={previewW} setPreviewW={setPreviewW} onPhase={phase} companionName={name} />
        <div className="grid grid-cols-6 gap-2 font-mono text-[11px] uppercase">
          {([["▲", { t: "move", dc: 0, dr: -1 }], ["▼", { t: "move", dc: 0, dr: 1 }], ["◀", { t: "move", dc: -1, dr: 0 }], ["▶", { t: "move", dc: 1, dr: 0 }]] as const).map(([l, a]) => (
            <button key={l} type="button" onClick={() => dispatch(a)} className="min-h-[48px] border border-border">{l}</button>
          ))}
          <button type="button" onClick={() => dispatch({ t: "buster" })} className="min-h-[48px] border border-cyan-300/60">Buster</button>
          <button
            type="button"
            onClick={() => dispatch(state.custom.gauge >= 1 && !state.hand.length ? { t: "custom_open" } : { t: "chip" })}
            className="min-h-[48px] border border-amber-300/70 text-amber-200"
          >
            {state.custom.gauge >= 1 && !state.hand.length ? "Custom" : "Chip"}
          </button>
        </div>
        {state.custom.gauge >= 1 && state.hand.length > 0 && (
          <button type="button" onClick={() => dispatch({ t: "custom_open" })} className="w-full min-h-[40px] border border-amber-300 text-amber-200 font-mono text-[11px] uppercase tracking-widest animate-pulse">
            Custom ready
          </button>
        )}
      </div>
      <SovereignPresenceStage open={presence} onClose={() => setPresence(false)} model={model} title={name} expression={sig.clarity} shift={shift} />
    </div>
  );
}
