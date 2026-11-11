/** /resonance — scan view + frequency tuner. Lazy route (ExtraPage). */
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import FrequencyTuner from "@/components/resonance/FrequencyTuner";
import type { SceneNode } from "@/components/resonance/ResonanceScene";
import { fetchResonance, syncCompanionNodes, type ResonanceNode } from "@/lib/resonance/resonanceApi";
import { BANDS, isSpawned, metersBetween, signalStrength, LOCK_THRESHOLD } from "@/lib/resonance/tuning";
import { openResonanceNode } from "@/lib/resonance/openNode";
import { ToneEngine } from "@/lib/resonance/toneEngine";
import { useDeviceOrientation } from "@/hooks/useDeviceOrientation";
import { listPersonalAnimas } from "@/lib/listPersonalAnimas";
import { fetchVessel } from "@/lib/vessel/vesselApi";
import PresenceIndicator from "@/components/continuity/PresenceIndicator";

const ResonanceScene = lazy(() => import("@/components/resonance/ResonanceScene"));
type Companion = { id: string; name: string };
const TUNER_WIDTH = 2.5;

export default function Resonance() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [nodes, setNodes] = useState<ResonanceNode[]>([]);
  const [companions, setCompanions] = useState<Companion[]>([]);
  const [vessels, setVessels] = useState<Record<string, SceneNode["vessel"]>>({});
  // Deep links (voice tool open_resonance_node): ?tune=96.3 | ?band=omega | ?signal=Serenity
  const [tuned, setTuned] = useState(() => {
    const t = Number(params.get("tune"));
    if (Number.isFinite(t) && t >= 0 && t <= 100 && params.get("tune")) return t;
    const b = BANDS.find((x) => x.band === params.get("band"));
    return b ? (b.min + b.max) / 2 : 42;
  });
  const [selected, setSelected] = useState<{ node: SceneNode; strength: number } | null>(null);
  const [mode, setMode] = useState<"map" | "ar">("map");
  const [audioOn, setAudioOn] = useState(false);
  const [hd, setHd] = useState(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState("");
  const tone = useRef<ToneEngine | null>(null);
  const { orientation, status: orientStatus, enable, geo } = useDeviceOrientation();

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const rows = ((await listPersonalAnimas(200).catch(() => [])) as Companion[]).filter((c) => c?.id && c?.name);
        if (!live) return;
        setCompanions(rows);
        if (rows.length) await syncCompanionNodes(rows.map((c) => ({ id: c.id, name: c.name }))).catch(() => {});
        const r = await fetchResonance();
        if (!live) return;
        setNodes(r.nodes);
        const ids = [...new Set(r.nodes.map((n) => n.character_id).filter(Boolean) as string[])].slice(0, 12);
        const loaded = await Promise.all(ids.map((id) => fetchVessel(id).then((v) => [id, v?.config ?? null] as const).catch(() => [id, null] as const)));
        if (live) setVessels(Object.fromEntries(loaded));
      } catch (e) {
        if (live) setError((e as { code?: string }).code === "resonance_schema_missing" ? "Resonance layer is not migrated on this server yet." : String((e as Error).message));
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  // Continuity: the companion who rides the scanner with you (Serenity first).
  const presenceCompanion = companions.find((c) => /serenity/i.test(c.name)) || companions[0] || null;

  const sceneNodes: SceneNode[] = useMemo(() => {
    const byId = new Map(companions.map((c) => [c.id, c]));
    const serenity = companions.find((c) => /serenity/i.test(c.name));
    return nodes
      .filter((n) => isSpawned(n.id, n.spawn_rules))
      .filter((n) => {
        if (n.geo_lat == null || n.geo_lng == null) return true;
        if (!geo) return false;
        return metersBetween(geo, { lat: n.geo_lat, lng: n.geo_lng }) <= Number(n.spawn_rules?.radius_m ?? 500);
      })
      .map((n) => {
        const charId = n.character_id || (n.is_signature ? serenity?.id : undefined);
        return {
          ...n,
          displayName: (charId && byId.get(charId)?.name) || n.spawn_rules?.persona?.name || n.label,
          vessel: charId ? vessels[charId] : null,
        };
      });
  }, [nodes, companions, vessels, geo]);

  const wantedSignal = params.get("signal");
  const tunedToSignal = useRef(false);
  useEffect(() => {
    if (!wantedSignal || tunedToSignal.current || !sceneNodes.length) return;
    const hit = sceneNodes.find((n) => n.displayName.toLowerCase().includes(wantedSignal.toLowerCase()));
    if (hit) {
      tunedToSignal.current = true;
      setTuned(hit.frequency);
    }
  }, [wantedSignal, sceneNodes]);

  const strongest = useMemo(() => {
    let best: { node: SceneNode; strength: number } | null = null;
    for (const n of sceneNodes) {
      const s = signalStrength(n.frequency, tuned, TUNER_WIDTH);
      if (!best || s > best.strength) best = { node: n, strength: s };
    }
    return best;
  }, [sceneNodes, tuned]);

  useEffect(() => {
    if (!audioOn) return;
    const interference = sceneNodes
      .filter((n) => n.signal_type === "hostile" || n.signal_type === "noise")
      .reduce((m, n) => Math.max(m, signalStrength(n.frequency, tuned, TUNER_WIDTH * 2)), 0);
    tone.current?.update(tuned, strongest?.strength || 0, interference);
  }, [audioOn, tuned, strongest, sceneNodes]);

  useEffect(() => () => tone.current?.stop(), []);

  const toggleAudio = () => {
    if (audioOn) {
      tone.current?.stop();
      tone.current = null;
      setAudioOn(false);
    } else {
      tone.current = new ToneEngine();
      tone.current.start();
      setAudioOn(true);
    }
  };

  const toggleAr = async () => {
    if (mode === "ar") return setMode("map");
    const ok = await enable(true);
    if (ok) setMode("ar");
    else toast.message("Motion access unavailable — using touch pan.");
  };

  const onSelect = useCallback((node: SceneNode, strength: number) => setSelected({ node, strength }), []);
  const target = selected || (strongest && strongest.strength >= LOCK_THRESHOLD ? strongest : null);
  const targetStrength = target ? signalStrength(target.node.frequency, tuned, TUNER_WIDTH) : 0;

  const open = async () => {
    if (!target) return;
    setOpening(true);
    try {
      await openResonanceNode({
        node: target.node,
        companions,
        tuned,
        strength: targetStrength,
        mode: mode === "ar" ? "ar" : "map",
        geo,
        navigate,
      });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setOpening(false);
    }
  };

  return (
    <div className="relative flex-1 min-h-0 flex flex-col bg-slate-950">
      <div className="relative flex-1 min-h-[55vh]">
        <Suspense fallback={<div className="absolute inset-0 grid place-items-center font-mono text-xs text-cyan-300/60">Calibrating scanner…</div>}>
          <ResonanceScene
            nodes={sceneNodes}
            tuned={tuned}
            width={TUNER_WIDTH}
            mode={mode}
            orientation={orientation}
            selectedId={target?.node.id}
            onSelect={onSelect}
            hd={hd}
          />
        </Suspense>
        {presenceCompanion && (
          <div className="absolute bottom-2 right-2 pointer-events-none">
            <PresenceIndicator characterId={presenceCompanion.id} name={presenceCompanion.name} surface="resonance" />
          </div>
        )}
        <div className="absolute top-2 left-2 right-2 flex gap-1.5 flex-wrap font-mono text-[11px]">
          <button type="button" onClick={toggleAr} className={`border px-2 py-1.5 ${mode === "ar" ? "border-cyan-300 text-cyan-300" : "border-border text-muted-foreground"}`}>
            {mode === "ar" ? "AR · on" : orientStatus === "denied" ? "AR · denied" : "AR"}
          </button>
          <button type="button" onClick={toggleAudio} className={`border px-2 py-1.5 ${audioOn ? "border-cyan-300 text-cyan-300" : "border-border text-muted-foreground"}`} aria-pressed={audioOn}>
            Tones {audioOn ? "on" : "off"}
          </button>
          <button type="button" onClick={() => setHd((h) => !h)} className={`border px-2 py-1.5 ${hd ? "border-cyan-300 text-cyan-300" : "border-border text-muted-foreground"}`}>
            {hd ? "HD" : "Lite"}
          </button>
          <span className="ml-auto text-muted-foreground self-center">{sceneNodes.length} signals</span>
        </div>
        {error && <p className="absolute bottom-2 left-2 right-2 font-mono text-xs text-red-300">{error}</p>}
      </div>
      <div className="p-3 border-t border-border space-y-3 bg-black/60">
        <FrequencyTuner value={tuned} onChange={(v) => { setTuned(v); setSelected(null); }} lockStrength={targetStrength} lockedLabel={targetStrength >= LOCK_THRESHOLD ? target?.node.displayName : null} />
        {target && (
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0 font-mono text-xs">
              <p className="truncate text-foreground">{target.node.displayName}</p>
              <p className="text-muted-foreground">
                {target.node.signal_type} · {target.node.band} {target.node.frequency.toFixed(1)}
                {target.node.is_signature ? " · signature" : ""}
              </p>
            </div>
            {(target.node.signal_type === "hostile" || target.node.signal_type === "noise") && (
              <button
                type="button"
                disabled={targetStrength < LOCK_THRESHOLD}
                onClick={() => {
                  const navi = companions.find((c) => /serenity/i.test(c.name)) || companions[0];
                  const q = new URLSearchParams({
                    node: target.node.id,
                    w: String(tuned),
                    nodeW: String(target.node.frequency),
                    ...(navi ? { character: navi.id, name: navi.name } : {}),
                  });
                  navigate(`/resonance/arena?${q}`);
                }}
                className="min-h-[44px] px-4 border border-red-400 text-red-300 font-mono text-xs uppercase tracking-widest disabled:opacity-40"
              >
                Jack in
              </button>
            )}
            <button
              type="button"
              disabled={opening || targetStrength < LOCK_THRESHOLD || target.node.signal_type === "noise"}
              onClick={open}
              className="min-h-[44px] px-4 border border-cyan-300 text-cyan-300 font-mono text-xs uppercase tracking-widest disabled:opacity-40"
            >
              {opening ? "Opening…" : target.node.signal_type === "noise" ? "Static" : targetStrength < LOCK_THRESHOLD ? "Tune closer" : "Open channel"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
