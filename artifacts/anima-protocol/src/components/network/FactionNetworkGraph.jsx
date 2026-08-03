import { useEffect, useState, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { Loader, X, Info, Search, Download } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import CharacterNodeModal from "./CharacterNodeModal";
import html2canvas from "html2canvas";

const factionColors = {
  default: "#60A5FA",
  rebel: "#EF4444",
  royal: "#8B5CF6",
  merchant: "#F59E0B",
  mystical: "#10B981",
  neutral: "#6B7280",
};

export default function FactionNetworkGraph({ sessionId }) {
  const canvasRef = useRef(null);
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedCharacter, setSelectedCharacter] = useState(null);
  const [hoveredNode, setHoveredNode] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedFaction, setSelectedFaction] = useState("all");
  const [factions, setFactions] = useState([]);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const simulationRef = useRef(null);
  const velocitiesRef = useRef({});

  useEffect(() => {
    if (sessionId) {
      loadNetworkData();
    }
  }, [sessionId]);

  const loadNetworkData = async () => {
    setLoading(true);
    try {
      const [characters, relationships, factionData, worldState] = await Promise.all([
        base44.entities.Character.list("-created_date", 100),
        base44.entities.CharacterRelationship.filter(
          { session_id: sessionId },
          "-created_date",
          200
        ),
        base44.entities.Faction.list("-created_date", 100),
        base44.entities.WorldState.filter(
          { session_id: sessionId, is_active: true },
          "-created_date",
          100
        ),
      ]);

      setFactions(factionData || []);

      // Create nodes from characters
      const nodeMap = {};
      const newNodes = (characters || []).map((char) => {
        const faction = (factionData || []).find((f) =>
          f.member_characters?.includes(char.id)
        );
        const color = factionColors[faction?.name?.toLowerCase()] || factionColors.default;

        const node = {
          id: char.id,
          name: char.name,
          avatar: char.avatar_url,
          faction: faction?.name || "Unaffiliated",
          factionId: faction?.id,
          x: Math.random() * 800,
          y: Math.random() * 600,
          vx: 0,
          vy: 0,
          color,
          character: char,
        };
        nodeMap[char.id] = node;
        return node;
      });

      // Create edges from relationships
      const newEdges = (relationships || [])
        .filter((rel) => rel.score !== 0 && nodeMap[rel.character_id])
        .map((rel) => ({
          source: rel.character_id,
          target: sessionId,
          score: rel.score,
          tier: rel.tier,
          strength: Math.abs(rel.score) / 100,
        }))
        .slice(0, 100);

      setNodes(newNodes);
      setEdges(newEdges);
      velocitiesRef.current = {};
      newNodes.forEach((node) => {
        velocitiesRef.current[node.id] = { vx: 0, vy: 0 };
      });
    } catch (err) {
      console.error("Error loading network data:", err);
    } finally {
      setLoading(false);
    }
  };

  // Force simulation loop
  useEffect(() => {
    if (nodes.length === 0) return;

    const animate = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const ctx = canvas.getContext("2d");
      const width = canvas.width;
      const height = canvas.height;

      // Apply forces
      const k = 100;
      const alpha = 0.1;
      const friction = 0.95;

      // Repulsion and attraction
      nodes.forEach((node, i) => {
        let fx = 0,
          fy = 0;

        nodes.forEach((other, j) => {
          if (i === j) return;
          const dx = node.x - other.x;
          const dy = node.y - other.y;
          const dist = Math.sqrt(dx * dx + dy * dy) + 1;
          const force = k / (dist * dist);
          fx += (dx / dist) * force;
          fy += (dy / dist) * force;
        });

        edges.forEach((edge) => {
          if (edge.source === node.id) {
            const target = nodes.find((n) => n.id === edge.target);
            if (target) {
              const dx = target.x - node.x;
              const dy = target.y - node.y;
              const dist = Math.sqrt(dx * dx + dy * dy);
              fx += (dx / dist) * alpha * edge.strength;
              fy += (dy / dist) * alpha * edge.strength;
            }
          } else if (edge.target === node.id) {
            const target = nodes.find((n) => n.id === edge.source);
            if (target) {
              const dx = target.x - node.x;
              const dy = target.y - node.y;
              const dist = Math.sqrt(dx * dx + dy * dy);
              fx += (dx / dist) * alpha * edge.strength;
              fy += (dy / dist) * alpha * edge.strength;
            }
          }
        });

        fx += (width / 2 - node.x) * 0.01;
        fy += (height / 2 - node.y) * 0.01;

        const vel = velocitiesRef.current[node.id] || { vx: 0, vy: 0 };
        vel.vx = (vel.vx + fx) * friction;
        vel.vy = (vel.vy + fy) * friction;
        node.x += vel.vx;
        node.y += vel.vy;

        node.x = Math.max(20, Math.min(width - 20, node.x));
        node.y = Math.max(20, Math.min(height - 20, node.y));
      });

      // Draw with pan and zoom
      ctx.save();
      ctx.clearRect(0, 0, width, height);
      ctx.translate(width / 2, height / 2);
      ctx.scale(zoom, zoom);
      ctx.translate(pan.x, pan.y);
      ctx.translate(-width / 2, -height / 2);

      // Draw edges with strength visualization
      edges.forEach((edge) => {
        const source = nodes.find((n) => n.id === edge.source);
        const target = nodes.find((n) => n.id === edge.target);
        if (source && target) {
          ctx.strokeStyle = `rgba(96, 165, 250, ${0.15 + edge.strength * 0.35})`;
          ctx.lineWidth = 1 + edge.strength * 2;
          ctx.beginPath();
          ctx.moveTo(source.x, source.y);
          ctx.lineTo(target.x, target.y);
          ctx.stroke();
        }
      });

      // Filter nodes by faction and search
      const visibleNodes = nodes.filter((node) => {
        const factionMatch = selectedFaction === "all" || node.faction === selectedFaction;
        const searchMatch = searchTerm === "" || node.name.toLowerCase().includes(searchTerm.toLowerCase());
        return factionMatch && searchMatch;
      });

      // Draw nodes
      visibleNodes.forEach((node) => {
        const isHovered = hoveredNode?.id === node.id;
        const isSearched = searchTerm !== "" && node.name.toLowerCase().includes(searchTerm.toLowerCase());
        const radius = isHovered ? 12 : isSearched ? 10 : 8;

        ctx.fillStyle = node.color;
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = isSearched ? "#FFFF00" : isHovered ? "#ffffff" : "rgba(96, 165, 250, 0.4)";
        ctx.lineWidth = isSearched ? 3 : 2;
        ctx.stroke();

        // Label on hover or search
        if (isHovered || isSearched) {
          ctx.fillStyle = "#ffffff";
          ctx.font = "11px monospace";
          ctx.textAlign = "center";
          ctx.fillText(node.name, node.x, node.y - 16);
        }
      });

      ctx.restore();

      simulationRef.current = requestAnimationFrame(animate);
    };

    simulationRef.current = requestAnimationFrame(animate);

    return () => {
      if (simulationRef.current) {
        cancelAnimationFrame(simulationRef.current);
      }
    };
  }, [nodes, edges, hoveredNode, zoom, pan, selectedFaction, searchTerm]);

  const handleCanvasClick = (e) => {
    if (isDragging) return;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left - canvas.width / 2) / zoom - pan.x + canvas.width / 2;
    const y = (e.clientY - rect.top - canvas.height / 2) / zoom - pan.y + canvas.height / 2;

    nodes.forEach((node) => {
      const dist = Math.sqrt(Math.pow(node.x - x, 2) + Math.pow(node.y - y, 2));
      if (dist < 12) {
        setSelectedCharacter(node);
      }
    });
  };

  const handleCanvasMove = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left - canvas.width / 2) / zoom - pan.x + canvas.width / 2;
    const y = (e.clientY - rect.top - canvas.height / 2) / zoom - pan.y + canvas.height / 2;

    let foundNode = null;
    nodes.forEach((node) => {
      const dist = Math.sqrt(Math.pow(node.x - x, 2) + Math.pow(node.y - y, 2));
      if (dist < 12) {
        foundNode = node;
      }
    });

    setHoveredNode(foundNode);
    if (foundNode) {
      canvasRef.current.style.cursor = "pointer";
    } else {
      canvasRef.current.style.cursor = isDragging ? "grabbing" : "grab";
    }
  };

  const handleMouseDown = (e) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX, y: e.clientY });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleMouseDrag = (e) => {
    if (!isDragging) return;
    const dx = (e.clientX - dragStart.x) / zoom;
    const dy = (e.clientY - dragStart.y) / zoom;
    setPan((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
    setDragStart({ x: e.clientX, y: e.clientY });
  };

  const handleWheel = (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom((prev) => Math.max(0.5, Math.min(3, prev * delta)));
  };

  const handleExport = async () => {
    const canvas = canvasRef.current;
    const image = await html2canvas(canvas);
    const link = document.createElement("a");
    link.href = image.toDataURL();
    link.download = `faction-network-${new Date().toISOString().split("T")[0]}.png`;
    link.click();
  };

  if (loading) {
    return (
      <div className="w-full h-96 border border-primary/20 bg-black/30 rounded flex items-center justify-center">
        <div className="text-center space-y-2">
          <Loader className="w-6 h-6 text-primary/60 animate-spin mx-auto" />
          <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase">
            Building network graph...
          </p>
        </div>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-3"
    >
      <div className="flex items-center justify-between px-3 py-2 border border-primary/20 bg-primary/5 rounded flex-wrap gap-2">
        <span className="font-mono text-[9px] text-primary/40 tracking-widest uppercase">
          🕸️ Faction Network ({nodes.length} characters)
        </span>
        <div className="flex items-center gap-2 text-[9px] font-mono text-primary/50">
          <span>Zoom: {zoom.toFixed(1)}x</span>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1 relative">
          <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-primary/40" />
          <input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search characters..."
            className="w-full bg-black/40 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-[9px] px-3 py-2 pl-8 focus:outline-none focus:border-primary/40 transition-colors"
          />
        </div>

        <select
          value={selectedFaction}
          onChange={(e) => setSelectedFaction(e.target.value)}
          className="bg-black/40 border border-primary/20 text-primary/80 font-mono text-[9px] px-3 py-2 focus:outline-none focus:border-primary/40 transition-colors"
        >
          <option value="all">All Factions</option>
          {factions.map((f) => (
            <option key={f.id} value={f.name}>
              {f.name}
            </option>
          ))}
          <option value="Unaffiliated">Unaffiliated</option>
        </select>

        <button
          onClick={handleExport}
          className="flex items-center gap-2 px-3 py-2 bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 transition-all font-mono text-[9px] tracking-widest uppercase"
        >
          <Download className="w-3 h-3" />
          Export
        </button>
      </div>

      {/* Canvas */}
      <div className="relative border border-primary/20 bg-black/30 rounded overflow-hidden">
        <canvas
          ref={canvasRef}
          width={900}
          height={600}
          onClick={handleCanvasClick}
          onMouseMove={(e) => {
            handleCanvasMove(e);
            handleMouseDrag(e);
          }}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
          className="w-full cursor-grab active:cursor-grabbing"
        />
      </div>

      {/* Legend */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[8px] font-mono border-t border-primary/10 pt-2">
        {Object.entries(factionColors).map(([faction, color]) => (
          <div key={faction} className="flex items-center gap-1.5">
            <div
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: color }}
            />
            <span className="text-primary/60 capitalize">{faction}</span>
          </div>
        ))}
      </div>

      {/* Info */}
      <div className="p-2 bg-black/40 border border-primary/10 rounded text-[8px] font-mono text-primary/50 space-y-0.5">
        <div>• Scroll to zoom | Drag to pan</div>
        <div>• Edge thickness shows relationship strength</div>
        <div>• Yellow highlight = search match</div>
      </div>

      <AnimatePresence>
        {selectedCharacter && (
          <CharacterNodeModal
            character={selectedCharacter.character}
            faction={selectedCharacter.faction}
            sessionId={sessionId}
            onClose={() => setSelectedCharacter(null)}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}