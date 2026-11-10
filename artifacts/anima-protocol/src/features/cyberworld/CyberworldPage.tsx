/**
 * /cyberworld — explorable Battle Network-style cyberspace made of areas of
 * the net: the hub plaza (one "homepage" per Anima, linked by glowing data
 * paths) plus portal-linked areas such as the placeholder Landing Page.
 * Areas are data (./layout, ./areas), collision/routing is pure
 * (./collision), residents come from the companion store with a demo fallback.
 * HUD: minimap (./Minimap) and procedural ambience with a persisted mute.
 */
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { animaClient } from "@/api/animaClient";
import { companionLookHref, updateCompanionRecord } from "@/lib/listPersonalAnimas";
import { hasWebGL } from "@/lib/webglSupport";
import WebGLFallback from "@/components/battle/WebGLFallback";
import { areaById, buildWorld, travel } from "./areas";
import { homeZoneId, type Portal, type Vec2, type WorldAnima } from "./layout";
import Minimap from "./Minimap";
import { useCyberworldAnimas } from "./useCyberworldAnimas";
import { useCyberworldAudio } from "./useCyberworldAudio";
import type { MoveInput, PlayerTelemetry, SceneCommands } from "./CyberworldScene";

const CyberworldScene = lazy(() => import("./CyberworldScene"));

const DPAD: ReadonlyArray<readonly [string, string, MoveInput]> = [
  ["▲", "col-start-2", { x: 0, z: 1 }],
  ["◀", "col-start-1 row-start-2", { x: -1, z: 0 }],
  ["▶", "col-start-3 row-start-2", { x: 1, z: 0 }],
  ["▼", "col-start-2 row-start-3", { x: 0, z: -1 }],
];

function NoWebGL() {
  return (
    <div className="absolute inset-0 grid place-items-center p-6 text-center font-mono text-xs text-cyan-300/70">
      This device can’t open a WebGL context, so the cyberworld can’t render here.
    </div>
  );
}

