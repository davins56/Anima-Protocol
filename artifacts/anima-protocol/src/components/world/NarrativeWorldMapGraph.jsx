import { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, Zap, Lock, GitBranch, X } from "lucide-react";

export default function NarrativeWorldMapGraph({ sessionId, onSelectBranch }) {
  const canvasRef = useRef(null);
  const [snapshots, setSnapshots] = useState([]);
  const [selectedNode, setSelectedNode] = useState(null);
  const [nodes, setNodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hoveredNode, setHoveredNode] = useState(null);
  const nodesRef = useRef(nodes);
  const velocityRef = useRef({});

  useEffect(() => {
    loadSnapshots();
  }, [sessionId]);

  const loadSnapshots = async () => {
    setLoading(true);
    try {
      const data = await base44.entities.WorldSnapshot.filter(
        { session_id: sessionId },
        "-created_date",
        100
      );
      setSnapshots(data || []);
      initializeNodes(data || []);
    } catch (err) {
      console.error("Error loading snapshots:", err);
    } finally {
      setLoading(false);
    }
  };

  const initializeNodes = (data) => {
    const newNodes = data.map((snapshot, idx) => {
      // Position nodes in a circle initially, will be moved by physics
      const angle = (idx / Math.max(data.length, 1)) * Math.PI * 2;
      const radius = 150;
      return {
        id: snapshot.id,
        snapshot,
        x: 300 + Math.cos(angle) * radius,
        y: 250 + Math.sin(angle) * radius,
        vx: 0,
        vy: 0,
        radius: snapshot.is_active ? 25 : 20,
      };
    });
    setNodes(newNodes);
    nodesRef.current = newNodes;
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || nodes.length === 0) return;

    const ctx = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;
    let animationId;

    const drawGraph = () => {
      // Clear canvas
      ctx.fillStyle = "hsl(220 20% 4%)";
      ctx.fillRect(0, 0, width, height);

      // Draw grid
      ctx.strokeStyle = "hsl(185 50% 15%)";
      ctx.lineWidth = 0.5;
      ctx.globalAlpha = 0.1;
      for (let i = 0; i <= width; i += 50) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, height);
        ctx.stroke();
      }
      for (let i = 0; i <= height; i += 50) {
        ctx.beginPath();
        ctx.moveTo(0, i);
        ctx.lineTo(width, i);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // Apply physics simulation
      const damping = 0.98;
      const springForce = 0.001;
      const repulseForce = 50000;
      const gravity = 0.2;

      // Calculate forces
      nodesRef.current.forEach((node, i) => {
        let fx = 0;
        let fy = 0;

        // Repulsion from other nodes
        nodesRef.current.forEach((other, j) => {
          if (i !== j) {
            const dx = node.x - other.x;
            const dy = node.y - other.y;
            const dist = Math.sqrt(dx * dx + dy * dy) + 1;
            const force = repulseForce / (dist * dist);
            fx += (dx / dist) * force;
            fy += (dy / dist) * force;
          }
        });

        // Attraction to center
        const centerX = width / 2;
        const centerY = height / 2;
        const dx = centerX - node.x;
        const dy = centerY - node.y;
        fx += dx * springForce;
        fy += dy * springForce;

        // Apply velocity and damping
        node.vx = (node.vx + fx) * damping;
        node.vy = (node.vy + fy) * damping;

        // Update position
        node.x += node.vx;
        node.y += node.vy;

        // Bounce off edges
        if (node.x - node.radius < 0) {
          node.x = node.radius;
          node.vx *= -0.5;
        }
        if (node.x + node.radius > width) {
          node.x = width - node.radius;
          node.vx *= -0.5;
        }
        if (node.y - node.radius < 0) {
          node.y = node.radius;
          node.vy *= -0.5;
        }
        if (node.y + node.radius > height) {
          node.y = height - node.radius;
          node.vy *= -0.5;
        }
      });

      // Draw parent-child connections
      ctx.strokeStyle = "hsl(185 50% 30%)";
      ctx.lineWidth = 1.5;
      nodesRef.current.forEach((node) => {
        if (node.snapshot.parent_snapshot_id) {
          const parent = nodesRef.current.find(
            (n) => n.id === node.snapshot.parent_snapshot_id
          );
          if (parent) {
            ctx.beginPath();
            ctx.moveTo(node.x, node.y);
            ctx.lineTo(parent.x, parent.y);
            ctx.stroke();
          }
        }
      });

      // Draw nodes
      nodesRef.current.forEach((node) => {
        const isHovered = hoveredNode?.id === node.id;
        const isSelected = selectedNode?.id === node.id;

        // Node glow
        ctx.fillStyle = isSelected ? "hsl(185 100% 50% / 0.3)" : "hsl(185 50% 30% / 0.1)";
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius + (isHovered ? 8 : 4), 0, Math.PI * 2);
        ctx.fill();

        // Node circle
        ctx.fillStyle = node.snapshot.is_active
          ? "hsl(185 100% 50%)"
          : "hsl(185 50% 40%)";
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
        ctx.fill();

        // Border
        ctx.strokeStyle = isSelected ? "hsl(185 100% 80%)" : "hsl(185 100% 60%)";
        ctx.lineWidth = isSelected ? 3 : 2;
        ctx.stroke();

        // Label
        if (isHovered || isSelected) {
          ctx.fillStyle = "hsl(185 100% 100%)";
          ctx.font = "bold 12px monospace";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(node.snapshot.branch_name.slice(0, 8), node.x, node.y);
        }
      });

      animationId = requestAnimationFrame(drawGraph);
    };

    drawGraph();

    return () => cancelAnimationFrame(animationId);
  }, [nodes, selectedNode, hoveredNode]);

  const handleCanvasClick = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    nodesRef.current.forEach((node) => {
      const dist = Math.sqrt((x - node.x) ** 2 + (y - node.y) ** 2);
      if (dist < node.radius + 5) {
        setSelectedNode(node);
      }
    });
  };

  const handleCanvasMouseMove = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    let hovered = null;
    nodesRef.current.forEach((node) => {
      const dist = Math.sqrt((x - node.x) ** 2 + (y - node.y) ** 2);
      if (dist < node.radius + 5) {
        hovered = node;
      }
    });
    setHoveredNode(hovered);
    canvas.style.cursor = hovered ? "pointer" : "default";
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-primary/20 border-t-primary rounded-full animate-spin mx-auto mb-2" />
          <p className="font-mono text-[9px] text-primary/30 tracking-widest uppercase">
            Rendering timeline graph...
          </p>
        </div>
      </div>
    );
  }

  if (nodes.length === 0) {
    return (
      <div className="flex items-center justify-center h-96 p-4">
        <p className="font-mono text-[9px] text-primary/20 tracking-widest uppercase text-center">
          No timeline branches discovered yet
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Canvas */}
      <div className="border border-primary/20 bg-black/40 rounded overflow-hidden">
        <canvas
          ref={canvasRef}
          width={800}
          height={500}
          onClick={handleCanvasClick}
          onMouseMove={handleCanvasMouseMove}
          className="w-full bg-black/20 cursor-default"
        />
      </div>

      {/* Legend */}
      <div className="grid grid-cols-2 gap-2 text-[8px] font-mono">
        <div className="flex items-center gap-2 px-3 py-2 border border-primary/15 bg-black/30 rounded">
          <div className="w-4 h-4 rounded-full bg-cyan-400 border border-cyan-500" />
          <span className="text-primary/60">Active Timeline</span>
        </div>
        <div className="flex items-center gap-2 px-3 py-2 border border-primary/15 bg-black/30 rounded">
          <div className="w-4 h-4 rounded-full bg-cyan-700 border border-cyan-600" />
          <span className="text-primary/60">Alternative Branch</span>
        </div>
      </div>

      {/* Selected Node Details */}
      <AnimatePresence>
        {selectedNode && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="p-4 border border-primary/20 bg-black/40 rounded space-y-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-mono text-sm text-primary tracking-wider uppercase">
                  {selectedNode.snapshot.branch_name}
                </h3>
                <p className="text-[9px] font-mono text-primary/50 mt-1">
                  {selectedNode.snapshot.decision_point}
                </p>
              </div>
              <button
                onClick={() => setSelectedNode(null)}
                className="text-primary/30 hover:text-primary transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {selectedNode.snapshot.outcome_summary && (
              <div>
                <p className="text-[8px] font-mono text-primary/40 tracking-widest uppercase mb-1">
                  Outcome
                </p>
                <p className="text-[9px] font-mono text-primary/70">
                  {selectedNode.snapshot.outcome_summary}
                </p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2 text-[8px]">
              {selectedNode.snapshot.political_outcome && (
                <div className="p-2 bg-primary/5 border border-primary/15 rounded">
                  <p className="font-mono text-primary/40 tracking-widest uppercase mb-0.5">
                    Political Impact
                  </p>
                  <p className="text-primary/70 line-clamp-2">
                    {selectedNode.snapshot.political_outcome}
                  </p>
                </div>
              )}

              {selectedNode.snapshot.environmental_outcome && (
                <div className="p-2 bg-primary/5 border border-primary/15 rounded">
                  <p className="font-mono text-primary/40 tracking-widest uppercase mb-0.5">
                    Environmental Impact
                  </p>
                  <p className="text-primary/70 line-clamp-2">
                    {selectedNode.snapshot.environmental_outcome}
                  </p>
                </div>
              )}
            </div>

            {selectedNode.snapshot.key_events?.length > 0 && (
              <div>
                <p className="text-[8px] font-mono text-primary/40 tracking-widest uppercase mb-1">
                  Key Events
                </p>
                <div className="space-y-0.5">
                  {selectedNode.snapshot.key_events.slice(0, 3).map((event, idx) => (
                    <div key={idx} className="text-[8px] text-primary/70 flex gap-1">
                      <span className="flex-shrink-0">•</span>
                      <span className="line-clamp-1">{event}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <button
              onClick={() => onSelectBranch(selectedNode.snapshot)}
              disabled={selectedNode.snapshot.is_active}
              className="w-full py-2 border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-30 disabled:cursor-not-allowed font-mono text-[9px] tracking-widest uppercase transition-all"
            >
              {selectedNode.snapshot.is_active ? "Currently Active" : "Jump to Timeline"}
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Stats */}
      <div className="p-3 border border-primary/10 bg-black/30 rounded text-[8px] font-mono text-primary/50 space-y-1">
        <div className="flex justify-between">
          <span>Total Timelines:</span>
          <span className="text-primary/70">{snapshots.length}</span>
        </div>
        <div className="flex justify-between">
          <span>Active Branch:</span>
          <span className="text-primary/70">
            {snapshots.find((s) => s.is_active)?.branch_name || "None"}
          </span>
        </div>
      </div>
    </div>
  );
}