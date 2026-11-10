/**
 * /cyberworld — explorable Battle Network-style cyberspace. A central hub
 * plaza with one "homepage" per Anima, linked by glowing data paths.
 * Layout is data (./layout), collision is pure (./collision), residents come
 * from the existing companion store with a demo fallback.
 */
import { Suspense, lazy, useCallback, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { animaClient } from "@/api/animaClient";
import { companionLookHref, updateCompanionRecord } from "@/lib/listPersonalAnimas";
import { hasWebGL } from "@/lib/webglSupport";
import WebGLFallback from "@/components/battle/WebGLFallback";
import { buildWorldLayout, homeZoneId, type WorldAnima } from "./layout";
import { useCyberworldAnimas } from "./useCyberworldAnimas";
import type { MoveInput } from "./CyberworldScene";

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
  const layout = useMemo(() => buildWorldLayout(animas), [animas]);
  const [nearId, setNearId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const touchMove = useRef<MoveInput>({ x: 0, z: 0 });
  const webgl = useMemo(() => hasWebGL(), []);

  const near: WorldAnima | null = useMemo(() => animas.find((a) => a.id === nearId) ?? null, [animas, nearId]);
  const nearZone = near ? layout.zones.find((z) => z.id === homeZoneId(near.id)) : null;

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
              <CyberworldScene layout={layout} animas={animas} touchMove={touchMove} nearAnimaId={nearId} onNearChange={setNearId} />
            </Suspense>
          </WebGLFallback>
        ) : (
          <NoWebGL />
        )}

        <div className="pointer-events-none absolute top-2 left-2 right-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest">
          <button type="button" onClick={() => navigate(-1)} className="pointer-events-auto border border-cyan-300/40 bg-black/60 px-2 py-1.5 text-cyan-200">
            ✕ Jack out
          </button>
          <span className="text-cyan-300">Cyberworld · Central Plaza</span>
          <span className="ml-auto text-muted-foreground">
            {source === "store" ? `${animas.length} resident${animas.length === 1 ? "" : "s"}` : source === "loading" ? "syncing residents…" : "demo residents"}
          </span>
        </div>

        <p className="pointer-events-none absolute bottom-2 left-2 hidden font-mono text-[10px] uppercase tracking-widest text-cyan-300/60 sm:block">
          WASD / arrows to move · click floor to walk · drag to orbit · scroll to zoom
        </p>

        {near && nearZone && (
          <div
            role="dialog"
            aria-label={`${near.name} homepage`}
            className="absolute left-1/2 top-12 w-[min(92vw,320px)] -translate-x-1/2 border bg-black/80 p-3 font-mono backdrop-blur-sm"
            style={{ borderColor: nearZone.color, boxShadow: `0 0 18px ${nearZone.color}55` }}
          >
            <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Homepage</p>
            <p className="text-base tracking-widest" style={{ color: nearZone.color }}>
              {nearZone.label}
            </p>
            {near.mock ? (
              <div className="mt-2 space-y-2">
                <p className="text-[11px] text-muted-foreground">Demo resident. Sign in or wake a companion to move them in here.</p>
                <button type="button" onClick={() => navigate("/animas")} className="min-h-[40px] w-full border border-border text-[11px] uppercase tracking-widest">
                  Meet your companions
                </button>
              </div>
            ) : (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => talk(near)}
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
