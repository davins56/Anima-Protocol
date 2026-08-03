import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Maximize2, ZoomIn, ZoomOut } from 'lucide-react';

export default function MemoryGraphVisualizer({ graph, onNodeClick, selectedNodeId }) {
  const svgRef = useRef(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  useEffect(() => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    setDimensions({ width: rect.width, height: rect.height });
  }, []);

  const nodeColors = {
    event: '#06b6d4',
    trait: '#a78bfa',
    milestone: '#fbbf24',
    relationship: '#ec4899',
  };

  const handleZoom = (direction) => {
    setZoom(prev => direction === 'in' ? Math.min(prev + 0.2, 2) : Math.max(prev - 0.2, 0.5));
  };

  const handleFitView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  if (!graph?.nodes || graph.nodes.length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center border border-primary/20 bg-black/40 rounded">
        <p className="font-mono text-[9px] text-primary/30 tracking-widest uppercase">No memory nodes yet</p>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full border border-primary/20 bg-black/60 rounded overflow-hidden">
      {/* Controls */}
      <div className="absolute top-3 right-3 z-10 flex gap-2">
        <button
          onClick={() => handleZoom('in')}
          className="p-2 bg-primary/10 border border-primary/20 text-primary/60 hover:text-primary transition-colors"
          title="Zoom in"
        >
          <ZoomIn className="w-4 h-4" />
        </button>
        <button
          onClick={() => handleZoom('out')}
          className="p-2 bg-primary/10 border border-primary/20 text-primary/60 hover:text-primary transition-colors"
          title="Zoom out"
        >
          <ZoomOut className="w-4 h-4" />
        </button>
        <button
          onClick={handleFitView}
          className="p-2 bg-primary/10 border border-primary/20 text-primary/60 hover:text-primary transition-colors"
          title="Fit to view"
        >
          <Maximize2 className="w-4 h-4" />
        </button>
      </div>

      {/* SVG Canvas */}
      <svg
        ref={svgRef}
        className="w-full h-full cursor-grab active:cursor-grabbing"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: '0 0',
          transition: 'transform 0.2s',
        }}
      >
        {/* Edges */}
        {graph.edges?.map(edge => {
          const fromNode = graph.nodes.find(n => n.id === edge.from);
          const toNode = graph.nodes.find(n => n.id === edge.to);
          if (!fromNode || !toNode) return null;

          return (
            <line
              key={edge.id}
              x1={fromNode.x + 100}
              y1={fromNode.y + 100}
              x2={toNode.x + 100}
              y2={toNode.y + 100}
              stroke="rgba(139, 92, 246, 0.3)"
              strokeWidth="2"
              markerEnd="url(#arrowhead)"
            />
          );
        })}

        {/* Arrow marker */}
        <defs>
          <marker id="arrowhead" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
            <polygon points="0 0, 10 3, 0 6" fill="rgba(139, 92, 246, 0.5)" />
          </marker>
        </defs>

        {/* Nodes */}
        {graph.nodes?.map(node => (
          <g key={node.id}>
            {/* Node circle */}
            <circle
              cx={node.x + 100}
              cy={node.y + 100}
              r={node.pinned ? 28 : 24}
              fill="hsl(220 20% 10%)"
              stroke={nodeColors[node.type] || '#8b5cf6'}
              strokeWidth={node.id === selectedNodeId ? 3 : node.pinned ? 2.5 : 2}
              className="cursor-pointer transition-all hover:r-30"
              onClick={() => onNodeClick?.(node)}
              style={{
                filter: node.id === selectedNodeId ? `drop-shadow(0 0 15px ${nodeColors[node.type]})` : 'none',
              }}
            />

            {/* Pinned indicator */}
            {node.pinned && (
              <g>
                <circle
                  cx={node.x + 100}
                  cy={node.y + 100}
                  r={32}
                  fill="none"
                  stroke={nodeColors[node.type]}
                  strokeWidth="1"
                  strokeDasharray="4"
                  opacity="0.6"
                />
                <text
                  x={node.x + 100}
                  y={node.y + 65}
                  textAnchor="middle"
                  className="font-mono text-[8px] fill-current"
                  style={{ color: nodeColors[node.type] }}
                >
                  📌
                </text>
              </g>
            )}

            {/* Node label */}
            <text
              x={node.x + 100}
              y={node.y + 105}
              textAnchor="middle"
              dominantBaseline="middle"
              className="font-mono text-[8px] fill-current pointer-events-none select-none"
              style={{ color: nodeColors[node.type] }}
            >
              {node.label[0]}
            </text>

            {/* Type badge */}
            <text
              x={node.x + 100}
              y={node.y + 135}
              textAnchor="middle"
              className="font-mono text-[7px] fill-current opacity-60"
              style={{ color: nodeColors[node.type] }}
            >
              {node.type}
            </text>
          </g>
        ))}
      </svg>

      {/* Legend */}
      <div className="absolute bottom-3 left-3 space-y-1.5 bg-black/80 border border-primary/15 rounded p-3">
        <p className="text-[8px] font-mono text-primary/40 tracking-widest uppercase mb-2">Legend</p>
        {Object.entries(nodeColors).map(([type, color]) => (
          <div key={type} className="flex items-center gap-2 text-[8px] font-mono">
            <div
              className="w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: color }}
            />
            <span className="text-primary/60 capitalize">{type}</span>
          </div>
        ))}
      </div>
    </div>
  );
}