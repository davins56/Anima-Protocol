/**
 * 2D SVG network map: the fallback for every device and GL tier. Anima 3D
 * Visual's 3D renderer reads the same DeepnetMap contract (#757 §7).
 * Labels are plain text; nothing from the server is rendered as HTML.
 */
import { BAND_BY_KEY } from "@workspace/sim-core";
import type { DeepnetMap } from "./types";

type Props = { map: DeepnetMap; selectedId?: string | null; onSelect: (nodeId: string) => void };

const PAD = 2;

export function mapBounds(map: DeepnetMap) {
  const xs = map.nodes.map((n) => n.pos[0]);
  const zs = map.nodes.map((n) => n.pos[1]);
  const minX = Math.min(...xs, 0) - PAD;
  const maxX = Math.max(...xs, 0) + PAD;
  const minZ = Math.min(...zs, 0) - PAD;
  const maxZ = Math.max(...zs, 0) + PAD;
  return { minX, minZ, width: maxX - minX, height: maxZ - minZ };
}

export default function NetworkMap2D({ map, selectedId, onSelect }: Props) {
  const b = mapBounds(map);
  const byId = new Map(map.nodes.map((n) => [n.id, n]));
  return (
    <svg
      viewBox={`${b.minX} ${b.minZ} ${b.width} ${b.height}`}
      className="w-full h-auto max-h-[50vh] border border-border bg-black/60"
      role="group"
      aria-label="Network map"
    >
      {map.edges.map((e) => {
        const a = byId.get(e.from);
        const c = byId.get(e.to);
        if (!a || !c) return null;
        return (
          <line
            key={`${e.from}-${e.to}`}
            x1={a.pos[0]}
            y1={a.pos[1]}
            x2={c.pos[0]}
            y2={c.pos[1]}
            stroke={e.state === "open" ? "#94A3B8" : "#334155"}
            strokeWidth={0.15}
            strokeDasharray={e.state === "open" ? undefined : "0.4 0.3"}
            data-testid={`edge-${e.from}-${e.to}`}
          />
        );
      })}
      {map.nodes.map((n) => {
        const color = n.locked ? "#475569" : BAND_BY_KEY[n.band]?.color ?? "#94A3B8";
        const label = n.locked && n.kind === "signal_lost" ? "Signal lost" : n.label;
        return (
          <g
            key={n.id}
            role="button"
            tabIndex={n.locked ? -1 : 0}
            aria-disabled={n.locked}
            aria-label={`${label}${n.locked ? " (locked)" : ""}`}
            data-testid={`node-${n.id}`}
            style={{ cursor: n.locked ? "not-allowed" : "pointer" }}
            onClick={() => !n.locked && onSelect(n.id)}
            onKeyDown={(e) => {
              if (!n.locked && (e.key === "Enter" || e.key === " ")) {
                e.preventDefault();
                onSelect(n.id);
              }
            }}
          >
            <circle
              cx={n.pos[0]}
              cy={n.pos[1]}
              r={n.kind === "corridor" ? 0.9 : 0.7}
              fill="#0B1020"
              stroke={color}
              strokeWidth={selectedId === n.id ? 0.3 : 0.15}
            />
            <text x={n.pos[0]} y={n.pos[1] + 1.7} textAnchor="middle" fontSize={0.7} fill={color} fontFamily="monospace">
              {label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
