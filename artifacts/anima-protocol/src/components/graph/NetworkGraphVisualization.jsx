import { useMemo } from "react";

export default function NetworkGraphVisualization({ data, selectedNode, onNodeClick }) {
  const { nodes, edges } = useMemo(() => {
    const nodeList = [];
    const edgeList = [];

    // Add character nodes
    data.characters.forEach((char, idx) => {
      nodeList.push({
        id: char.id,
        type: "character",
        name: char.name,
        x: 100 + (idx % 5) * 150,
        y: 100 + Math.floor(idx / 5) * 150,
        color: "#06b6d4",
        radius: 15,
      });
    });

    // Add faction nodes
    data.factions.forEach((faction, idx) => {
      nodeList.push({
        id: faction.id,
        type: "faction",
        name: faction.name,
        x: 500 + (idx % 3) * 150,
        y: 500 + Math.floor(idx / 3) * 150,
        color: "#eab308",
        radius: 18,
      });
    });

    // Add location nodes
    data.locations.forEach((loc, idx) => {
      nodeList.push({
        id: loc.id,
        type: "location",
        name: loc.name,
        x: 800 + (idx % 4) * 140,
        y: 100 + Math.floor(idx / 4) * 140,
        color: "#22c55e",
        radius: 16,
      });
    });

    // Add relationship edges
    data.relationships.forEach((rel) => {
      edgeList.push({
        from: rel.character_id,
        to: rel.related_character_id,
        score: rel.score || 0,
        tier: rel.tier || "neutral",
      });
    });

    return { nodes: nodeList, edges: edgeList };
  }, [data]);

  const getTierColor = (tier) => {
    const colors = {
      hostile: "#ff6b6b",
      cold: "#ffa94d",
      neutral: "#868e96",
      warm: "#74c0fc",
      close: "#51cf66",
      devoted: "#ff6b9d",
    };
    return colors[tier] || "#868e96";
  };

  return (
    <>
      {/* Edges */}
      {edges.map((edge) => {
        const fromNode = nodes.find((n) => n.id === edge.from);
        const toNode = nodes.find((n) => n.id === edge.to);

        if (!fromNode || !toNode) return null;

        return (
          <line
            key={`${edge.from}-${edge.to}`}
            x1={fromNode.x}
            y1={fromNode.y}
            x2={toNode.x}
            y2={toNode.y}
            stroke={getTierColor(edge.tier)}
            strokeWidth={Math.max(1, Math.abs(edge.score) / 30)}
            opacity={edge.score > 0 ? 0.6 : 0.3}
          />
        );
      })}

      {/* Nodes */}
      {nodes.map((node) => (
        <g key={node.id} onClick={() => onNodeClick(node)} style={{ cursor: "pointer" }}>
          <circle
            cx={node.x}
            cy={node.y}
            r={selectedNode?.id === node.id ? node.radius + 5 : node.radius}
            fill={node.color}
            opacity={selectedNode?.id === node.id ? 1 : 0.7}
            stroke={selectedNode?.id === node.id ? "#06b6d4" : "none"}
            strokeWidth={selectedNode?.id === node.id ? 2 : 0}
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
        </g>
      ))}
    </>
  );
}