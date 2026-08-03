import { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { ChevronDown, Loader, Edit2, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const RELATIONSHIP_TYPES = [
  { id: "trust", label: "Trust", color: "#51cf66" },
  { id: "animosity", label: "Animosity", color: "#ff6b6b" },
  { id: "romance", label: "Romance", color: "#ff6b9d" },
  { id: "neutral", label: "Neutral", color: "#868e96" },
  { id: "alliance", label: "Alliance", color: "#74c0fc" },
  { id: "rivalry", label: "Rivalry", color: "#ffa94d" },
];

export default function CharacterRelationshipForceGraph() {
  const [characters, setCharacters] = useState([]);
  const [relationships, setRelationships] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedCharacter, setSelectedCharacter] = useState(null);
  const [selectedRelationship, setSelectedRelationship] = useState(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [nodePositions, setNodePositions] = useState({});
  const [velocity, setVelocity] = useState({});
  const canvasRef = useRef(null);
  const animationRef = useRef(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    const [charData, relData] = await Promise.all([
      base44.entities.Character.list("-created_date", 100),
      base44.entities.CharacterRelationship.list("-created_date", 500),
    ]);
    setCharacters(charData || []);
    setRelationships(relData || []);
    initializeLayout(charData || []);
    setLoading(false);
  };

  const initializeLayout = (chars) => {
    const positions = {};
    const vel = {};
    chars.forEach((char, idx) => {
      const angle = (idx / chars.length) * Math.PI * 2;
      const radius = 150;
      positions[char.id] = {
        x: 400 + radius * Math.cos(angle),
        y: 300 + radius * Math.sin(angle),
      };
      vel[char.id] = { x: 0, y: 0 };
    });
    setNodePositions(positions);
    setVelocity(vel);
  };

  // Force-directed graph simulation
  useEffect(() => {
    if (characters.length === 0) return;

    const simulate = () => {
      setNodePositions((prevPos) => {
        const newPos = { ...prevPos };
        const newVel = { ...velocity };
        const damping = 0.95;
        const repulsion = 100;
        const attraction = 0.02;

        // Repulsive forces between all nodes
        characters.forEach((char1) => {
          newVel[char1.id] = newVel[char1.id] || { x: 0, y: 0 };
          characters.forEach((char2) => {
            if (char1.id === char2.id) return;

            const dx = newPos[char2.id].x - newPos[char1.id].x;
            const dy = newPos[char2.id].y - newPos[char1.id].y;
            const dist = Math.sqrt(dx * dx + dy * dy) + 1;

            const force = repulsion / (dist * dist);
            newVel[char1.id].x -= (force * dx) / dist;
            newVel[char1.id].y -= (force * dy) / dist;
          });
        });

        // Attractive forces for relationships
        relationships.forEach((rel) => {
          const char1Pos = newPos[rel.character_id];
          const char2Pos = newPos[rel.with_character_id];
          if (!char1Pos || !char2Pos) return;

          const dx = char2Pos.x - char1Pos.x;
          const dy = char2Pos.y - char1Pos.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          const strength = (rel.score + 100) / 200; // Normalize -100..100 to 0..1
          const force = attraction * strength;
          newVel[rel.character_id].x += force * dx;
          newVel[rel.character_id].y += force * dy;
          newVel[rel.with_character_id].x -= force * dx;
          newVel[rel.with_character_id].y -= force * dy;
        });

        // Update positions
        characters.forEach((char) => {
          newVel[char.id].x *= damping;
          newVel[char.id].y *= damping;
          newPos[char.id].x += newVel[char.id].x;
          newPos[char.id].y += newVel[char.id].y;

          // Boundary constraints
          newPos[char.id].x = Math.max(30, Math.min(770, newPos[char.id].x));
          newPos[char.id].y = Math.max(30, Math.min(570, newPos[char.id].y));
        });

        setVelocity(newVel);
        return newPos;
      });
    };

    animationRef.current = setInterval(simulate, 30);
    return () => clearInterval(animationRef.current);
  }, [characters, relationships]);

  // Canvas rendering
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "hsl(220 20% 4%)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw edges
    relationships.forEach((rel) => {
      const pos1 = nodePositions[rel.character_id];
      const pos2 = nodePositions[rel.with_character_id];
      if (!pos1 || !pos2) return;

      const relType = RELATIONSHIP_TYPES.find((t) => t.id === rel.tier) || RELATIONSHIP_TYPES[3];
      const strength = Math.abs(rel.score) / 100;
      const thickness = 1 + strength * 3;

      ctx.strokeStyle = relType.color;
      ctx.lineWidth = thickness;
      ctx.globalAlpha = 0.3 + strength * 0.4;
      ctx.beginPath();
      ctx.moveTo(pos1.x, pos1.y);
      ctx.lineTo(pos2.x, pos2.y);
      ctx.stroke();
      ctx.globalAlpha = 1;
    });

    // Draw nodes
    characters.forEach((char) => {
      const pos = nodePositions[char.id];
      if (!pos) return;

      const isSelected = selectedCharacter?.id === char.id;
      const radius = isSelected ? 20 : 15;

      // Node circle
      ctx.fillStyle = "hsl(185 100% 50%)";
      ctx.globalAlpha = isSelected ? 1 : 0.8;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
      ctx.fill();

      // Selection ring
      if (isSelected) {
        ctx.strokeStyle = "hsl(185 100% 50%)";
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, radius + 8, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.globalAlpha = 1;
    });
  }, [nodePositions, characters, relationships, selectedCharacter]);

  const handleCanvasClick = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Find clicked character
    for (const char of characters) {
      const pos = nodePositions[char.id];
      if (!pos) continue;
      const dist = Math.sqrt((pos.x - x) ** 2 + (pos.y - y) ** 2);
      if (dist < 20) {
        setSelectedCharacter(char);
        return;
      }
    }
    setSelectedCharacter(null);
  };

  const getRelationshipsForCharacter = (charId) => {
    return relationships.filter(
      (r) => r.character_id === charId || r.with_character_id === charId
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[100dvh] bg-background">
        <div className="text-center space-y-3">
          <Loader className="w-8 h-8 text-primary animate-spin mx-auto" />
          <p className="font-mono text-[10px] text-primary/40 tracking-widest uppercase">
            Loading character network...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[100dvh] w-full bg-background overflow-hidden">
      {/* Canvas */}
      <div className="flex-1 flex flex-col">
        <div className="px-4 py-3 border-b border-primary/20 bg-black/60">
          <h1 className="font-mono text-primary glow-text tracking-[0.2em] uppercase">
            // Character Network
          </h1>
          <p className="text-[9px] font-mono text-primary/30 mt-1">
            {characters.length} characters
            {selectedCharacter && ` • Selected: ${selectedCharacter.name}`}
          </p>
        </div>
        <canvas
          ref={canvasRef}
          width={800}
          height={600}
          onClick={handleCanvasClick}
          className="flex-1 cursor-pointer bg-black/40"
          style={{ maxWidth: "100%", maxHeight: "100%" }}
        />
      </div>

      {/* Legend */}
      <div className="w-64 border-l border-primary/20 bg-black/60 flex flex-col">
        <div className="px-4 py-3 border-b border-primary/20">
          <h2 className="font-mono text-xs text-primary tracking-[0.2em] uppercase">
            Legend
          </h2>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {RELATIONSHIP_TYPES.map((type) => (
            <div key={type.id} className="flex items-center gap-2">
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: type.color }}
              />
              <span className="text-[9px] font-mono text-primary/70">{type.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Details Panel */}
      <AnimatePresence>
        {selectedCharacter && (
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            className="w-80 border-l border-primary/20 bg-black/60 flex flex-col overflow-hidden"
          >
            {/* Header */}
            <div className="px-4 py-3 border-b border-primary/20 flex items-center justify-between">
              <div>
                <h2 className="font-mono text-xs text-primary tracking-[0.2em] uppercase">
                  {selectedCharacter.name}
                </h2>
                <p className="text-[9px] font-mono text-primary/30 mt-1">
                  {selectedCharacter.category || "character"}
                </p>
              </div>
              <button
                onClick={() => setSelectedCharacter(null)}
                className="text-primary/30 hover:text-primary transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Relationships */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              <p className="text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-2">
                Relationships ({getRelationshipsForCharacter(selectedCharacter.id).length})
              </p>
              {getRelationshipsForCharacter(selectedCharacter.id).length === 0 ? (
                <p className="text-[9px] font-mono text-primary/30">No relationships yet</p>
              ) : (
                getRelationshipsForCharacter(selectedCharacter.id).map((rel, idx) => {
                  const otherCharId =
                    rel.character_id === selectedCharacter.id
                      ? rel.with_character_id
                      : rel.character_id;
                  const otherChar = characters.find((c) => c.id === otherCharId);
                  const relType = RELATIONSHIP_TYPES.find((t) => t.id === rel.tier) || RELATIONSHIP_TYPES[3];

                  return (
                    <div
                      key={idx}
                      className="p-2.5 border border-primary/15 bg-black/40 space-y-1.5 hover:border-primary/30 transition-colors cursor-pointer"
                      onClick={() => {
                        setSelectedRelationship(rel);
                        setShowEditModal(true);
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 min-w-0">
                          <div
                            className="w-2 h-2 rounded-full flex-shrink-0"
                            style={{ backgroundColor: relType.color }}
                          />
                          <span className="text-[9px] font-mono text-primary/80 truncate">
                            {otherChar?.name || "Unknown"}
                          </span>
                        </div>
                        <Edit2 className="w-3 h-3 text-primary/30 flex-shrink-0" />
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[8px] font-mono text-primary/50">{relType.label}</span>
                        <span className="text-[8px] font-mono text-primary/40">
                          {rel.score > 0 ? "+" : ""}{rel.score}
                        </span>
                      </div>
                      {/* Score bar */}
                      <div className="w-full h-1.5 bg-black/60 border border-primary/10 overflow-hidden">
                        <div
                          className="h-full transition-all"
                          style={{
                            width: `${((rel.score + 100) / 200) * 100}%`,
                            backgroundColor: relType.color,
                            opacity: 0.7,
                          }}
                        />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Edit Modal */}
      <AnimatePresence>
        {showEditModal && selectedRelationship && (
          <RelationshipEditModal
            relationship={selectedRelationship}
            characters={characters}
            onClose={() => setShowEditModal(false)}
            onSave={async (updatedRel) => {
              await base44.entities.CharacterRelationship.update(
                selectedRelationship.id,
                updatedRel
              );
              await loadData();
              setShowEditModal(false);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function RelationshipEditModal({ relationship, characters, onClose, onSave }) {
  const [score, setScore] = useState(relationship.score || 0);
  const [tier, setTier] = useState(relationship.tier || "neutral");
  const [saving, setSaving] = useState(false);

  const char1 = characters.find((c) => c.id === relationship.character_id);
  const char2 = characters.find((c) => c.id === relationship.with_character_id);

  const handleSave = async () => {
    setSaving(true);
    await onSave({ score, tier });
    setSaving(false);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="w-full max-w-md bg-background border border-primary/30 p-6 space-y-4 hud-corner"
      >
        <div>
          <h2 className="font-mono text-primary glow-text tracking-[0.2em] uppercase mb-2">
            Edit Relationship
          </h2>
          <p className="text-[9px] font-mono text-primary/40">
            {char1?.name} ↔ {char2?.name}
          </p>
        </div>

        {/* Tier Selection */}
        <div>
          <label className="block text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-2">
            Relationship Type
          </label>
          <div className="grid grid-cols-2 gap-2">
            {RELATIONSHIP_TYPES.map((type) => (
              <button
                key={type.id}
                onClick={() => setTier(type.id)}
                className={`px-3 py-2 border font-mono text-[9px] tracking-widest uppercase transition-all ${
                  tier === type.id
                    ? "border-primary/60 bg-primary/10 text-primary"
                    : "border-primary/15 text-primary/40 hover:border-primary/30"
                }`}
              >
                {type.label}
              </button>
            ))}
          </div>
        </div>

        {/* Score Slider */}
        <div>
          <label className="block text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-2">
            Affinity Score: {score > 0 ? "+" : ""}{score}
          </label>
          <input
            type="range"
            min="-100"
            max="100"
            value={score}
            onChange={(e) => setScore(parseInt(e.target.value))}
            className="w-full accent-primary"
          />
          <div className="flex justify-between text-[8px] font-mono text-primary/30 mt-1">
            <span>Hostile</span>
            <span>Neutral</span>
            <span>Devoted</span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-4">
          <button
            onClick={onClose}
            disabled={saving}
            className="flex-1 px-4 py-2 border border-primary/20 text-primary/40 hover:text-primary/70 font-mono text-[9px] tracking-widest uppercase transition-all disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 px-4 py-2 border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 font-mono text-[9px] tracking-widest uppercase transition-all disabled:opacity-50 hud-corner"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}