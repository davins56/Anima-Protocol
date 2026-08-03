import { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { ZoomIn, ZoomOut, RotateCcw } from "lucide-react";

export default function RelationshipNetworkDashboard({ sessionId }) {
  const canvasRef = useRef(null);
  const [relationships, setRelationships] = useState([]);
  const [characters, setCharacters] = useState([]);
  const [storypoints, setStorypoints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedRelationship, setSelectedRelationship] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const nodePositions = useRef({});

  useEffect(() => {
    if (sessionId) loadData();
  }, [sessionId]);

  const loadData = async () => {
    setLoading(true);
    const [rels, chars, points] = await Promise.all([
      base44.entities.CharacterRelationship.filter({ session_id: sessionId }, "-updated_date", 100),
      base44.entities.Character.list("-created_date", 100),
      base44.entities.Storypoint.filter({ session_id: sessionId }, "order", 100),
    ]);
    setRelationships(rels || []);
    setCharacters(chars || []);
    setStorypoints(points || []);
    setLoading(false);
  };

  useEffect(() => {
    if (!canvasRef.current || relationships.length === 0) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;

    // Initialize node positions if not already set
    const uniqueCharIds = [...new Set(relationships.flatMap(r => [r.character_id, r.session_id]))];
    if (Object.keys(nodePositions.current).length === 0) {
      uniqueCharIds.forEach((id, idx) => {
        const angle = (idx / uniqueCharIds.length) * Math.PI * 2;
        const radius = Math.min(width, height) / 3;
        nodePositions.current[id] = {
          x: width / 2 + Math.cos(angle) * radius,
          y: height / 2 + Math.sin(angle) * radius,
        };
      });
    }

    // Clear canvas
    ctx.fillStyle = "rgb(20, 20, 30)";
    ctx.fillRect(0, 0, width, height);
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);

    // Draw edges (relationships)
    relationships.forEach((rel) => {
      const pos1 = nodePositions.current[rel.character_id];
      const pos2 = { x: width / 2, y: height / 2 }; // Center point as reference

      if (!pos1) return;

      // Color based on tier
      const tierColors = {
        hostile: "rgb(239, 68, 68)",
        cold: "rgb(59, 130, 246)",
        neutral: "rgb(107, 114, 128)",
        warm: "rgb(34, 197, 94)",
        close: "rgb(168, 85, 247)",
        devoted: "rgb(236, 72, 153)",
      };

      ctx.strokeStyle = tierColors[rel.tier] || "rgb(107, 114, 128)";
      ctx.lineWidth = Math.abs(rel.score) / 20;
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.moveTo(pos1.x, pos1.y);
      
      // Draw to other characters involved with this character
      const otherChars = relationships
        .filter(r => r.character_id !== rel.character_id)
        .slice(0, 2);
      
      otherChars.forEach((other) => {
        const pos = nodePositions.current[other.character_id];
        if (pos) {
          ctx.lineTo(pos.x, pos.y);
        }
      });
      ctx.stroke();
      ctx.globalAlpha = 1;
    });

    // Draw nodes (characters)
    const nodeCharIds = [...new Set(relationships.map(r => r.character_id))];
    nodeCharIds.forEach((charId) => {
      const pos = nodePositions.current[charId];
      if (!pos) return;

      const char = characters.find(c => c.id === charId);
      const charRels = relationships.filter(r => r.character_id === charId);
      const avgScore = charRels.length ? charRels.reduce((sum, r) => sum + r.score, 0) / charRels.length : 0;

      // Node color based on emotional state
      const hue = Math.max(0, Math.min(360, (avgScore + 100) * 1.8));
      const color = `hsl(${hue}, 70%, 50%)`;

      // Draw node
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 15, 0, Math.PI * 2);
      ctx.fill();

      // Label
      ctx.fillStyle = "rgb(200, 255, 255)";
      ctx.font = "12px 'Share Tech Mono'";
      ctx.textAlign = "center";
      ctx.fillText(char?.name?.slice(0, 3) || "?", pos.x, pos.y + 4);
    });

    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }, [relationships, characters, zoom, pan]);

  const handleWheel = (e) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom(z => Math.max(0.5, Math.min(3, z * factor)));
  };

  const handleReset = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    nodePositions.current = {};
  };

  const getTierColor = (tier) => {
    const colors = {
      hostile: "text-red-400",
      cold: "text-blue-400",
      neutral: "text-gray-400",
      warm: "text-green-400",
      close: "text-purple-400",
      devoted: "text-pink-400",
    };
    return colors[tier] || "text-primary/60";
  };

  return (
    <div className="w-full h-full flex gap-6 bg-background">
      {/* Canvas */}
      <div className="flex-1 relative border border-primary/20 overflow-hidden">
        {loading ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="font-mono text-primary/30 text-sm">Loading...</p>
          </div>
        ) : (
          <>
            <canvas
              ref={canvasRef}
              width={800}
              height={600}
              onWheel={handleWheel}
              className="w-full h-full cursor-grab active:cursor-grabbing"
            />
            <div className="absolute bottom-4 right-4 flex gap-2">
              <button
                onClick={() => setZoom(z => Math.min(3, z * 1.2))}
                className="w-8 h-8 bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 flex items-center justify-center"
                title="Zoom in"
              >
                <ZoomIn className="w-3 h-3" />
              </button>
              <button
                onClick={() => setZoom(z => Math.max(0.5, z * 0.8))}
                className="w-8 h-8 bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 flex items-center justify-center"
                title="Zoom out"
              >
                <ZoomOut className="w-3 h-3" />
              </button>
              <button
                onClick={handleReset}
                className="w-8 h-8 bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 flex items-center justify-center"
                title="Reset view"
              >
                <RotateCcw className="w-3 h-3" />
              </button>
            </div>
          </>
        )}
      </div>

      {/* Details Panel */}
      <div className="w-80 flex flex-col gap-4 pb-6 overflow-y-auto pr-2">
        <div>
          <h3 className="font-mono text-primary tracking-[0.2em] uppercase text-xs mb-3">
            // Relationship Network
          </h3>
          <p className="text-[9px] font-mono text-primary/40 leading-relaxed">
            {relationships.length} connections tracked across {[...new Set(relationships.map(r => r.character_id))].length} characters
          </p>
        </div>

        {/* Relationship List */}
        <div className="space-y-1.5 max-h-96 overflow-y-auto">
          {relationships.map((rel, idx) => {
            const char = characters.find(c => c.id === rel.character_id);
            const isSelected = selectedRelationship?.id === rel.id;

            return (
              <button
                key={rel.id}
                onClick={() => setSelectedRelationship(rel)}
                className={`w-full text-left p-2 border transition-all ${
                  isSelected
                    ? "border-primary/40 bg-primary/10"
                    : "border-primary/15 bg-black/40 hover:border-primary/30"
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <p className="font-mono text-[9px] text-primary tracking-wider uppercase truncate">
                    {char?.name || "Unknown"}
                  </p>
                  <span className={`text-[8px] font-mono ${getTierColor(rel.tier)} tracking-widest`}>
                    {rel.tier}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-[8px] font-mono">
                  <div className="flex-1 h-1 bg-primary/10 border border-primary/15">
                    <div
                      className="h-full bg-primary/60"
                      style={{ width: `${Math.max(0, rel.score + 100) / 2}%` }}
                    />
                  </div>
                  <span className="text-primary/50">{rel.score > 0 ? "+" : ""}{rel.score}</span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Selected Relationship Details */}
        {selectedRelationship && (
          <div className="border border-primary/20 bg-black/60 p-3 space-y-2">
            <p className="text-[9px] font-mono text-primary/40 tracking-widest uppercase">Details</p>
            {(() => {
              const char = characters.find(c => c.id === selectedRelationship.character_id);
              return (
                <>
                  <p className="text-[10px] font-mono text-primary">{char?.name}</p>
                  <div className="grid grid-cols-2 gap-2 text-[8px] font-mono text-primary/60">
                    <div>
                      <p className="text-primary/40 tracking-widest uppercase mb-0.5">Score</p>
                      <p className="text-primary">{selectedRelationship.score}</p>
                    </div>
                    <div>
                      <p className="text-primary/40 tracking-widest uppercase mb-0.5">Tier</p>
                      <p className={getTierColor(selectedRelationship.tier)}>
                        {selectedRelationship.tier}
                      </p>
                    </div>
                    <div>
                      <p className="text-primary/40 tracking-widest uppercase mb-0.5">Interactions</p>
                      <p className="text-primary">{selectedRelationship.total_interactions || 0}</p>
                    </div>
                    <div>
                      <p className="text-primary/40 tracking-widest uppercase mb-0.5">Last Delta</p>
                      <p className="text-primary">
                        {selectedRelationship.last_delta > 0 ? "+" : ""}{selectedRelationship.last_delta}
                      </p>
                    </div>
                  </div>
                </>
              );
            })()}
          </div>
        )}

        {/* Storypoint Events */}
        {storypoints.length > 0 && (
          <div className="border border-primary/20 bg-black/40 p-3">
            <p className="text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-2">
              Story Events ({storypoints.length})
            </p>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {storypoints.slice(-5).map((point, idx) => (
                <div key={point.id} className="text-[8px] font-mono text-primary/50 border-l-2 border-primary/20 pl-2 py-1">
                  <p className="font-bold text-primary/70">{point.title}</p>
                  <p className="text-primary/40 line-clamp-1">{point.summary}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}