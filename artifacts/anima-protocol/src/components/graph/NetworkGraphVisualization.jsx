import { useMemo } from "react";

/** Smallest square drawing space; a crowded graph grows it (see layoutGraph). */
export const GRAPH_SIZE = 1000;

export const NODE_COLORS = {
  character: "#06b6d4",
  faction: "#eab308",
  location: "#22c55e",
};

// Sized for a ~1000-unit view drawn into a 360–700px canvas.
const RADIUS = { character: 22, faction: 26, location: 24 };
/** Arc length per node on a ring: circle plus its name label. */
const NODE_SPACING = 120;
const FIRST_RING = 170;
const RING_GAP = 120;
const MARGIN = 110;

/**
 * Pure layout for the relationship network: concentric rings around the
 * centre, characters innermost, then factions, then locations. A ring only
 * holds as many nodes as fit at NODE_SPACING, so a crowded group spills onto
 * further rings instead of overlapping, and the drawing space (`size`, the
 * <svg> viewBox) grows to fit. Edges are kept only when both ends exist and
 * once per pair.
 *
 * @param {{ characters?: any[], factions?: any[], locations?: any[], relationships?: any[] }} data
 * @returns {{ nodes: any[], edges: any[], size: number }}
 */
export function layoutGraph(data) {
  const list = (v) => (Array.isArray(v) ? v : []);
  const groups = [
    ["character", list(data?.characters)],
    ["faction", list(data?.factions)],
    ["location", list(data?.locations)],
  ].filter(([, items]) => items.length > 0);
  const total = groups.reduce((n, [, items]) => n + items.length, 0);

  /** @type {{ type: string, item: any, r: number, a: number }[]} */
  const placed = [];
  let r = total === 1 ? 0 : FIRST_RING;
  groups.forEach(([type, items], gi) => {
    let i = 0;
    while (i < items.length) {
      const capacity = r === 0 ? 1 : Math.max(3, Math.floor((2 * Math.PI * r) / NODE_SPACING));
      const onRing = items.slice(i, i + capacity);
      // Offset each ring's start so neighbouring rings don't share spokes.
      const offset = gi * 0.35 + (r / RING_GAP) * 0.2;
      onRing.forEach((item, k) => {
        placed.push({ type, item, r, a: offset + (k / onRing.length) * Math.PI * 2 - Math.PI / 2 });
      });
      i += onRing.length;
      r = r === 0 ? FIRST_RING : r + RING_GAP;
    }
  });
  const maxR = placed.reduce((m, p) => Math.max(m, p.r), 0);
  const size = Math.max(GRAPH_SIZE, Math.ceil(2 * (maxR + MARGIN)));
  const c = size / 2;

  const nodes = placed.map(({ type, item, r: pr, a }) => ({
    id: item?.id,
    type,
    name: typeof item?.name === "string" && item.name.trim() ? item.name.trim() : "?",
    x: c + Math.cos(a) * pr,
    y: c + Math.sin(a) * pr,
    color: NODE_COLORS[type],
    radius: RADIUS[type],
  }));

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const seen = new Set();
  const edges = [];
  for (const rel of list(data?.relationships)) {
    const from = byId.get(rel?.character_id);
    const to = byId.get(rel?.related_character_id);
    if (!from || !to || from === to) continue;
    const key = [from.id, to.id].sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ key, from, to, score: Number(rel.score) || 0, tier: rel.tier || "neutral" });
  }

  return { nodes, edges, size };
}

const TIER_COLORS = {
  hostile: "#ff6b6b",
  cold: "#ffa94d",
  neutral: "#868e96",
  warm: "#74c0fc",
  close: "#51cf66",
  devoted: "#ff6b9d",
};

function shortLabel(name) {
  return name.length > 14 ? `${name.slice(0, 13)}…` : name;
}

/**
 * Draws a layoutGraph() result. Pass `layout` when the parent already
 * computed it (it needs `size` for the viewBox); otherwise it is derived.
 */
export default function NetworkGraphVisualization({ data, layout, selectedNode, onNodeClick }) {
  const own = useMemo(() => (layout ? null : layoutGraph(data)), [layout, data]);
  const { nodes, edges } = layout || own;

  return (
    <>
      {/* Edges */}
      {edges.map((edge) => (
        <line
          key={edge.key}
          data-graph-edge={edge.tier}
          x1={edge.from.x}
          y1={edge.from.y}
          x2={edge.to.x}
          y2={edge.to.y}
          stroke={TIER_COLORS[edge.tier] || TIER_COLORS.neutral}
          strokeWidth={Math.max(2.5, Math.abs(edge.score) / 15)}
          opacity={edge.score > 0 ? 0.7 : 0.4}
        />
      ))}

      {/* Nodes */}
      {nodes.map((node) => {
        const selected = selectedNode?.id === node.id;
        return (
          <g
            key={`${node.type}:${node.id}`}
            data-graph-node={node.type}
            role="button"
            tabIndex={0}
            aria-label={`${node.name} (${node.type})`}
            aria-pressed={selected}
            onClick={() => onNodeClick(node)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onNodeClick(node);
              }
            }}
            style={{ cursor: "pointer" }}
          >
            <title>{node.name}</title>
            <circle
              cx={node.x}
              cy={node.y}
              r={selected ? node.radius + 5 : node.radius}
              fill={node.color}
              opacity={selected ? 1 : 0.8}
              stroke={selected ? "#ffffff" : "none"}
              strokeWidth={selected ? 3 : 0}
              style={{ transition: "all 0.2s ease" }}
            />
            <text
              x={node.x}
              y={node.y}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize="20"
              fontWeight="bold"
              fontFamily="monospace"
              fill="#000"
              pointerEvents="none"
            >
              {node.name[0]}
            </text>
            <text
              x={node.x}
              y={node.y + node.radius + 24}
              textAnchor="middle"
              fontSize="20"
              fontFamily="monospace"
              fill={node.color}
              opacity="0.85"
              pointerEvents="none"
            >
              {shortLabel(node.name)}
            </text>
          </g>
        );
      })}
    </>
  );
}
