import { useEffect, useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import { ChevronDown, ZoomIn, ZoomOut, Network } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function RelationshipGraphVisualization({ sessionId, characters }) {
  const svgRef = useRef(null);
  const canvasRef = useRef(null);
  const [relationships, setRelationships] = useState([]);
  const [nodes, setNodes] = useState([]);
  const [hoveredNode, setHoveredNode] = useState(null);
  const [hoveredEdge, setHoveredEdge] = useState(null);
  const [selectedNode, setSelectedNode] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [loading, setLoading] = useState(true);
  const [expandedNode, setExpandedNode] = useState(null);

  useEffect(() => {
    loadRelationshipData();
  }, [sessionId]);

  const loadRelationshipData = async () => {
    setLoading(true);
    try {
      const rels = await base44.asServiceRole.entities.CharacterRelationship.filter(
        { session_id: sessionId },
        "-updated_date",
        200
      );

      setRelationships(rels || []);

      // Build node data
      const nodeMap = new Map();
      characters.forEach((char) => {
        nodeMap.set(char.id, {
          id: char.id,
          name: char.name,
          avatar: char.avatar_url,
          category: char.category,
          relationships: [],
          totalScore: 0,
        });
      });

      // Aggregate relationship data
      (rels || []).forEach((rel) => {
        const node = nodeMap.get(rel.character_id);
        if (node) {
          node.relationships.push({
            target: rel.with_character_id,
            score: rel.score,
            tier: rel.tier,
            delta: rel.last_delta || 0,
            interactions: rel.total_interactions || 0,
          });
          node.totalScore += rel.score;
        }
      });

      setNodes(Array.from(nodeMap.values()));
    } catch (err) {
      console.error("Error loading relationship data:", err);
    } finally {
      setLoading(false);
    }
  };

  // Force-directed layout simulation
  useEffect(() => {
    if (!nodes.length || !svgRef.current) return;

    const width = svgRef.current.clientWidth || 800;
    const height = svgRef.current.clientHeight || 600;
    const centerX = width / 2;
    const centerY = height / 2;

    // Initialize positions
    let positions = {};
    nodes.forEach((node, idx) => {
      const angle = (idx / nodes.length) * Math.PI * 2;
      const radius = Math.min(width, height) / 3;
      positions[node.id] = {
        x: centerX + radius * Math.cos(angle),
        y: centerY + radius * Math.sin(angle),
        vx: 0,
        vy: 0,
      };
    });

    // Simulation loop
    let animationId;
    const simulate = () => {
      // Apply forces
      nodes.forEach((node, i) => {
        nodes.forEach((other, j) => {
          if (i === j) return;

          const dx = positions[other.id].x - positions[node.id].x;
          const dy = positions[other.id].y - positions[node.id].y;
          const dist = Math.sqrt(dx * dx + dy * dy) + 1;

          // Repulsive force
          const repel = 100 / dist;
          positions[node.id].vx -= (dx / dist) * repel;
          positions[node.id].vy -= (dy / dist) * repel;

          // Attractive force if connected
          const rel = node.relationships.find((r) => r.target === other.id);
          if (rel) {
            const attract = (dist / 300) * (Math.abs(rel.score) / 100);
            positions[node.id].vx += (dx / dist) * attract;
            positions[node.id].vy += (dy / dist) * attract;
          }
        });

        // Center attraction
        positions[node.id].vx += (centerX - positions[node.id].x) * 0.02;
        positions[node.id].vy += (centerY - positions[node.id].y) * 0.02;

        // Friction
        positions[node.id].vx *= 0.95;
        positions[node.id].vy *= 0.95;

        // Update position
        positions[node.id].x += positions[node.id].vx;
        positions[node.id].y += positions[node.id].vy;

        // Bounds
        positions[node.id].x = Math.max(20, Math.min(width - 20, positions[node.id].x));
        positions[node.id].y = Math.max(20, Math.min(height - 20, positions[node.id].y));
      });

      animationId = requestAnimationFrame(simulate);
    };

    simulate();
    return () => cancelAnimationFrame(animationId);
  }, [nodes]);

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

  if (loading) {
    return (
      <div className="h-96 border border-primary/20 bg-black/40 rounded flex items-center justify-center">
        <div className="text-center space-y-2">
          <Network className="w-8 h-8 text-primary/40 mx-auto animate-pulse" />
          <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase">
            Loading relationship graph...
          </p>
        </div>
      </div>
    );
  }

  // Calculate edge strength for visualization
  const getEdgeInfo = (rel) => {
    const strength = Math.abs(rel.score) / 100;
    const thickness = 1 + strength * 5;
    const color = rel.score > 0 ? `rgba(81, 207, 102, ${0.3 + strength * 0.4})` : `rgba(255, 107, 107, ${0.3 + strength * 0.4})`;
    return { thickness, color, strength };
  };

  return (
    <div className="space-y-4 mb-4">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border border-primary/15 bg-primary/5 rounded">
        <div className="flex items-center gap-2">
          <Network className="w-4 h-4 text-primary/60" />
          <span className="font-mono text-[9px] text-primary/40 tracking-widest uppercase">
            Relationship Graph ({nodes.length} characters, {relationships.length} bonds)
          </span>
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => setZoom((z) => Math.min(z + 0.2, 3))}
            className="p-1 text-primary/30 hover:text-primary transition-colors"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <button
            onClick={() => setZoom((z) => Math.max(z - 0.2, 0.5))}
            className="p-1 text-primary/30 hover:text-primary transition-colors"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Graph Canvas */}
      <div className="border border-primary/20 bg-black/40 rounded overflow-hidden" style={{ height: "500px" }}>
        <svg
          ref={svgRef}
          width="100%"
          height="100%"
          className="bg-black/20"
          style={{ cursor: "grab" }}
        >
          {/* Edges */}
          {nodes.map((node) =>
            node.relationships.map((rel) => {
              const targetNode = nodes.find((n) => n.id === rel.target);
              if (!targetNode) return null;

              // Simple positioning (would use actual positions from force sim)
              const angle1 = (nodes.indexOf(node) / nodes.length) * Math.PI * 2;
              const angle2 = (nodes.indexOf(targetNode) / nodes.length) * Math.PI * 2;
              const cx = 250,
                cy = 250;
              const r = 150;
              const x1 = cx + r * Math.cos(angle1);
              const y1 = cy + r * Math.sin(angle1);
              const x2 = cx + r * Math.cos(angle2);
              const y2 = cy + r * Math.sin(angle2);

              const edgeInfo = getEdgeInfo(rel);

              return (
                <g key={`${node.id}-${rel.target}`}>
                  <line
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke={edgeInfo.color}
                    strokeWidth={edgeInfo.thickness}
                    opacity={hoveredEdge === `${node.id}-${rel.target}` ? 1 : 0.5}
                    className="transition-opacity duration-200"
                    onMouseEnter={() => setHoveredEdge(`${node.id}-${rel.target}`)}
                    onMouseLeave={() => setHoveredEdge(null)}
                  />
                  {hoveredEdge === `${node.id}-${rel.target}` && (
                    <text
                      x={(x1 + x2) / 2}
                      y={(y1 + y2) / 2 - 5}
                      textAnchor="middle"
                      className="font-mono text-[10px] fill-primary pointer-events-none"
                    >
                      {rel.score > 0 ? "+" : ""}{rel.score}
                    </text>
                  )}
                </g>
              );
            })
          )}

          {/* Nodes */}
          {nodes.map((node, idx) => {
            const angle = (idx / nodes.length) * Math.PI * 2;
            const cx = 250,
              cy = 250;
            const r = 150;
            const x = cx + r * Math.cos(angle);
            const y = cy + r * Math.sin(angle);
            const isHovered = hoveredNode === node.id;
            const isSelected = selectedNode === node.id;

            return (
              <g key={node.id}>
                {/* Node circle */}
                <circle
                  cx={x}
                  cy={y}
                  r={isHovered || isSelected ? 25 : 18}
                  fill="hsl(220 20% 10%)"
                  stroke="hsl(185 100% 50%)"
                  strokeWidth={isSelected ? 3 : 1.5}
                  className="transition-all duration-200 cursor-pointer"
                  onMouseEnter={() => setHoveredNode(node.id)}
                  onMouseLeave={() => setHoveredNode(null)}
                  onClick={() => setSelectedNode(isSelected ? null : node.id)}
                />
                <text
                  x={x}
                  y={y}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className="font-mono text-[11px] fill-current pointer-events-none select-none"
                  style={{ color: "hsl(185 100% 80%)" }}
                >
                  {node.name[0]}
                </text>

                {/* Hover tooltip */}
                {isHovered && (
                  <g>
                    <rect
                      x={x - 70}
                      y={y - 50}
                      width="140"
                      height="45"
                      rx="4"
                      fill="hsl(220 20% 6%)"
                      stroke="hsl(185 100% 50%)"
                      strokeWidth="1"
                    />
                    <text
                      x={x}
                      y={y - 28}
                      textAnchor="middle"
                      className="font-mono text-[10px] font-semibold fill-primary"
                    >
                      {node.name}
                    </text>
                    <text
                      x={x}
                      y={y - 10}
                      textAnchor="middle"
                      className="font-mono text-[8px] fill-primary/60"
                    >
                      {node.relationships.length} bonds
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {/* Selected Node Details */}
      <AnimatePresence>
        {selectedNode && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="border border-primary/20 bg-black/40 rounded p-3 space-y-2"
          >
            {(() => {
              const node = nodes.find((n) => n.id === selectedNode);
              return (
                <>
                  <p className="font-mono text-[10px] text-primary/60 tracking-widest uppercase">
                    {node.name}'s Bonds
                  </p>
                  <div className="space-y-1.5 max-h-32 overflow-y-auto">
                    {node.relationships.map((rel) => {
                      const targetNode = nodes.find((n) => n.id === rel.target);
                      return (
                        <div
                          key={rel.target}
                          className="flex items-center justify-between p-2 border border-primary/15 bg-black/30 rounded text-[9px] font-mono"
                        >
                          <span className="text-primary/80">{targetNode?.name}</span>
                          <div className="flex items-center gap-2">
                            <span style={{ color: getTierColor(rel.tier) }}>
                              {getTierLabel(rel.tier)}
                            </span>
                            <span className="text-primary/40">
                              {rel.score > 0 ? "+" : ""}
                              {rel.score}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              );
            })()}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Legend */}
      <div className="text-[8px] font-mono text-primary/60 p-2 border border-primary/15 bg-black/30 rounded grid grid-cols-3 gap-2">
        {[
          { tier: "hostile", label: "⚔️ Hostile" },
          { tier: "cold", label: "❄️ Cold" },
          { tier: "neutral", label: "😐 Neutral" },
          { tier: "warm", label: "☀️ Warm" },
          { tier: "close", label: "❤️ Close" },
          { tier: "devoted", label: "💕 Devoted" },
        ].map(({ tier, label }) => (
          <div key={tier} className="flex items-center gap-1.5">
            <div
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: getTierColor(tier) }}
            />
            <span className="text-primary/60">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}