import { useState, useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { Loader, X, ZoomIn, ZoomOut, Share2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import NetworkGraphVisualization from "@/components/graph/NetworkGraphVisualization";
import NodeDetailsPanel from "@/components/graph/NodeDetailsPanel";

export default function InteractiveGraphVisualization() {
  const { sessionId } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedNode, setSelectedNode] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [nodeDetails, setNodeDetails] = useState(null);
  const svgRef = useRef(null);

  useEffect(() => {
    loadGraphData();
  }, [sessionId]);

  const loadGraphData = async () => {
    setLoading(true);
    try {
      const [chars, factions, locs, rels, memories, lore] = await Promise.all([
        base44.entities.Character.list("-created_date", 100),
        base44.entities.Faction.list("-created_date", 100),
        base44.entities.Location.list("-created_date", 100),
        sessionId ? base44.entities.CharacterRelationship.filter({ session_id: sessionId }) : Promise.resolve([]),
        sessionId ? base44.entities.CharacterMemory.filter({ session_id: sessionId }) : Promise.resolve([]),
        sessionId ? base44.entities.WorldState.filter({ session_id: sessionId, is_active: true }) : Promise.resolve([]),
      ]);

      setData({
        characters: chars || [],
        factions: factions || [],
        locations: locs || [],
        relationships: rels || [],
        memories: memories || [],
        lore: lore || [],
      });
    } catch (err) {
      console.error("Error loading graph data:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleNodeClick = async (node) => {
    setSelectedNode(node);

    // Fetch detailed information about the selected node
    let details = { id: node.id, type: node.type, name: node.name };

    if (node.type === "character") {
      const char = data.characters.find((c) => c.id === node.id);
      const charRels = data.relationships.filter(
        (r) => r.character_id === node.id || r.related_character_id === node.id
      );
      const charMemories = data.memories.filter((m) => m.character_id === node.id);

      details = {
        ...details,
        ...char,
        relationships: charRels,
        memories: charMemories,
      };
    } else if (node.type === "faction") {
      const faction = data.factions.find((f) => f.id === node.id);
      const factionMembers = data.characters.filter((c) =>
        faction?.member_characters?.includes(c.id)
      );
      const factionLore = data.lore.filter((l) => l.fact.includes(faction?.name));

      details = {
        ...details,
        ...faction,
        members: factionMembers,
        relatedLore: factionLore,
      };
    } else if (node.type === "location") {
      const loc = data.locations.find((l) => l.id === node.id);
      const locLore = data.lore.filter((l) => l.fact.includes(loc?.name));
      const charAtLoc = data.characters.filter((c) => c.current_location === loc?.id);

      details = {
        ...details,
        ...loc,
        relatedLore: locLore,
        charactersHere: charAtLoc,
      };
    }

    setNodeDetails(details);
  };

  const handleZoom = (direction) => {
    setZoom((prev) => {
      const newZoom = direction === "in" ? prev * 1.2 : prev / 1.2;
      return Math.max(0.5, Math.min(newZoom, 3));
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center flex-1 min-h-0 bg-background">
        <div className="text-center">
          <Loader className="w-8 h-8 text-primary/60 animate-spin mx-auto mb-3" />
          <p className="font-mono text-[10px] text-primary/40 tracking-widest uppercase">
            Building relationship network...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden bg-background">
      {/* Graph Canvas */}
      <div className="flex-1 border-r border-primary/20 overflow-hidden relative">
        <svg
          ref={svgRef}
          width="100%"
          height="100%"
          className="bg-black/40"
          style={{ cursor: selectedNode ? "pointer" : "grab" }}
        >
          <g style={{ transform: `scale(${zoom})`, transformOrigin: "0 0" }}>
            <NetworkGraphVisualization
              data={data}
              selectedNode={selectedNode}
              onNodeClick={handleNodeClick}
            />
          </g>
        </svg>

        {/* Controls */}
        <div className="absolute top-4 left-4 flex flex-col gap-2 z-10">
          <button
            onClick={() => handleZoom("in")}
            className="p-2 border border-primary/30 bg-black/60 text-primary/60 hover:text-primary/90 transition-colors"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <button
            onClick={() => handleZoom("out")}
            className="p-2 border border-primary/30 bg-black/60 text-primary/60 hover:text-primary/90 transition-colors"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <div className="text-[9px] font-mono text-primary/40 pt-2">
            {Math.round(zoom * 100)}%
          </div>
        </div>

        {/* Legend */}
        <div className="absolute bottom-4 left-4 p-3 border border-primary/20 bg-black/80 space-y-2 text-[9px] font-mono">
          <p className="text-primary/40 tracking-widest uppercase">Legend</p>
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 bg-cyan-400 rounded-full" />
            <span className="text-primary/60">Characters</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 bg-yellow-400 rounded-full" />
            <span className="text-primary/60">Factions</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 bg-green-400 rounded-full" />
            <span className="text-primary/60">Locations</span>
          </div>
        </div>
      </div>

      {/* Details Panel */}
      <AnimatePresence>
        {nodeDetails && (
          <motion.div
            initial={{ opacity: 0, x: 400 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 400 }}
            className="w-96 border-l border-primary/20 bg-black/60 overflow-y-auto flex flex-col"
          >
            <NodeDetailsPanel node={nodeDetails} onClose={() => setNodeDetails(null)} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}