import { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { Heart, TrendingUp, TrendingDown, Zap } from "lucide-react";

export default function CharacterRelationshipGraph({ sessionId }) {
  const svgRef = useRef(null);
  const [characters, setCharacters] = useState([]);
  const [relationships, setRelationships] = useState([]);
  const [nodes, setNodes] = useState([]);
  const [links, setLinks] = useState([]);
  const [selectedChar, setSelectedChar] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, [sessionId]);

  const loadData = async () => {
    setLoading(true);
    const [chars, rels] = await Promise.all([
      base44.entities.Character.list("-created_date", 100),
      sessionId
        ? base44.entities.CharacterRelationship.filter({ session_id: sessionId }, "-created_date", 200)
        : base44.entities.CharacterRelationship.list("-created_date", 200)
    ]);

    setCharacters(chars || []);
    setRelationships(rels || []);

    // Build graph data
    buildGraph(chars || [], rels || []);
    setLoading(false);
  };

  const buildGraph = (chars, rels) => {
    const charMap = new Map(chars.map(c => [c.id, c]));
    
    // Create nodes with initial positions in a circle
    const graphNodes = chars.map((char, idx) => {
      const angle = (idx / chars.length) * Math.PI * 2;
      const radius = 30;
      return {
        id: char.id,
        label: char.name,
        avatar: char.avatar_url,
        x: 50 + radius * Math.cos(angle),
        y: 50 + radius * Math.sin(angle),
        vx: 0,
        vy: 0
      };
    });

    // Create edges from relationships
    const graphLinks = rels.map(rel => ({
      source: rel.character_id,
      target: selectedChar || rel.character_id,
      strength: rel.score || 0,
      tier: rel.tier,
      interactions: rel.total_interactions || 0,
      delta: rel.last_delta || 0
    })).filter(link => {
      const sourceChar = charMap.get(link.source);
      const targetChar = charMap.get(link.target);
      return sourceChar && targetChar;
    });

    setNodes(graphNodes);
    setLinks(graphLinks);
  };

  const getTierColor = (tier) => {
    const colors = {
      hostile: "#EF4444",
      cold: "#F97316",
      neutral: "#8B5CF6",
      warm: "#3B82F6",
      close: "#10B981",
      devoted: "#EC4899"
    };
    return colors[tier] || "#6B7280";
  };

  const getTierLabel = (score) => {
    if (score < -50) return "hostile";
    if (score < -25) return "cold";
    if (score < 25) return "neutral";
    if (score < 50) return "warm";
    if (score < 75) return "close";
    return "devoted";
  };

  const selectedRelationships = relationships.filter(
    r => r.character_id === selectedChar || !selectedChar
  );

  return (
    <div className="space-y-4">
      {/* SVG Graph */}
      <div className="border border-primary/20 bg-black/40 p-4 rounded overflow-hidden">
        <svg
          ref={svgRef}
          viewBox="0 0 100 100"
          className="w-full bg-black/60 border border-primary/10"
          style={{ minHeight: "500px" }}
        >
          {/* Grid background */}
          <defs>
            <pattern id="gridPattern" width="10" height="10" patternUnits="userSpaceOnUse">
              <path d="M 10 0 L 0 0 0 10" fill="none" stroke="#60a5fa" strokeWidth="0.05" opacity="0.1" />
            </pattern>
          </defs>
          <rect width="100" height="100" fill="url(#gridPattern)" />

          {/* Links (relationships) */}
          {links.map((link, idx) => {
            const sourceNode = nodes.find(n => n.id === link.source);
            const targetNode = nodes.find(n => n.id === link.target);
            if (!sourceNode || !targetNode) return null;

            const color = getTierColor(link.tier);
            const opacity = Math.abs(link.strength) / 100;
            const strokeWidth = Math.abs(link.strength) / 50;

            return (
              <g key={`link-${idx}`}>
                <line
                  x1={sourceNode.x}
                  y1={sourceNode.y}
                  x2={targetNode.x}
                  y2={targetNode.y}
                  stroke={color}
                  strokeWidth={Math.max(0.1, strokeWidth)}
                  opacity={Math.min(1, opacity + 0.2)}
                  strokeDasharray={link.strength < 0 ? "0.5,0.5" : "0"}
                />
                {/* Strength label */}
                {link.strength !== 0 && (
                  <text
                    x={(sourceNode.x + targetNode.x) / 2}
                    y={(sourceNode.y + targetNode.y) / 2}
                    textAnchor="middle"
                    fontSize="0.4"
                    fill={color}
                    opacity="0.7"
                    pointerEvents="none"
                  >
                    {link.strength > 0 ? "+" : ""}{link.strength}
                  </text>
                )}
              </g>
            );
          })}

          {/* Nodes (characters) */}
          {nodes.map(node => (
            <g
              key={node.id}
              style={{ cursor: "pointer" }}
              onClick={() => setSelectedChar(selectedChar === node.id ? null : node.id)}
            >
              {/* Glow effect for selected */}
              {selectedChar === node.id && (
                <circle
                  cx={node.x}
                  cy={node.y}
                  r="3.5"
                  fill="none"
                  stroke="#60A5FA"
                  strokeWidth="0.3"
                  opacity="0.5"
                  style={{ animation: "pulse 1.5s infinite" }}
                />
              )}

              {/* Main circle */}
              <circle
                cx={node.x}
                cy={node.y}
                r="2"
                fill="#1F2937"
                stroke="#60A5FA"
                strokeWidth="0.2"
              />

              {/* Label */}
              <text
                x={node.x}
                y={node.y + 3.5}
                textAnchor="middle"
                fontSize="0.5"
                fill="#E0E7FF"
                pointerEvents="none"
                style={{ fontWeight: "bold" }}
              >
                {node.label.slice(0, 8)}
              </text>
            </g>
          ))}
        </svg>

        {/* Legend */}
        <div className="mt-3 grid grid-cols-3 sm:grid-cols-6 gap-2 text-[8px] font-mono flex-wrap">
          {["hostile", "cold", "neutral", "warm", "close", "devoted"].map(tier => (
            <div key={tier} className="flex items-center gap-1">
              <div
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: getTierColor(tier) }}
              />
              <span className="text-primary/50 uppercase">{tier}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Detail Panel */}
      {selectedChar && (
        <div className="border border-primary/30 bg-primary/5 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-mono text-sm text-primary tracking-wider uppercase">
              Relationship Network
            </h3>
            <button
              onClick={() => setSelectedChar(null)}
              className="text-primary/40 hover:text-primary transition-colors text-xs"
            >
              ✕ Clear
            </button>
          </div>

          <div className="grid gap-2 max-h-48 overflow-y-auto">
            {selectedRelationships.map(rel => {
              const targetChar = characters.find(c => c.id === rel.character_id);
              if (!targetChar) return null;

              const tier = getTierLabel(rel.score);
              const color = getTierColor(tier);
              const trending = rel.last_delta > 0 ? "up" : rel.last_delta < 0 ? "down" : "neutral";

              return (
                <div
                  key={rel.id}
                  className="p-2.5 border border-primary/15 bg-black/40 space-y-1"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[10px] text-primary/80 tracking-wider uppercase">
                      {targetChar.name}
                    </span>
                    <div className="flex items-center gap-1">
                      <Heart className="w-3 h-3" style={{ color }} />
                      <span className="font-mono text-[9px]" style={{ color }}>
                        {rel.score > 0 ? "+" : ""}{rel.score}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-[9px] font-mono text-primary/50">
                    <span className="uppercase">{tier}</span>
                    <div className="flex items-center gap-1">
                      {trending === "up" && (
                        <TrendingUp className="w-3 h-3 text-green-400" />
                      )}
                      {trending === "down" && (
                        <TrendingDown className="w-3 h-3 text-red-400" />
                      )}
                      {trending === "neutral" && (
                        <Zap className="w-3 h-3 text-primary/30" />
                      )}
                      <span>{rel.total_interactions} interactions</span>
                    </div>
                  </div>

                  {rel.last_delta !== 0 && (
                    <div
                      className="text-[8px] font-mono px-1.5 py-0.5 border-l-2"
                      style={{
                        borderColor: color,
                        color: color
                      }}
                    >
                      Last change: {rel.last_delta > 0 ? "+" : ""}{rel.last_delta} ({new Date(rel.updated_date).toLocaleDateString()})
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loading && characters.length === 0 && (
        <div className="text-center py-12">
          <Heart className="w-8 h-8 text-primary/10 mx-auto mb-3" />
          <p className="font-mono text-primary/20 text-sm tracking-[0.3em] uppercase">
            No characters to relate
          </p>
        </div>
      )}

      {loading && (
        <div className="text-center py-12 font-mono text-primary/30 animate-pulse">
          Loading relationship graph...
        </div>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.5; r: 3.5; }
          50% { opacity: 1; r: 4.5; }
        }
      `}</style>
    </div>
  );
}