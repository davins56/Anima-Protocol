import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function CharacterNetworkGraph({ characters, relationships }) {
  const svgRef = useRef(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [hoveredNode, setHoveredNode] = useState(null);
  const [hoveredEdge, setHoveredEdge] = useState(null);
  const [positions, setPositions] = useState({});
  const [showLegend, setShowLegend] = useState(false);

  // Calculate positions using a simple circular layout with force simulation
  useEffect(() => {
    if (!characters || characters.length === 0) return;

    const width = svgRef.current?.clientWidth || 800;
    const height = svgRef.current?.clientHeight || 600;
    setDimensions({ width, height });

    // Initialize circular positions
    const newPositions = {};
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) / 3;

    characters.forEach((char, idx) => {
      const angle = (idx / characters.length) * Math.PI * 2;
      newPositions[char.id] = {
        x: centerX + radius * Math.cos(angle),
        y: centerY + radius * Math.sin(angle),
      };
    });

    setPositions(newPositions);
  }, [characters]);

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

  const getTierLabel = (tier) => {
    const labels = {
      hostile: "⚔️ Hostile",
      cold: "❄️ Cold",
      neutral: "😐 Neutral",
      warm: "☀️ Warm",
      close: "❤️ Close",
      devoted: "💕 Devoted",
    };
    return labels[tier] || tier;
  };

  // Build relationship edges
  const edges = [];
  const edgeMap = new Map();

  Object.entries(relationships).forEach(([charId, rel]) => {
    const key = [charId, rel.character_id].sort().join("-");
    if (!edgeMap.has(key)) {
      const char1Pos = positions[charId];
      const char2Pos = positions[rel.character_id];

      if (char1Pos && char2Pos) {
        edges.push({
          id: key,
          from: charId,
          to: rel.character_id,
          score: rel.score || 0,
          tier: rel.tier || "neutral",
          interactions: rel.total_interactions || 0,
          x1: char1Pos.x,
          y1: char1Pos.y,
          x2: char2Pos.x,
          y2: char2Pos.y,
        });
        edgeMap.set(key, true);
      }
    }
  });

  const getEdgeThickness = (score) => {
    const normalized = (score + 100) / 200; // Normalize from -100..100 to 0..1
    return Math.max(1, normalized * 6);
  };

  const getEdgeOpacity = (score) => {
    const normalized = Math.abs(score) / 100;
    return 0.3 + normalized * 0.6;
  };

  if (!characters || characters.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3 mb-4">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border border-primary/15 bg-primary/5 rounded">
        <span className="font-mono text-[9px] text-primary/40 tracking-widest uppercase">
          Character Network ({characters.length} nodes, {edges.length} edges)
        </span>
        <button
          onClick={() => setShowLegend(!showLegend)}
          className="text-primary/40 hover:text-primary transition-colors"
        >
          <ChevronDown className={`w-4 h-4 transition-transform ${showLegend ? "rotate-180" : ""}`} />
        </button>
      </div>

      {/* Legend */}
      <AnimatePresence>
        {showLegend && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="grid grid-cols-3 gap-2 p-2 border border-primary/15 bg-black/30 rounded text-[8px] font-mono"
          >
            {[
              { tier: "hostile", label: "⚔️ Hostile", desc: "Enemies" },
              { tier: "cold", label: "❄️ Cold", desc: "Distant" },
              { tier: "neutral", label: "😐 Neutral", desc: "Neutral" },
              { tier: "warm", label: "☀️ Warm", desc: "Friendly" },
              { tier: "close", label: "❤️ Close", desc: "Friends" },
              { tier: "devoted", label: "💕 Devoted", desc: "Devoted" },
            ].map(({ tier, label, desc }) => (
              <div key={tier} className="flex items-center gap-1.5">
                <div
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: getTierColor(tier) }}
                />
                <span className="text-primary/60">{label}</span>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Network Graph */}
      <div className="border border-primary/20 bg-black/40 rounded overflow-hidden" style={{ height: "400px" }}>
        <svg
          ref={svgRef}
          width="100%"
          height="100%"
          className="bg-black/20"
          style={{ cursor: hoveredNode ? "pointer" : "default" }}
        >
          {/* Edges */}
          {edges.map((edge) => (
            <g key={edge.id}>
              <line
                x1={edge.x1}
                y1={edge.y1}
                x2={edge.x2}
                y2={edge.y2}
                stroke={getTierColor(edge.tier)}
                strokeWidth={hoveredEdge === edge.id ? getEdgeThickness(edge.score) * 1.5 : getEdgeThickness(edge.score)}
                opacity={hoveredEdge === edge.id ? Math.min(getEdgeOpacity(edge.score) + 0.2, 1) : getEdgeOpacity(edge.score)}
                className="transition-all duration-200 pointer-events-auto"
                style={{ cursor: "pointer" }}
                onMouseEnter={() => setHoveredEdge(edge.id)}
                onMouseLeave={() => setHoveredEdge(null)}
              />

              {/* Edge label on hover */}
              {hoveredEdge === edge.id && (
                <text
                  x={(edge.x1 + edge.x2) / 2}
                  y={(edge.y1 + edge.y2) / 2 - 5}
                  textAnchor="middle"
                  className="font-mono text-[8px] fill-current pointer-events-none"
                  style={{ color: getTierColor(edge.tier) }}
                >
                  {edge.score > 0 ? "+" : ""}{edge.score}
                </text>
              )}
            </g>
          ))}

          {/* Nodes */}
          {characters.map((char) => {
            const pos = positions[char.id];
            if (!pos) return null;

            const nodeRadius = 20;
            const isHovered = hoveredNode === char.id;

            return (
              <g key={char.id}>
                {/* Node circle */}
                <circle
                  cx={pos.x}
                  cy={pos.y}
                  r={isHovered ? nodeRadius + 5 : nodeRadius}
                  fill="hsl(220 20% 10%)"
                  stroke="hsl(185 100% 50%)"
                  strokeWidth={isHovered ? 3 : 1.5}
                  className="transition-all duration-200 pointer-events-auto cursor-pointer"
                  onMouseEnter={() => setHoveredNode(char.id)}
                  onMouseLeave={() => setHoveredNode(null)}
                />

                {/* Node label */}
                <text
                  x={pos.x}
                  y={pos.y}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className="font-mono text-[10px] fill-current pointer-events-none select-none"
                  style={{ color: "hsl(185 100% 80%)" }}
                >
                  {char.name?.[0] || "?"}
                </text>

                {/* Tooltip on hover */}
                {isHovered && (
                  <g>
                    <rect
                      x={pos.x - 60}
                      y={pos.y - 60}
                      width="120"
                      height="50"
                      rx="4"
                      fill="hsl(220 20% 6%)"
                      stroke="hsl(185 100% 50%)"
                      strokeWidth="1"
                      opacity="0.95"
                    />
                    <text
                      x={pos.x}
                      y={pos.y - 38}
                      textAnchor="middle"
                      className="font-mono text-[9px] font-semibold fill-current"
                      style={{ color: "hsl(185 100% 80%)" }}
                    >
                      {char.name}
                    </text>
                    <text
                      x={pos.x}
                      y={pos.y - 22}
                      textAnchor="middle"
                      className="font-mono text-[8px] fill-current"
                      style={{ color: "hsl(185 30% 50%)" }}
                    >
                      {char.category || "character"}
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {/* Edge List */}
      {edges.length > 0 && (
        <div className="text-[8px] font-mono text-primary/60 p-2 border border-primary/15 bg-black/30 rounded max-h-32 overflow-y-auto">
          <p className="text-primary/40 tracking-widest uppercase mb-1.5">Connections ({edges.length})</p>
          <div className="space-y-1">
            {edges.map((edge) => {
              const char1 = characters.find(c => c.id === edge.from);
              const char2 = characters.find(c => c.id === edge.to);
              return (
                <div key={edge.id} className="flex items-center justify-between">
                  <span className="flex-1 truncate">
                    {char1?.name} ↔ {char2?.name}
                  </span>
                  <span
                    className="flex-shrink-0 ml-2"
                    style={{ color: getTierColor(edge.tier) }}
                  >
                    {getTierLabel(edge.tier)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}