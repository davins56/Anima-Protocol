import { useEffect, useRef, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown } from 'lucide-react';

export default function SessionRelationshipGraph({ 
  sessionId, 
  characters, 
  characterEmotions,
  isVisible = true 
}) {
  const svgRef = useRef(null);
  const [relationships, setRelationships] = useState([]);
  const [positions, setPositions] = useState({});
  const [hoveredNode, setHoveredNode] = useState(null);
  const [hoveredEdge, setHoveredEdge] = useState(null);
  const [showLegend, setShowLegend] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dimensions, setDimensions] = useState({ width: 800, height: 500 });

  // Load relationships
  useEffect(() => {
    const loadRelationships = async () => {
      try {
        const rels = await base44.entities.CharacterRelationship.filter({
          session_id: sessionId,
        });
        setRelationships(rels || []);
      } catch (err) {
        console.error('Error loading relationships:', err);
      } finally {
        setLoading(false);
      }
    };

    if (sessionId) {
      loadRelationships();
    }
  }, [sessionId]);

  // Initialize positions with force-directed layout
  useEffect(() => {
    if (!characters || characters.length === 0) return;

    const width = svgRef.current?.clientWidth || 800;
    const height = svgRef.current?.clientHeight || 500;
    setDimensions({ width, height });

    const newPositions = {};
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) / 3;

    // Initialize circular layout
    characters.forEach((char, idx) => {
      const angle = (idx / characters.length) * Math.PI * 2;
      newPositions[char.id] = {
        x: centerX + radius * Math.cos(angle),
        y: centerY + radius * Math.sin(angle),
        vx: 0,
        vy: 0,
      };
    });

    // Simple force simulation (3 iterations)
    for (let iter = 0; iter < 3; iter++) {
      const force = 0.5;
      const distance = radius * 1.5;

      characters.forEach((char, idx) => {
        const pos = newPositions[char.id];
        const dx = centerX - pos.x;
        const dy = centerY - pos.y;
        const d = Math.sqrt(dx * dx + dy * dy);

        pos.vx += (dx / (d || 1)) * force;
        pos.vy += (dy / (d || 1)) * force;

        characters.forEach((other, jdx) => {
          if (idx === jdx) return;
          const otherPos = newPositions[other.id];
          const dx2 = otherPos.x - pos.x;
          const dy2 = otherPos.y - pos.y;
          const d2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);

          if (d2 < distance && d2 > 0) {
            const repel = -0.3;
            pos.vx += (dx2 / d2) * repel;
            pos.vy += (dy2 / d2) * repel;
          }
        });

        pos.x += pos.vx * 0.1;
        pos.y += pos.vy * 0.1;
        pos.vx *= 0.9;
        pos.vy *= 0.9;
      });
    }

    setPositions(newPositions);
  }, [characters]);

  const getTierColor = (tier) => {
    const colors = {
      hostile: '#ff6b6b',
      cold: '#ffa94d',
      neutral: '#868e96',
      warm: '#74c0fc',
      close: '#51cf66',
      devoted: '#ff6b9d',
    };
    return colors[tier] || '#868e96';
  };

  const getTierLabel = (tier) => {
    return tier.charAt(0).toUpperCase() + tier.slice(1);
  };

  const getEdgeThickness = (score) => {
    const normalized = Math.abs(score) / 100;
    return Math.max(1, normalized * 6);
  };

  const getEdgeOpacity = (score) => {
    const normalized = Math.abs(score) / 100;
    return 0.25 + normalized * 0.5;
  };

  if (!isVisible || characters.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-4 border border-primary/20 bg-black/40 rounded-lg space-y-3"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-mono text-[9px] text-primary/60 tracking-widest uppercase">
            Character Network
          </h3>
          <p className="text-[8px] text-primary/30 mt-0.5">
            {characters.length} characters, {relationships.length} connections
          </p>
        </div>
        <button
          onClick={() => setShowLegend(!showLegend)}
          className="text-primary/40 hover:text-primary transition-colors"
        >
          <ChevronDown className={`w-4 h-4 transition-transform ${showLegend ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {/* Legend */}
      <AnimatePresence>
        {showLegend && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="grid grid-cols-3 gap-2 p-2 bg-black/60 rounded border border-primary/10 text-[8px] font-mono"
          >
            {[
              { tier: 'hostile', emoji: '⚔️' },
              { tier: 'cold', emoji: '❄️' },
              { tier: 'neutral', emoji: '😐' },
              { tier: 'warm', emoji: '☀️' },
              { tier: 'close', emoji: '❤️' },
              { tier: 'devoted', emoji: '💕' },
            ].map(({ tier, emoji }) => (
              <div key={tier} className="flex items-center gap-1.5">
                <div
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: getTierColor(tier) }}
                />
                <span className="text-primary/60">
                  {emoji} {getTierLabel(tier)}
                </span>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Graph Container */}
      <div className="border border-primary/10 bg-black/60 rounded overflow-hidden" style={{ height: '400px' }}>
        {loading ? (
          <div className="w-full h-full flex items-center justify-center">
            <p className="font-mono text-[9px] text-primary/40 animate-pulse">Loading network...</p>
          </div>
        ) : (
          <svg
            ref={svgRef}
            width="100%"
            height="100%"
            className="bg-black/20"
            style={{ cursor: hoveredNode ? 'pointer' : 'default' }}
          >
            {/* Edges */}
            {relationships.map((rel) => {
              const pos1 = positions[rel.character_a_id];
              const pos2 = positions[rel.character_b_id];

              if (!pos1 || !pos2) return null;

              const edgeId = [rel.character_a_id, rel.character_b_id].sort().join('-');
              const isHovered = hoveredEdge === edgeId;

              return (
                <g key={edgeId}>
                  <line
                    x1={pos1.x}
                    y1={pos1.y}
                    x2={pos2.x}
                    y2={pos2.y}
                    stroke={getTierColor(rel.tier || 'neutral')}
                    strokeWidth={isHovered ? getEdgeThickness(rel.score) * 2 : getEdgeThickness(rel.score)}
                    opacity={isHovered ? Math.min(getEdgeOpacity(rel.score) + 0.3, 1) : getEdgeOpacity(rel.score)}
                    className="transition-all duration-200 pointer-events-auto"
                    style={{ cursor: 'pointer' }}
                    onMouseEnter={() => setHoveredEdge(edgeId)}
                    onMouseLeave={() => setHoveredEdge(null)}
                  />

                  {/* Edge label on hover */}
                  {isHovered && (
                    <text
                      x={(pos1.x + pos2.x) / 2}
                      y={(pos1.y + pos2.y) / 2 - 8}
                      textAnchor="middle"
                      className="font-mono text-[8px] fill-current pointer-events-none select-none"
                      style={{ color: getTierColor(rel.tier || 'neutral') }}
                    >
                      {rel.score > 0 ? '+' : ''}{rel.score}
                    </text>
                  )}
                </g>
              );
            })}

            {/* Nodes */}
            {characters.map((char) => {
              const pos = positions[char.id];
              if (!pos) return null;

              const isHovered = hoveredNode === char.id;
              const charEmotion = characterEmotions?.[char.id];
              const nodeRadius = isHovered ? 26 : 20;

              return (
                <g key={char.id}>
                  {/* Emotion glow on hover */}
                  {isHovered && charEmotion && (
                    <circle
                      cx={pos.x}
                      cy={pos.y}
                      r={nodeRadius + 10}
                      fill="none"
                      stroke={`hsl(var(--primary))`}
                      strokeWidth="1"
                      opacity="0.3"
                      className="animate-pulse"
                    />
                  )}

                  {/* Node circle */}
                  <circle
                    cx={pos.x}
                    cy={pos.y}
                    r={nodeRadius}
                    fill="hsl(220 20% 10%)"
                    stroke="hsl(185 100% 50%)"
                    strokeWidth={isHovered ? 2.5 : 1.5}
                    className="transition-all duration-200 pointer-events-auto"
                    style={{ cursor: 'pointer' }}
                    onMouseEnter={() => setHoveredNode(char.id)}
                    onMouseLeave={() => setHoveredNode(null)}
                  />

                  {/* Node label */}
                  <text
                    x={pos.x}
                    y={pos.y}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    className="font-mono text-[10px] font-semibold fill-current pointer-events-none select-none"
                    style={{ color: 'hsl(185 100% 80%)' }}
                  >
                    {char.name?.[0]?.toUpperCase() || '?'}
                  </text>

                  {/* Tooltip on hover */}
                  {isHovered && (
                    <g>
                      <rect
                        x={pos.x - 70}
                        y={pos.y - 75}
                        width="140"
                        height={charEmotion ? '65' : '50'}
                        rx="4"
                        fill="hsl(220 20% 6%)"
                        stroke="hsl(185 100% 50%)"
                        strokeWidth="1"
                        opacity="0.95"
                      />
                      <text
                        x={pos.x}
                        y={pos.y - 55}
                        textAnchor="middle"
                        className="font-mono text-[9px] font-semibold fill-current"
                        style={{ color: 'hsl(185 100% 80%)' }}
                      >
                        {char.name}
                      </text>
                      <text
                        x={pos.x}
                        y={pos.y - 38}
                        textAnchor="middle"
                        className="font-mono text-[8px] fill-current"
                        style={{ color: 'hsl(185 30% 50%)' }}
                      >
                        {char.category || 'character'}
                      </text>
                      {charEmotion && (
                        <text
                          x={pos.x}
                          y={pos.y - 18}
                          textAnchor="middle"
                          className="font-mono text-[8px] fill-current"
                          style={{ color: 'hsl(60 100% 60%)' }}
                        >
                          {charEmotion.emotion} ({charEmotion.intensity}/10)
                        </text>
                      )}
                    </g>
                  )}
                </g>
              );
            })}
          </svg>
        )}
      </div>

      {/* Connection Summary */}
      {relationships.length > 0 && (
        <div className="text-[8px] font-mono text-primary/50 p-2 border border-primary/10 bg-black/60 rounded max-h-32 overflow-y-auto">
          <p className="text-primary/40 tracking-widest uppercase mb-1.5">Top Relationships</p>
          <div className="space-y-1">
            {relationships
              .sort((a, b) => Math.abs(b.score || 0) - Math.abs(a.score || 0))
              .slice(0, 5)
              .map((rel) => {
                const char1 = characters.find(c => c.id === rel.character_a_id);
                const char2 = characters.find(c => c.id === rel.character_b_id);
                return (
                  <div key={`${rel.character_a_id}-${rel.character_b_id}`} className="flex items-center justify-between">
                    <span className="flex-1 truncate">
                      {char1?.name} ↔ {char2?.name}
                    </span>
                    <span
                      className="flex-shrink-0 ml-2 font-semibold"
                      style={{ color: getTierColor(rel.tier || 'neutral') }}
                    >
                      {getTierLabel(rel.tier || 'neutral')}
                    </span>
                  </div>
                );
              })}
          </div>
        </div>
      )}
    </motion.div>
  );
}