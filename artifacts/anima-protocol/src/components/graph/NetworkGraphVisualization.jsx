import { useMemo } from "react";

/** Square drawing space the layout uses; the page's <svg> viewBox matches it. */
export const GRAPH_SIZE = 1000;
const CENTER = GRAPH_SIZE / 2;

export const NODE_COLORS = {
  character: "#06b6d4",
  faction: "#eab308",
  location: "#22c55e",
};

const RADIUS = { character: 15, faction: 18, location: 16 };

/**
 * Even spacing on a ring (radius 0 = the centre). The start angle is offset
 * per ring so rings do not line their nodes up on one spoke.
 */
function ring(count, radius, offset) {
  return Array.from({ length: count }, (_, i) => {
    const a = offset + (i / count) * Math.PI * 2 - Math.PI / 2;
    return { x: CENTER + Math.cos(a) * radius, y: CENTER + Math.sin(a) * radius };
  });
}

/**
 * Pure layout for the relationship network: characters on the inner ring,
 * factions on the middle ring, locations on the outer ring, all centred in a
 * GRAPH_SIZE square. Only the rings that have nodes are drawn, and the
 * inner ring takes the free space, so a world with only characters still
 * fills the view instead of packing into a corner grid. Edges are kept only
 * when both ends exist (dangling relationship rows are skipped).
 *
 * @param {{ characters?: any[], factions?: any[], locations?: any[], relationships?: any[] }} data
 */
export function layoutGraph(data) {
  const characters = Array.isArray(data?.characters) ? data.characters : [];
  const factions = Array.isArray(data?.factions) ? data.factions : [];
  const locations = Array.isArray(data?.locations) ? data.locations : [];
  const relationships = Array.isArray(data?.relationships) ? data.relationships : [];

  const groups = [
    ["character", characters],
    ["faction", factions],
    ["location", locations],
  ].filter(([, list]) => list.length > 0);

  const outer = CENTER - 70;
  const nodes = [];
  groups.forEach(([type, list], gi) => {
    // One group: a single ring at ~70% of the space. Several: spread from the
    // inner ring out to the edge.
    const radius = groups.length === 1 ? outer * 0.8 : outer * ((gi + 1) / groups.length);
    const points = ring(list.length, list.length === 1 && groups.length === 1 ? 0 : radius, gi * 0.35);
    list.forEach((item, i) => {
      const name = typeof item?.name === "string" && item.name.trim() ? item.name.trim() : "?";
      nodes.push({
        id: item.id,
        type,
        name,
        x: points[i].x,
        y: points[i].y,
        color: NODE_COLORS[type],
        radius: RADIUS[type],
      });
    });
  });

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const seen = new Set();
  const edges = [];
  for (const rel of relationships) {
    const from = byId.get(rel?.character_id);
    const to = byId.get(rel?.related_character_id);
    if (!from || !to || from === to) continue;
    const key = [from.id, to.id].sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ key, from, to, score: Number(rel.score) || 0, tier: rel.tier || "neutral" });
  }

  return { nodes, edges };
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

export default function NetworkGraphVisualization({ data, selectedNode, onNodeClick }) {
  const { nodes, edges } = useMemo(() => layoutGraph(data), [data]);

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
          strokeWidth={Math.max(1.5, Math.abs(edge.score) / 30)}
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
            onClick={() => onNodeClick(node)}
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
              strokeWidth={selected ? 2 : 0}
              style={{ transition: "all 0.2s ease" }}
            />
            <text
              x={node.x}
              y={node.y}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize="10"
              fontFamily="monospace"
              fill="#000"
              pointerEvents="none"
            >
              {node.name[0]}
            </text>
            <text
              x={node.x}
              y={node.y + node.radius + 13}
              textAnchor="middle"
              fontSize="11"
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