export default function CyberworldPage() {
  const navigate = useNavigate();
  const { animas, source } = useCyberworldAnimas();
  const world = useMemo(() => buildWorld(animas), [animas]);
  // Current area + where we arrived (null = that area's own spawn).
  const [visit, setVisit] = useState<{ areaId: string; spawn: Vec2 | null }>({ areaId: world.start, spawn: null });
  const area = areaById(world, visit.areaId) ?? world.areas[0];
  const spawn = visit.spawn ?? area.spawn;
  const [nearId, setNearId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const touchMove = useRef<MoveInput>({ x: 0, z: 0 });
  const telemetry = useRef<PlayerTelemetry>({ x: spawn[0], z: spawn[1], heading: Math.PI, moving: false });
  const commands = useRef<SceneCommands>({ walkTo: null });
  const webgl = useMemo(() => hasWebGL(), []);
  const { muted, toggleMuted, sfx } = useCyberworldAudio();

  const near: WorldAnima | null = useMemo(() => animas.find((a) => a.id === nearId) ?? null, [animas, nearId]);
  const nearZone = near ? area.zones.find((z) => z.id === homeZoneId(near.id)) : null;

  useEffect(() => {
    if (nearId) sfx.near();
  }, [nearId, sfx]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  const onPortal = useCallback(
    (portal: Portal) => {
      const hop = travel(world, portal);
      if (!hop) return;
      sfx.portal();
      setNearId(null);
      setVisit({ areaId: hop.area.id, spawn: hop.spawn });
      setToast(`Jacked into ${hop.area.label}`);
    },
    [world, sfx],
  );

  const onPick = useCallback(
    (point: Vec2) => {
      sfx.blip();
      commands.current.walkTo = point;
    },
    [sfx],
  );
  const onStep = useCallback(() => sfx.step(), [sfx]);

  // Same flow as Animas → Talk: make this companion the active one, then open chat.
  const talk = useCallback(
    async (anima: WorldAnima) => {
      if (anima.mock || !anima.record || busy) return;
      setBusy(true);
      try {
        const me = await animaClient.auth.me().catch(() => null);
        if (me?.email && anima.record.assigned_user !== me.email) {
          await updateCompanionRecord(anima.record, { assigned_user: me.email });
        }
      } finally {
        setBusy(false);
      }
      navigate("/chat");
    },
    [busy, navigate],
  );

  const press = (v: MoveInput) => () => {
    touchMove.current = v;
  };
  const release = () => {
    touchMove.current = { x: 0, z: 0 };
  };

  return (
    <div className="relative flex-1 min-h-0 flex flex-col bg-black text-foreground">
      <div className="relative flex-1 min-h-[60vh]">
        {webgl ? (
          <WebGLFallback fallback={<NoWebGL />}>
            <Suspense fallback={<div className="absolute inset-0 grid place-items-center font-mono text-xs text-cyan-300/60">Jacking in…</div>}>
              <CyberworldScene
                area={area}
                spawn={spawn}
                animas={animas}
                touchMove={touchMove}
                telemetry={telemetry}
                commands={commands}
                onPortal={onPortal}
                onStep={onStep}
                nearAnimaId={nearId}
                onNearChange={setNearId}
              />
            </Suspense>
          </WebGLFallback>
        ) : (
          <NoWebGL />
        )}

        <div className="pointer-events-none absolute top-2 left-2 right-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest">
          <button type="button" onClick={() => navigate(-1)} className="pointer-events-auto border border-cyan-300/40 bg-black/60 px-2 py-1.5 text-cyan-200">
            ✕ Jack out
          </button>
          <span className="truncate" style={{ color: area.theme.accent }}>
            Cyberworld · {area.label}
          </span>
          <span className="ml-auto hidden text-muted-foreground sm:inline">
            {source === "store" ? `${animas.length} resident${animas.length === 1 ? "" : "s"}` : source === "loading" ? "syncing residents…" : "demo residents"}
          </span>
          <button
            type="button"
            onClick={toggleMuted}
            aria-pressed={!muted}
            aria-label={muted ? "Unmute ambience" : "Mute ambience"}
            className="pointer-events-auto ml-auto border border-cyan-300/40 bg-black/60 px-2 py-1.5 text-cyan-200 sm:ml-0"
          >
            {muted ? "♪ off" : "♪ on"}
          </button>
        </div>

        {/* Minimap: top-right under the bar, clear of the bottom-right d-pad. */}
        <Minimap
          area={area}
          animas={animas}
          telemetry={telemetry}
          nearAnimaId={nearId}
          onPick={onPick}
          className="absolute right-2 top-11 w-[112px] sm:w-[176px]"
        />

        {toast && (
          <p className="pointer-events-none absolute left-1/2 top-11 -translate-x-1/2 border border-cyan-300/40 bg-black/70 px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-cyan-200">
            {toast}
          </p>
        )}

        <p className="pointer-events-none absolute bottom-2 left-2 hidden font-mono text-[10px] uppercase tracking-widest text-cyan-300/60 sm:block">
          WASD / arrows to move · click floor or map to walk · drag to orbit · walk into a gate to travel
        </p>

        {near && nearZone && (
          <div
            role="dialog"
            aria-label={`${near.name} homepage`}
            className="absolute bottom-3 left-3 right-[172px] border bg-black/80 p-3 font-mono backdrop-blur-sm sm:bottom-auto sm:left-1/2 sm:right-auto sm:top-12 sm:w-[320px] sm:-translate-x-1/2"
            style={{ borderColor: nearZone.color, boxShadow: `0 0 18px ${nearZone.color}55` }}
          >
            <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Homepage</p>
            <p className="text-base tracking-widest" style={{ color: nearZone.color }}>
              {nearZone.label}
            </p>
            {near.mock ? (
              <div className="mt-2 space-y-2">
                <p className="text-[11px] text-muted-foreground">Demo resident. Sign in or wake a companion to move them in here.</p>
                <button type="button" onClick={() => { sfx.blip(); navigate("/animas"); }} className="min-h-[40px] w-full border border-border text-[11px] uppercase tracking-widest">
                  Meet your companions
                </button>
              </div>
            ) : (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    sfx.blip();
                    void talk(near);
                  }}
                  className="min-h-[40px] border text-[11px] uppercase tracking-widest disabled:opacity-50"
                  style={{ borderColor: nearZone.color, color: nearZone.color }}
                >
                  {busy ? "Linking…" : "Talk"}
                </button>
                <button type="button" onClick={() => navigate(companionLookHref(near.id))} className="min-h-[40px] border border-border text-[11px] uppercase tracking-widest">
                  Customise
                </button>
              </div>
            )}
          </div>
        )}

        {/* Touch fallback: hold-to-move d-pad (tap-to-walk also works). */}
        <div className="absolute bottom-3 right-3 grid grid-cols-3 grid-rows-3 gap-1 [@media(pointer:fine)]:hidden" aria-label="Move">
          {DPAD.map(([label, cls, v]) => (
            <button
              key={label}
              type="button"
              aria-label={`Move ${label}`}
              className={`${cls} h-12 w-12 border border-cyan-300/50 bg-black/60 font-mono text-cyan-200 active:bg-cyan-400/20`}
              onPointerDown={press(v)}
              onPointerUp={release}
              onPointerLeave={release}
              onPointerCancel={release}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
