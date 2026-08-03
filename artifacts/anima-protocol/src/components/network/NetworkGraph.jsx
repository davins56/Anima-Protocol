import { useEffect, useRef, useState } from "react";

export default function NetworkGraph({ nodes, edges, selectedCharId, onSelectChar }) {
  const canvasRef = useRef(null);
  const [positions, setPositions] = useState({});
  const [hoveredId, setHoveredId] = useState(null);

  // Force-directed graph layout simulation
  useEffect(() => {
    if (nodes.length === 0) return;

    // Initialize positions if not already done
    if (Object.keys(positions).length === 0) {
      const initialPos = {};
      nodes.forEach((node, i) => {
        const angle = (i / nodes.length) * Math.PI * 2;
        const radius = 150;
        initialPos[node.id] = {
          x: Math.cos(angle) * radius + 250,
          y: Math.sin(angle) * radius + 250,
          vx: 0,
          vy: 0,
        };
      });
      setPositions(initialPos);
      return;
    }

    // Run force simulation
    const simulate = () => {
      const newPos = { ...positions };
      const k = 0.05; // repulsion
      const d = 150; // desired distance
      const friction = 0.95;

      nodes.forEach((node) => {
        let fx = 0;
        let fy = 0;

        // Repulsion from other nodes
        nodes.forEach((other) => {
          if (node.id === other.id) return;
          const dx = newPos[other.id].x - newPos[node.id].x;
          const dy = newPos[other.id].y - newPos[node.id].y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const force = -k / (dist * dist);
          fx += (force * dx) / dist;
          fy += (force * dy) / dist;
        });

        // Attraction to connected nodes
        edges.forEach((edge) => {
          if (edge.from === node.id) {
            const target = newPos[edge.to];
            const dx = target.x - newPos[node.id].x;
            const dy = target.y - newPos[node.id].y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            const force = (dist - d) * 0.01 * edge.weight;
            fx += (force * dx) / dist;
            fy += (force * dy) / dist;
          } else if (edge.to === node.id) {
            const target = newPos[edge.from];
            const dx = target.x - newPos[node.id].x;
            const dy = target.y - newPos[node.id].y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            const force = (dist - d) * 0.01 * edge.weight;
            fx += (force * dx) / dist;
            fy += (force * dy) / dist;
          }
        });

        // Apply velocity
        newPos[node.id].vx = (newPos[node.id].vx + fx) * friction;
        newPos[node.id].vy = (newPos[node.id].vy + fy) * friction;
        newPos[node.id].x += newPos[node.id].vx;
        newPos[node.id].y += newPos[node.id].vy;
      });

      setPositions(newPos);
    };

    const interval = setInterval(simulate, 50);
    return () => clearInterval(interval);
  }, [nodes, edges, positions]);

  // Canvas rendering
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || Object.keys(positions).length === 0) return;

    const ctx = canvas.getContext("2d");
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;

    // Clear
    ctx.fillStyle = "hsl(220 20% 4%)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw edges
    ctx.strokeStyle = "hsl(185 50% 20%)";
    ctx.lineWidth = 1;
    edges.forEach((edge) => {
      const from = positions[edge.from];
      const to = positions[edge.to];
      if (!from || !to) return;

      ctx.globalAlpha = 0.3 + edge.weight * 0.1;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
    });
    ctx.globalAlpha = 1;

    // Draw nodes
    nodes.forEach((node) => {
      const pos = positions[node.id];
      if (!pos) return;

      const size = node.nodeSize || 30;
      const isSelected = selectedCharId === node.id;
      const hasConnection = edges.some(
        (e) => (e.from === node.id && e.to === selectedCharId) ||
               (e.to === node.id && e.from === selectedCharId)
      );

      // Node circle
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, size / 2, 0, Math.PI * 2);
      
      if (isSelected) {
        ctx.fillStyle = "hsl(185 100% 50%)";
        ctx.lineWidth = 2;
        ctx.strokeStyle = "hsl(185 100% 70%)";
      } else if (selectedCharId && hasConnection) {
        ctx.fillStyle = "hsl(185 100% 50% / 0.4)";
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = "hsl(185 100% 50% / 0.7)";
      } else {
        ctx.fillStyle = "hsl(185 50% 20%)";
        ctx.lineWidth = 1;
        ctx.strokeStyle = "hsl(185 100% 50% / 0.4)";
      }
      
      ctx.fill();
      ctx.stroke();

      // Label
      ctx.fillStyle = isSelected || (selectedCharId && hasConnection) ? "hsl(185 100% 80%)" : "hsl(185 100% 50%)";
      ctx.font = "bold 10px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(node.label.slice(0, 8), pos.x, pos.y);
    });
  }, [positions, nodes, edges, selectedCharId]);

  const handleCanvasClick = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    nodes.forEach((node) => {
      const pos = positions[node.id];
      if (!pos) return;
      const size = node.nodeSize || 30;
      const dist = Math.sqrt((x - pos.x) ** 2 + (y - pos.y) ** 2);
      if (dist < size / 2 + 10) {
        onSelectChar(selectedCharId === node.id ? null : node.id);
      }
    });
  };

  const handleCanvasMouseMove = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    let found = null;
    nodes.forEach((node) => {
      const pos = positions[node.id];
      if (!pos) return;
      const size = node.nodeSize || 30;
      const dist = Math.sqrt((x - pos.x) ** 2 + (y - pos.y) ** 2);
      if (dist < size / 2 + 10) {
        found = node.id;
      }
    });
    setHoveredId(found);
    canvas.style.cursor = found ? "pointer" : "default";
  };

  return (
    <canvas
      ref={canvasRef}
      onClick={handleCanvasClick}
      onMouseMove={handleCanvasMouseMove}
      onMouseLeave={() => setHoveredId(null)}
      className="w-full h-full block"
    />
  );
}