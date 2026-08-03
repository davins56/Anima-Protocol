import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";

export default function RelationshipNetworkGraph({ characters = [], relationships = [], sessionId }) {
  const canvasRef = useRef(null);
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [hoveredNode, setHoveredNode] = useState(null);
  const animationRef = useRef(null);
  const velocityRef = useRef({});

  // Initialize nodes and edges from characters and relationships
  useEffect(() => {
    if (!characters.length) return;

    // Create nodes from characters
    const newNodes = characters.map((char, idx) => ({
      id: char.id,
      name: char.name,
      x: Math.random() * 400 - 200,
      y: Math.random() * 400 - 200,
      vx: 0,
      vy: 0,
      avatar: char.avatar_url,
    }));

    // Create edges from relationships
    const newEdges = relationships
      .filter(rel => rel.score !== undefined)
      .map(rel => ({
        source: rel.character_id,
        target: sessionId, // or another character ID if available
        score: rel.score,
        tier: rel.tier,
      }));

    setNodes(newNodes);
    setEdges(newEdges);

    // Initialize velocities
    const vel = {};
    newNodes.forEach(n => {
      vel[n.id] = { vx: 0, vy: 0 };
    });
    velocityRef.current = vel;
  }, [characters, relationships, sessionId]);

  // Force-directed simulation
  useEffect(() => {
    if (!canvasRef.current || nodes.length === 0) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;

    // Physics constants
    const REPULSION = 100;
    const ATTRACTION = 0.3;
    const FRICTION = 0.85;
    const CENTER_FORCE = 0.05;

    const simulate = () => {
      // Reset forces
      const forces = {};
      nodes.forEach(node => {
        forces[node.id] = { fx: 0, fy: 0 };
      });

      // Repulsion between all nodes
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const n1 = nodes[i];
          const n2 = nodes[j];
          const dx = n2.x - n1.x;
          const dy = n2.y - n1.y;
          const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
          const force = REPULSION / (dist * dist);

          forces[n1.id].fx -= (force * dx) / dist;
          forces[n1.id].fy -= (force * dy) / dist;
          forces[n2.id].fx += (force * dx) / dist;
          forces[n2.id].fy += (force * dy) / dist;
        }
      }

      // Attraction for edges
      edges.forEach(edge => {
        const source = nodes.find(n => n.id === edge.source);
        const target = nodes.find(n => n.id === edge.target);
        if (!source || !target) return;

        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
        const force = (dist * ATTRACTION) / 100;

        forces[source.id].fx += (force * dx) / dist;
        forces[source.id].fy += (force * dy) / dist;
        forces[target.id].fx -= (force * dx) / dist;
        forces[target.id].fy -= (force * dy) / dist;
      });

      // Apply center force
      nodes.forEach(node => {
        forces[node.id].fx += -node.x * CENTER_FORCE;
        forces[node.id].fy += -node.y * CENTER_FORCE;
      });

      // Update velocities and positions
      setNodes(prevNodes =>
        prevNodes.map(node => {
          const vel = velocityRef.current[node.id] || { vx: 0, vy: 0 };
          const force = forces[node.id];

          vel.vx = (vel.vx + force.fx) * FRICTION;
          vel.vy = (vel.vy + force.fy) * FRICTION;

          return {
            ...node,
            x: node.x + vel.vx,
            y: node.y + vel.vy,
          };
        })
      );

      velocityRef.current = forces;
    };

    const render = () => {
      // Clear canvas
      ctx.fillStyle = "rgba(0, 0, 0, 0.1)";
      ctx.fillRect(0, 0, width, height);

      // Translate to center
      ctx.save();
      ctx.translate(width / 2, height / 2);

      // Draw edges
      edges.forEach(edge => {
        const source = nodes.find(n => n.id === edge.source);
        const target = nodes.find(n => n.id === edge.target);
        if (!source || !target) return;

        const alpha = Math.abs(edge.score) / 100;
        const color =
          edge.score > 0
            ? `rgba(34, 197, 94, ${alpha})`
            : `rgba(239, 68, 68, ${alpha})`;

        ctx.strokeStyle = color;
        ctx.lineWidth = Math.abs(edge.score) / 50;
        ctx.beginPath();
        ctx.moveTo(source.x, source.y);
        ctx.lineTo(target.x, target.y);
        ctx.stroke();
      });

      // Draw nodes
      nodes.forEach(node => {
        const isHovered = hoveredNode === node.id;
        const size = isHovered ? 20 : 12;
        const glow = isHovered ? 30 : 0;

        // Glow effect
        if (glow > 0) {
          ctx.shadowColor = "hsl(185 100% 50% / 0.5)";
          ctx.shadowBlur = glow;
        }

        ctx.fillStyle = "hsl(185 100% 50%)";
        ctx.beginPath();
        ctx.arc(node.x, node.y, size, 0, Math.PI * 2);
        ctx.fill();

        ctx.shadowBlur = 0;

        // Node label
        if (isHovered) {
          ctx.fillStyle = "hsl(185 100% 50%)";
          ctx.font = "10px 'Share Tech Mono'";
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          ctx.fillText(node.name, node.x, node.y + size + 5);
        }
      });

      ctx.restore();
    };

    const loop = () => {
      simulate();
      render();
      animationRef.current = requestAnimationFrame(loop);
    };

    loop();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [nodes, edges, hoveredNode]);

  // Handle mouse move for hover detection
  const handleMouseMove = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left - canvas.width / 2;
    const y = e.clientY - rect.top - canvas.height / 2;

    let found = null;
    for (const node of nodes) {
      const dist = Math.sqrt((node.x - x) ** 2 + (node.y - y) ** 2);
      if (dist < 20) {
        found = node.id;
        break;
      }
    }

    setHoveredNode(found);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="w-full h-full flex flex-col bg-black/40 border border-primary/20"
    >
      <canvas
        ref={canvasRef}
        width={1000}
        height={600}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoveredNode(null)}
        className="flex-1 cursor-pointer bg-gradient-to-b from-black/60 to-primary/5"
        style={{ touchAction: "none" }}
      />
      {hoveredNode && (
        <div className="px-4 py-2 border-t border-primary/20 bg-black/60 font-mono text-[10px] text-primary/70">
          <span className="text-primary/40">Selected:</span>{" "}
          {nodes.find(n => n.id === hoveredNode)?.name}
        </div>
      )}
    </motion.div>
  );
}