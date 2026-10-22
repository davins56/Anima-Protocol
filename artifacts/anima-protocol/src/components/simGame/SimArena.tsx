/**
 * Immersive-sim battle: wires the fixed-step loop, input layer, frequency dial
 * (+ device tilt), R3F scene and HUD together. Runs fully offline on a local
 * seeded session; when `online` is set and /api/sim answers, it plays the
 * server-issued config and flushes the stamped input log for replay.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SimConfig } from "@workspace/sim-core";
import FrequencyTuner from "@/components/resonance/FrequencyTuner";
import { useDeviceOrientation } from "@/hooks/useDeviceOrientation";
import { FixedStepLoop } from "@/lib/simClient/fixedStepLoop";
import { autopilot } from "@/lib/simClient/autopilot";
import { actionsForPanelTap } from "@/lib/simClient/gridNav";
import { layerPhaseTarget, shouldCommitDial, tiltToW } from "@/lib/simClient/frequency";
import { ActionFlusher, type RemoteStatus } from "@/lib/simClient/remote";
import { layerAt, signalReadout } from "@workspace/sim-core";
import SimScene3D from "./SimScene3D";
import SimHud from "./SimHud";
import { SimFxStore, useFx, useLoopState } from "./simStore";
import { useSimInput } from "./useSimInput";
import WebGLFallback from "@/components/battle/WebGLFallback";

function NoWebGL() {
  return (
    <div className="flex h-full items-center justify-center p-6 text-center font-mono text-xs text-slate-400">
      3D arena unavailable on this device (WebGL). The battle still runs — use the keyboard and the HUD.
    </div>
  );
}

const DEFAULT_MODEL = { color: "#a78bfa", accent: "#e2e8f0", gold: "#fde68a", name: "Serenity" };

export type SimArenaProps = {
  config: SimConfig;
  sessionId?: string | null;
  memoryLabels?: Record<string, string>;
  model?: Record<string, unknown>;
  onRestart: () => void;
};

function hasWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

export default function SimArena({ config, sessionId = null, memoryLabels = {}, model = DEFAULT_MODEL, onRestart }: SimArenaProps) {
  const loop = useMemo(() => new FixedStepLoop(config), [config]);
  const fxStore = useMemo(() => new SimFxStore(loop), [loop]);
  useEffect(() => () => fxStore.dispose(), [fxStore]);
  const state = useLoopState(loop);
  const fx = useFx(fxStore);
  const [auto, setAuto] = useState(false);
  const [picks, setPicks] = useState<number[]>([]);
  const [userPaused, setUserPaused] = useState(false);
  const autoRef = useRef(auto);
  useEffect(() => {
    autoRef.current = auto;
  }, [auto]);
  const glitchUntil = useRef(0);
  const webgl = useMemo(() => hasWebGL(), []);

  // ── Frequency dial (continuous W aim) → phase target on settle ──
  const navi = state.units[0];
  const [dialW, setDialW] = useState(config.startW);
  const dial = useRef({ w: config.startW, movedAt: 0, dirty: false });
  const onDial = useCallback((w: number) => {
    setDialW(w);
    dial.current = { w, movedAt: performance.now(), dirty: true };
  }, []);
  // Dial follows the navi when the player isn't steering it.
  useEffect(() => {
    if (!dial.current.dirty && performance.now() - dial.current.movedAt > 1200) {
      const w = navi.phase ? navi.phase.toW : navi.w;
      if (Math.abs(w - dial.current.w) >= 0.1) {
        dial.current.w = w;
        setDialW(Math.round(w * 10) / 10);
      }
    }
  }, [navi.w, navi.phase]);

  // ── Device tilt as continuous frequency input ──
  const orient = useDeviceOrientation();
  const tiltBase = useRef<number | null>(null);
  useEffect(() => {
    if (orient.status !== "granted") {
      tiltBase.current = null;
      return;
    }
    tiltBase.current = loop.curr.units[0].w;
    const id = window.setInterval(() => {
      const w = tiltToW(orient.orientation.current.gamma, tiltBase.current ?? 50);
      if (Math.abs(w - dial.current.w) >= 0.5) onDial(w);
    }, 100);
    return () => window.clearInterval(id);
  }, [orient.status, orient.orientation, loop, onDial]);

  // ── Tick-boundary hooks: dial commit + autopilot (both just enqueue actions) ──
  useEffect(() => {
    return loop.beforeTick((s, l) => {
      const n = s.units[0];
      if (dial.current.dirty) {
        const toW = shouldCommitDial({ dialW: dial.current.w, currentW: n.w, lastMoveAt: dial.current.movedAt, now: performance.now(), busy: !!n.phase || s.custom.open });
        if (toW !== null) l.enqueue({ t: "phase", toW });
        if (toW !== null || performance.now() - dial.current.movedAt > 350) dial.current.dirty = n.phase ? dial.current.dirty : false;
      }
      if (autoRef.current && s.tick % 3 === 0 && l.input.size === 0) for (const a of autopilot(s)) l.enqueue(a);
    });
  }, [loop]);

  // ── Corruption → post-FX glitch spike ──
  const lastCorrupt = useRef<string | null>(null);
  useEffect(() => {
    const c = fx.filter((f) => f.kind === "corrupt").at(-1);
    if (c && c.id !== lastCorrupt.current) {
      lastCorrupt.current = c.id;
      glitchUntil.current = performance.now() + 600;
    }
  }, [fx]);

  // ── Optional server sync ──
  const [remote, setRemote] = useState<{ status: RemoteStatus; error: string | null } | null>(sessionId ? { status: "pending", error: null } : null);
  useEffect(() => {
    if (!sessionId) return;
    const flusher = new ActionFlusher(sessionId);
    const flush = async () => {
      if (!loop.input.log.length) return;
      await flusher.flush(loop.input.log.slice(), { tick: loop.curr.tick, hash: loop.hash() });
      setRemote({ status: flusher.status, error: flusher.lastError });
    };
    const id = window.setInterval(flush, 2000);
    const unsub = loop.subscribe(({ state: s }) => {
      if (s.outcome) void flush();
    });
    return () => {
      window.clearInterval(id);
      unsub();
      void flush();
    };
  }, [loop, sessionId]);

  // ── Input ──
  const togglePick = useCallback((i: number) => setPicks((p) => (p.includes(i) ? p.filter((x) => x !== i) : p.length >= 5 ? p : [...p, i])), []);
  const confirmCustom = useCallback(() => {
    setPicks((p) => {
      loop.enqueue({ t: "custom_pick", picks: p });
      return [];
    });
  }, [loop]);
  useSimInput(loop, { toggleAuto: () => setAuto((a) => !a), togglePick, confirmCustom }, { userPaused });

  const onPanelTap = useCallback(
    (layer: number, col: number, row: number) => {
      const s = loop.curr;
      const n = s.units[0];
      if (layer !== layerAt(n.w)) {
        const toW = layerPhaseTarget(layer, n.w);
        if (toW !== null) loop.enqueue({ t: "phase", toW });
        return;
      }
      for (const a of actionsForPanelTap(s, layer, col, row)) loop.enqueue(a);
    },
    [loop],
  );
  const onNodeTap = useCallback(
    (layer: number) => {
      const toW = layerPhaseTarget(layer, loop.curr.units[0].w);
      if (toW !== null) loop.enqueue({ t: "phase", toW });
    },
    [loop],
  );

  return (
    <div className="flex h-full w-full flex-col bg-[#02010a]">
      <div className="relative min-h-0 flex-1">
        {webgl ? (
          <WebGLFallback fallback={<NoWebGL />}>
            <SimScene3D loop={loop} fxStore={fxStore} model={model} glitchUntil={glitchUntil} onPanelTap={onPanelTap} onNodeTap={onNodeTap} />
          </WebGLFallback>
        ) : (
          <NoWebGL />
        )}
        <SimHud
          state={state}
          fx={fx}
          auto={auto}
          picks={picks}
          memoryLabels={memoryLabels}
          remote={remote}
          hash={loop.hash()}
          onTogglePick={togglePick}
          onConfirmCustom={confirmCustom}
          onRestart={onRestart}
        />
      </div>
      <div className="grid gap-3 border-t border-white/10 bg-black/70 p-3 md:grid-cols-[1fr_auto]">
        <FrequencyTuner value={dialW} onChange={onDial} lockStrength={signalReadout(state).clarity} lockedLabel={navi.phase ? "shifting" : null} />
        <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-slate-300">
          <button type="button" className="min-h-[44px] border border-white/20 px-3" onClick={() => setAuto((a) => !a)}>
            {auto ? "Auto ◉" : "Manual ○"}
          </button>
          <button type="button" className="min-h-[44px] border border-white/20 px-3" onClick={() => setUserPaused((p) => !p)}>
            {userPaused ? "Resume" : "Pause"}
          </button>
          <button
            type="button"
            className="min-h-[44px] border border-white/20 px-3"
            onClick={() => (orient.status === "granted" ? orient.disable() : void orient.enable(false))}
          >
            Tilt {orient.status === "granted" ? "on" : orient.status === "off" ? "off" : orient.status}
          </button>
          <button type="button" className="min-h-[44px] border border-white/20 px-3" onClick={onRestart}>
            Restart
          </button>
          <span className="hidden text-slate-500 lg:inline">
            ←↑→↓/WASD move · Z/Space buster · X chip · C custom · P purify · Q/E or [ ] phase · Tab auto
          </span>
        </div>
      </div>
    </div>
  );
}
