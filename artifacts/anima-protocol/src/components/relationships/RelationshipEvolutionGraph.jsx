import { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, ChevronRight, Zap, Users } from "lucide-react";

const TIER_COLORS = {
  hostile: "#ff6b6b",
  cold: "#4ecdc4",
  neutral: "#95a5a6",
  warm: "#f39c12",
  close: "#9b59b6",
  devoted: "#e91e63",
};

const TIER_LABELS = {
  hostile: "Hostile",
  cold: "Cold",
  neutral: "Neutral",
  warm: "Warm",
  close: "Close",
  devoted: "Devoted",
};

export default function RelationshipEvolutionGraph({ sessionId, characters = [] }) {
  const canvasRef = useRef(null);
  const [relationships, setRelationships] = useState([]);
  const [timelineIndex, setTimelineIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selectedRelationship, setSelectedRelationship] = useState(null);
  const [hoveredCharacterId, setHoveredCharacterId] = useState(null);

  useEffect(() => {
    if (!sessionId) return;
    loadRelationships();
  }, [sessionId]);

  const loadRelationships = async () => {
    try {
      const data = await base44.entities.CharacterRelationship.filter(
        { session_id: sessionId },
        "-created_date",
        500
      );
      setRelationships(data || []);
    } catch (err) {
      console.error("Error loading relationships:", err);
    } finally {
      setLoading(false);
    }
  };

  // Draw the relationship graph
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || relationships.length === 0 || loading) return;

    const ctx = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;

    // Clear canvas
    ctx.fillStyle = "#020610";
    ctx.fillRect(0, 0, width, height);

    // Get unique characters from relationships
    const charSet = new Set();
    relationships.forEach(rel => {
      charSet.add(rel.character_a_id);
      charSet.add(rel.character_b_id);
    });
    const uniqueChars = Array.from(charSet);

    if (uniqueChars.length === 0) return;

    // Calculate node positions (circular layout)
    const nodePositions = {};
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) / 2 - 60;

    uniqueChars.forEach((charId, idx) => {
      const angle = (idx / uniqueChars.length) * Math.PI * 2 - Math.PI / 2;
      nodePositions[charId] = {
        x: centerX + Math.cos(angle) * radius,
        y: centerY + Math.sin(angle) * radius,
        id: charId,
      };
    });

    // Draw edges (relationships)
    relationships.forEach(rel => {
      const from = nodePositions[rel.character_a_id];
      const to = nodePositions[rel.character_b_id];
      if (!from || !to) return;

      const color = TIER_COLORS[rel.tier] || TIER_COLORS.neutral;
      const strength = (rel.score + 100) / 200; // Normalize to 0-1
      const thickness = 1 + strength * 3;

      // Draw edge
      ctx.strokeStyle = color + Math.round(strength * 200).toString(16).padStart(2, "0");
      ctx.lineWidth = thickness;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();

      // Draw mid-point score label
      const midX = (from.x + to.x) / 2;
      const midY = (from.y + to.y) / 2;
      ctx.fillStyle = color;
      ctx.font = "11px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(rel.score, midX, midY);
    });

    // Draw nodes
    uniqueChars.forEach(charId => {
      const pos = nodePositions[charId];
      const char = characters.find(c => c.id === charId);
      const isHovered = hoveredCharacterId === charId;
      const isSelected = selectedRelationship?.character_a_id === charId || selectedRelationship?.character_b_id === charId;

      const nodeRadius = isHovered || isSelected ? 22 : 18;

      // Glow effect
      if (isHovered || isSelected) {
        ctx.fillStyle = "#00e5e5" + "40";
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, nodeRadius + 8, 0, Math.PI * 2);
        ctx.fill();
      }

      // Node circle
      ctx.fillStyle = "#00e5e5";
      ctx.strokeStyle = "#00e5e5";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, nodeRadius, 0, Math.PI * 2);
      ctx.fill();

      // Character initial or avatar
      ctx.fillStyle = "#020610";
      ctx.font = "bold 14px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(char?.name?.[0] || "?", pos.x, pos.y);

      // Character name label
      ctx.fillStyle = "#b0e5e5";
      ctx.font = "10px monospace";
      ctx.fillText(char?.name || "Unknown", pos.x, pos.y + nodeRadius + 16);
    });
  }, [relationships, characters, loading, hoveredCharacterId, selectedRelationship]);

  // Handle canvas click to select relationships
  const handleCanvasClick = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Find clicked node
    const charSet = new Set();
    relationships.forEach(rel => {
      charSet.add(rel.character_a_id);
      charSet.add(rel.character_b_id);
    });
    const uniqueChars = Array.from(charSet);

    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const radius = Math.min(canvas.width, canvas.height) / 2 - 60;

    for (let i = 0; i < uniqueChars.length; i++) {
      const charId = uniqueChars[i];
      const angle = (i / uniqueChars.length) * Math.PI * 2 - Math.PI / 2;
      const nodeX = centerX + Math.cos(angle) * radius;
      const nodeY = centerY + Math.sin(angle) * radius;

      const distance = Math.sqrt((x - nodeX) ** 2 + (y - nodeY) ** 2);
      if (distance < 25) {
        // Find relationships involving this character
        const rels = relationships.filter(
          r => r.character_a_id === charId || r.character_b_id === charId
        );
        setSelectedRelationship(rels[0] || null);
        setHoveredCharacterId(charId);
        return;
      }
    }

    setSelectedRelationship(null);
    setHoveredCharacterId(null);
  };

  if (loading) {
    return (
      <div className="p-4 text-center">
        <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase animate-pulse">
          Loading relationships...
        </p>
      </div>
    );
  }

  if (relationships.length === 0) {
    return (
      <div className="p-6 text-center border border-primary/20 bg-black/40 rounded">
        <p className="font-mono text-[9px] text-primary/20 tracking-widest uppercase">
          No relationships discovered yet
        </p>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-3"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border border-primary/20 bg-primary/5 rounded">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-primary/60" />
          <span className="font-mono text-[9px] text-primary/40 tracking-widest uppercase">
            Relationship Network
          </span>
        </div>
        <span className="text-[9px] font-mono text-primary/50">
          {relationships.length} connection{relationships.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Graph Canvas */}
      <div className="border border-primary/20 bg-black/40 rounded overflow-hidden">
        <canvas
          ref={canvasRef}
          width={600}
          height={400}
          onClick={handleCanvasClick}
          onMouseMove={(e) => {
            // Optional: Add hover detection for desktop
          }}
          className="w-full cursor-pointer"
        />
      </div>

      {/* Legend */}
      <div className="p-3 border border-primary/15 bg-black/30 rounded">
        <p className="text-[8px] font-mono text-primary/40 tracking-widest uppercase mb-2">
          Relationship Tiers
        </p>
        <div className="grid grid-cols-3 gap-2 text-[8px]">
          {Object.entries(TIER_COLORS).map(([tier, color]) => (
            <div key={tier} className="flex items-center gap-1.5">
              <div
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: color }}
              />
              <span className="text-primary/60">{TIER_LABELS[tier]}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Selected Relationship Details */}
      {selectedRelationship && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          className="p-3 border border-primary/20 bg-black/40 rounded space-y-2"
        >
          <div className="flex items-start justify-between">
            <h3 className="font-mono text-sm text-primary tracking-wider uppercase">
              Relationship Details
            </h3>
            <button
              onClick={() => setSelectedRelationship(null)}
              className="text-primary/40 hover:text-primary transition-colors"
            >
              ✕
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[9px] font-mono">
            <div>
              <p className="text-primary/40 tracking-widest uppercase text-[8px] mb-0.5">
                Character A
              </p>
              <p className="text-primary/70">
                {characters.find(c => c.id === selectedRelationship.character_a_id)?.name || "Unknown"}
              </p>
            </div>
            <div>
              <p className="text-primary/40 tracking-widest uppercase text-[8px] mb-0.5">
                Character B
              </p>
              <p className="text-primary/70">
                {characters.find(c => c.id === selectedRelationship.character_b_id)?.name || "Unknown"}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[9px] font-mono pt-2 border-t border-primary/10">
            <div>
              <p className="text-primary/40 tracking-widest uppercase text-[8px] mb-0.5">
                Tier
              </p>
              <span
                className="inline-block px-2 py-0.5 rounded text-[8px]"
                style={{
                  backgroundColor: TIER_COLORS[selectedRelationship.tier] + "30",
                  color: TIER_COLORS[selectedRelationship.tier],
                }}
              >
                {TIER_LABELS[selectedRelationship.tier]}
              </span>
            </div>
            <div>
              <p className="text-primary/40 tracking-widest uppercase text-[8px] mb-0.5">
                Score
              </p>
              <p className="text-primary/70">{selectedRelationship.score}/100</p>
            </div>
          </div>

          {selectedRelationship.score_history && (
            <div className="pt-2 border-t border-primary/10">
              <p className="text-[8px] font-mono text-primary/40 tracking-widest uppercase mb-1">
                Recent Changes
              </p>
              <div className="space-y-0.5 max-h-24 overflow-y-auto text-[8px] font-mono text-primary/60">
                {selectedRelationship.score_history.slice(-5).map((entry, idx) => (
                  <div key={idx} className="flex justify-between">
                    <span>{entry.catalyst || "Interaction"}</span>
                    <span className={entry.delta > 0 ? "text-green-400" : "text-red-400"}>
                      {entry.delta > 0 ? "+" : ""}{entry.delta}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </motion.div>
      )}

      {/* Summary Stats */}
      <div className="grid grid-cols-3 gap-2 text-[8px] font-mono">
        <div className="p-2 border border-primary/10 bg-black/30 rounded text-center">
          <p className="text-primary/40 tracking-widest uppercase mb-1">Strongest</p>
          <p className="text-primary/70">
            {relationships.reduce((max, r) => (r.score > max.score ? r : max))?.score || 0}
          </p>
        </div>
        <div className="p-2 border border-primary/10 bg-black/30 rounded text-center">
          <p className="text-primary/40 tracking-widest uppercase mb-1">Average</p>
          <p className="text-primary/70">
            {Math.round(
              relationships.reduce((sum, r) => sum + r.score, 0) / relationships.length
            )}
          </p>
        </div>
        <div className="p-2 border border-primary/10 bg-black/30 rounded text-center">
          <p className="text-primary/40 tracking-widest uppercase mb-1">Weakest</p>
          <p className="text-primary/70">
            {relationships.reduce((min, r) => (r.score < min.score ? r : min))?.score || 0}
          </p>
        </div>
      </div>
    </motion.div>
  );
}