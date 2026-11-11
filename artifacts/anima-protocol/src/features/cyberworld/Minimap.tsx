/**
 * Corner HUD minimap: top-down SVG of the current area (zones, paths,
 * portals, Anima markers) with a live player arrow. Position/heading are read
 * from the scene's telemetry ref in a rAF loop, so the map never re-renders
 * React per frame. Clicking a marker asks the scene to auto-walk there.
 */
import { useEffect, useMemo, useRef } from "react";
import type { MutableRefObject } from "react";
import { animaStandPoint, approachPoint } from "./collision";
import { areaBounds, pathEndpoints, zoneHalfExtents, zoneShape, type Area, type Vec2, type WorldAnima } from "./layout";
import type { PlayerTelemetry, SceneNode } from "./CyberworldScene";

type Props = {
  area: Area;
  animas: readonly WorldAnima[];
  telemetry: MutableRefObject<PlayerTelemetry>;
  nearAnimaId: string | null;
  /** Exploration nodes; revealed ones show as small rarity dots. */
  nodes?: readonly SceneNode[];
  onPick: (point: Vec2, label: string) => void;
  className?: string;
};

function hexPoints(cx: number, cz: number, r: number): string {
  const R = r / Math.cos(Math.PI / 6);
  return Array.from({ length: 6 }, (_, i) => {
    const a = (i / 6) * Math.PI * 2;
    return `${(cx + Math.cos(a) * R).toFixed(2)},${(cz + Math.sin(a) * R).toFixed(2)}`;
  }).join(" ");
}

export default function Minimap({ area, animas, telemetry, nearAnimaId, nodes = [], onPick, className = "" }: Props) {
  const player = useRef<SVGGElement>(null);
  const b = useMemo(() => {
    const raw = areaBounds(area, 2.5);
    // Square viewBox so the map never stretches.
    const w = raw.maxX - raw.minX;
    const h = raw.maxZ - raw.minZ;
    const s = Math.max(w, h);
    const cx = (raw.minX + raw.maxX) / 2;
    const cz = (raw.minZ + raw.maxZ) / 2;
    return { x: cx - s / 2, z: cz - s / 2, s };
  }, [area]);
  const unit = b.s / 100; // marker sizes scale with the area

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const t = telemetry.current;
      const g = player.current;
      // heading: atan2(dx, dz) in world → SVG rotate(−h) points the +z arrow along travel.
      if (g) g.setAttribute("transform", `translate(${t.x.toFixed(2)} ${t.z.toFixed(2)}) rotate(${((-t.heading * 180) / Math.PI).toFixed(1)})`);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [telemetry]);

  const residents = area.zones
    .filter((z) => z.kind === "home" && z.animaId)
    .map((z) => ({ zone: z, anima: animas.find((a) => a.id === z.animaId) }))
    .filter((r): r is { zone: (typeof r)["zone"]; anima: WorldAnima } => !!r.anima);

  return (
    <div
      className={`pointer-events-auto border border-cyan-300/40 bg-black/70 backdrop-blur-sm ${className}`}
      style={{ boxShadow: `0 0 14px ${area.theme.accent}33` }}
    >
      <div className="flex items-center justify-between px-1.5 pt-1 font-mono text-[9px] uppercase tracking-widest" style={{ color: area.theme.accent }}>
        <span className="truncate">{area.label}</span>
        <span className="text-muted-foreground">map</span>
      </div>
      <svg viewBox={`${b.x} ${b.z} ${b.s} ${b.s}`} className="block aspect-square w-full" role="img" aria-label={`Minimap of ${area.label}`}>
        {area.paths.map((p) => {
          const ends = pathEndpoints(area, p);
          if (!ends) return null;
          return (
            <line
              key={p.id}
              x1={ends[0][0]}
              y1={ends[0][1]}
              x2={ends[1][0]}
              y2={ends[1][1]}
              stroke={p.color || area.theme.accent}
              strokeOpacity={0.7}
              strokeWidth={p.width}
              strokeLinecap="round"
            />
          );
        })}
        {area.zones.map((z) =>
          zoneShape(z) === "rect" ? (
            <rect
              key={z.id}
              x={z.center[0] - zoneHalfExtents(z)[0]}
              y={z.center[1] - zoneHalfExtents(z)[1]}
              width={zoneHalfExtents(z)[0] * 2}
              height={zoneHalfExtents(z)[1] * 2}
              fill="#04121a"
              stroke={z.color}
              strokeWidth={unit * 1.2}
            />
          ) : (
            <polygon key={z.id} points={hexPoints(z.center[0], z.center[1], z.radius)} fill="#04121a" stroke={z.color} strokeWidth={unit * 1.2} />
          ),
        )}
        {area.portals.map((g) => (
          <g
            key={g.id}
            className="cursor-pointer"
            onClick={() => onPick(g.position, g.label)}
            role="button"
            aria-label={`Walk to ${g.label} gate`}
          >
            <rect
              x={g.position[0] - unit * 2.6}
              y={g.position[1] - unit * 2.6}
              width={unit * 5.2}
              height={unit * 5.2}
              transform={`rotate(45 ${g.position[0]} ${g.position[1]})`}
              fill={g.color}
              fillOpacity={0.35}
              stroke={g.color}
              strokeWidth={unit * 0.8}
            />
            <circle cx={g.position[0]} cy={g.position[1]} r={unit * 7} fill="transparent" />
          </g>
        ))}
        {residents.map(({ zone, anima }) => {
          const [x, z] = animaStandPoint(zone);
          const near = anima.id === nearAnimaId;
          return (
            <g key={anima.id} className="cursor-pointer" onClick={() => onPick(approachPoint(zone), anima.name)} role="button" aria-label={`Walk to ${anima.name}`}>
              <circle cx={x} cy={z} r={unit * (near ? 3.6 : 2.8)} fill={zone.color} stroke="#F1F5F9" strokeWidth={unit * (near ? 0.9 : 0.4)} />
              {/* generous invisible hit target for touch */}
              <circle cx={x} cy={z} r={unit * 8} fill="transparent" />
            </g>
          );
        })}
        {nodes
          .filter((n) => n.revealed)
          .map((n) => (
            <g key={n.id} className="cursor-pointer" onClick={() => onPick(n.position, "data node")} role="button" aria-label="Walk to data node">
              <rect x={n.position[0] - unit * 1.6} y={n.position[1] - unit * 1.6} width={unit * 3.2} height={unit * 3.2} fill={n.color} transform={`rotate(45 ${n.position[0]} ${n.position[1]})`} />
              <circle cx={n.position[0]} cy={n.position[1]} r={unit * 6} fill="transparent" />
            </g>
          ))}
        <g ref={player} pointerEvents="none">
          <circle r={unit * 4.5} fill="#FACC15" fillOpacity={0.15} />
          <polygon points={`0,${unit * 4} ${-unit * 2.6},${-unit * 2.6} 0,${-unit * 1.2} ${unit * 2.6},${-unit * 2.6}`} fill="#FACC15" />
        </g>
      </svg>
    </div>
  );
}
