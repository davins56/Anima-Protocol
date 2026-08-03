import { useEffect, useRef, useCallback } from "react";

const TIER_COLORS = {
  hostile: "#f87171",
  cold: "#93c5fd",
  neutral: "#67e8f9",
  warm: "#fde047",
  close: "#86efac",
  devoted: "#f9a8d4",
};

export default function RelationshipGraph({ nodes, edges, selectedCharId, onSelectChar, onSelectEdge }) {
  const canvasRef = useRef(null);
  const stateRef = useRef({
    positions: {},
    velocities: {},
    animFrame: null,
    simInterval: null,
    hoveredNodeId: null,
    hoveredEdge: null,
  });

  // Initialize positions
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || nodes.length === 0) return;

    const W = canvas.offsetWidth;
    const H = canvas.offsetHeight;
    const cx = W / 2;
    const cy = H / 2;
    const r = Math.min(W, H) * 0.3;

    nodes.forEach((node, i) => {
      if (!stateRef.current.positions[node.id]) {
        const angle = (i / nodes.length) * Math.PI * 2;
        stateRef.current.positions[node.id] = {
          x: cx + Math.cos(angle) * r + (Math.random() - 0.5) * 40,
          y: cy + Math.sin(angle) * r + (Math.random() - 0.5) * 40,
        };
        stateRef.current.velocities[node.id] = { x: 0, y: 0 };
      }
    });

    startSimulation(canvas, nodes, edges, selectedCharId);
    return () => {
      clearInterval(stateRef.current.simInterval);
      cancelAnimationFrame(stateRef.current.animFrame);
    };
  }, [nodes.length]);

  // Re-render when selection changes without restarting simulation
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawFrame(canvas, nodes, edges, selectedCharId, stateRef.current.hoveredNodeId, stateRef.current.hoveredEdge);
  }, [selectedCharId]);

  const startSimulation = (canvas, nodes, edges, selectedCharId) => {
    clearInterval(stateRef.current.simInterval);
    cancelAnimationFrame(stateRef.current.animFrame);

    stateRef.current.simInterval = setInterval(() => {
      tickPhysics(canvas, nodes, edges);
      drawFrame(canvas, nodes, edges, selectedCharId, stateRef.current.hoveredNodeId, stateRef.current.hoveredEdge);
    }, 30);
  };

  const tickPhysics = (canvas, nodes, edges) => {
    const W = canvas.offsetWidth;
    const H = canvas.offsetHeight;
    const pos = stateRef.current.positions;
    const vel = stateRef.current.velocities;
    const REPEL = 3500;
    const ATTRACT = 0.012;
    const CENTER = 0.004;
    const DAMPING = 0.82;

    nodes.forEach((a) => {
      let fx = 0, fy = 0;

      // Repulsion between nodes
      nodes.forEach((b) => {
        if (a.id === b.id) return;
        const dx = pos[a.id].x - pos[b.id].x;
        const dy = pos[a.id].y - pos[b.id].y;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
        const force = REPEL / (dist * dist);
        fx += (dx / dist) * force;
        fy += (dy / dist) * force;
      });

      // Attraction along edges
      edges.forEach((edge) => {
        const other = edge.from === a.id ? pos[edge.to] : edge.to === a.id ? pos[edge.from] : null;
        if (!other) return;
        const dx = other.x - pos[a.id].x;
        const dy = other.y - pos[a.id].y;
        const strength = ATTRACT * Math.min(edge.weight, 8);
        fx += dx * strength;
        fy += dy * strength;
      });

      // Center gravity
      fx += (W / 2 - pos[a.id].x) * CENTER;
      fy += (H / 2 - pos[a.id].y) * CENTER;

      vel[a.id].x = (vel[a.id].x + fx) * DAMPING;
      vel[a.id].y = (vel[a.id].y + fy) * DAMPING;
      pos[a.id].x = Math.max(60, Math.min(W - 60, pos[a.id].x + vel[a.id].x));
      pos[a.id].y = Math.max(60, Math.min(H - 60, pos[a.id].y + vel[a.id].y));
    });
  };

  const drawFrame = (canvas, nodes, edges, selectedCharId, hoveredNodeId, hoveredEdge) => {
    const ctx = canvas.getContext("2d");
    const W = canvas.offsetWidth;
    const H = canvas.offsetHeight;
    canvas.width = W;
    canvas.height = H;

    ctx.clearRect(0, 0, W, H);

    const pos = stateRef.current.positions;

    // Draw edges
    edges.forEach((edge) => {
      const a = pos[edge.from];
      const b = pos[edge.to];
      if (!a || !b) return;

      const isHovered = hoveredEdge?.id === edge.id;
      const isConnected = selectedCharId && (edge.from === selectedCharId || edge.to === selectedCharId);

      const thickness = Math.min(1 + edge.weight * 0.5, 5);
      const alpha = isHovered ? 0.9 : isConnected ? 0.6 : 0.15;

      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = `rgba(0, 255, 255, ${alpha})`;
      ctx.lineWidth = isHovered ? thickness + 1.5 : thickness;
      ctx.setLineDash(edge.sessions.length === 0 ? [4, 4] : []);
      ctx.stroke();
      ctx.setLineDash([]);

      // Edge label on hover
      if (isHovered) {
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        ctx.font = "9px 'Share Tech Mono', monospace";
        ctx.fillStyle = "rgba(0,255,255,0.7)";
        ctx.textAlign = "center";
        ctx.fillText(
          `${edge.sessions.length} sessions · ${edge.loreLinks.length} lore`,
          mx, my - 6
        );
      }
    });

    // Draw nodes
    nodes.forEach((node) => {
      const p = pos[node.id];
      if (!p) return;

      const isSelected = node.id === selectedCharId;
      const isHovered = node.id === hoveredNodeId;
      const size = node.nodeSize || 28;
      const tierColor = TIER_COLORS[node.tier] || TIER_COLORS.neutral;

      // Glow for selected
      if (isSelected || isHovered) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, size + 8, 0, Math.PI * 2);
        const grd = ctx.createRadialGradient(p.x, p.y, size, p.x, p.y, size + 10);
        grd.addColorStop(0, isSelected ? `${tierColor}44` : "rgba(0,255,255,0.15)");
        grd.addColorStop(1, "transparent");
        ctx.fillStyle = grd;
        ctx.fill();
      }

      // Node circle background
      ctx.beginPath();
      ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
      ctx.fillStyle = isSelected ? `${tierColor}22` : "rgba(0,10,20,0.85)";
      ctx.fill();

      // Node border
      ctx.beginPath();
      ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
      ctx.strokeStyle = isSelected ? tierColor : isHovered ? "rgba(0,255,255,0.6)" : `${tierColor}55`;
      ctx.lineWidth = isSelected ? 2.5 : 1.5;
      ctx.stroke();

      // Avatar or initial
      if (node.avatar) {
        const img = new Image();
        img.src = node.avatar;
        ctx.save();
        ctx.beginPath();
        ctx.arc(p.x, p.y, size - 3, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(img, p.x - (size - 3), p.y - (size - 3), (size - 3) * 2, (size - 3) * 2);
        ctx.restore();
      } else {
        ctx.font = `bold ${Math.max(12, size * 0.5)}px 'Share Tech Mono', monospace`;
        ctx.fillStyle = isSelected ? tierColor : "rgba(0,255,255,0.6)";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(node.label[0].toUpperCase(), p.x, p.y);
      }

      // Anima sparkle
      if (node.isAnima) {
        ctx.font = "10px sans-serif";
        ctx.fillStyle = "#f9a8d4";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("✦", p.x + size - 4, p.y - size + 4);
      }

      // Label below
      ctx.font = `10px 'Share Tech Mono', monospace`;
      ctx.fillStyle = isSelected ? tierColor : "rgba(0,255,255,0.55)";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      // background for readability
      const labelW = ctx.measureText(node.label).width + 8;
      ctx.fillStyle = "rgba(0,5,15,0.75)";
      ctx.fillRect(p.x - labelW / 2, p.y + size + 3, labelW, 13);
      ctx.fillStyle = isSelected ? tierColor : "rgba(0,255,255,0.55)";
      ctx.fillText(node.label, p.x, p.y + size + 5);
    });
  };

  const getNodeAtPoint = useCallback((x, y) => {
    const pos = stateRef.current.positions;
    return Object.entries(pos).find(([id, p]) => {
      const node = nodes.find((n) => n.id === id);
      const size = node?.nodeSize || 28;
      const dx = p.x - x;
      const dy = p.y - y;
      return Math.sqrt(dx * dx + dy * dy) <= size;
    })?.[0] || null;
  }, [nodes]);

  const getEdgeAtPoint = useCallback((x, y) => {
    const pos = stateRef.current.positions;
    return edges.find((edge) => {
      const a = pos[edge.from];
      const b = pos[edge.to];
      if (!a || !b) return false;
      // Point-to-line distance
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len === 0) return false;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (len * len)));
      const nearX = a.x + t * dx;
      const nearY = a.y + t * dy;
      const dist = Math.sqrt((x - nearX) ** 2 + (y - nearY) ** 2);
      return dist <= 8;
    }) || null;
  }, [edges]);

  const handleClick = useCallback((e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const nodeId = getNodeAtPoint(x, y);
    if (nodeId) { onSelectChar(nodeId); return; }

    const edge = getEdgeAtPoint(x, y);
    if (edge) { onSelectEdge(edge.from, edge.to); }
  }, [getNodeAtPoint, getEdgeAtPoint, onSelectChar, onSelectEdge]);

  const handleMouseMove = useCallback((e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const nodeId = getNodeAtPoint(x, y);
    const edge = nodeId ? null : getEdgeAtPoint(x, y);
    stateRef.current.hoveredNodeId = nodeId;
    stateRef.current.hoveredEdge = edge;
    canvasRef.current.style.cursor = (nodeId || edge) ? "pointer" : "default";
  }, [getNodeAtPoint, getEdgeAtPoint]);

  const handleResize = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawFrame(canvas, nodes, edges, selectedCharId, stateRef.current.hoveredNodeId, stateRef.current.hoveredEdge);
  }, [nodes, edges, selectedCharId]);

  useEffect(() => {
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [handleResize]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full"
      onClick={handleClick}
      onMouseMove={handleMouseMove}
    />
  );
}