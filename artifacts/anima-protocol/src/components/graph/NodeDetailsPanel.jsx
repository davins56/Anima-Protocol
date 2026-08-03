import { X, Heart, Users, MapPin, BookText } from "lucide-react";
import { motion } from "framer-motion";

export default function NodeDetailsPanel({ node, onClose }) {
  const getIcon = () => {
    switch (node.type) {
      case "character":
        return <Users className="w-4 h-4" />;
      case "faction":
        return <Users className="w-4 h-4" />;
      case "location":
        return <MapPin className="w-4 h-4" />;
      default:
        return null;
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="flex flex-col h-full"
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-primary/20 bg-black/80">
        <div className="flex items-center gap-2">
          {getIcon()}
          <div>
            <p className="font-mono text-xs text-primary/60 tracking-widest uppercase">
              {node.type}
            </p>
            <p className="font-mono text-sm text-primary mt-0.5">{node.name}</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="text-primary/30 hover:text-primary transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Character Details */}
        {node.type === "character" && (
          <>
            {node.personality && (
              <div>
                <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase mb-2">
                  Personality
                </p>
                <p className="font-mono text-[10px] text-primary/70 leading-relaxed">
                  {node.personality.slice(0, 150)}...
                </p>
              </div>
            )}

            {node.relationships && node.relationships.length > 0 && (
              <div>
                <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase mb-2">
                  Relationships ({node.relationships.length})
                </p>
                <div className="space-y-1.5">
                  {node.relationships.slice(0, 5).map((rel, idx) => (
                    <div
                      key={idx}
                      className="p-2 bg-black/40 border border-primary/15 rounded flex items-center justify-between"
                    >
                      <span className="font-mono text-[9px] text-primary/60">
                        {rel.tier}
                      </span>
                      <span className="font-mono text-[9px] text-primary/40">
                        {rel.score > 0 ? "+" : ""}{rel.score}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {node.memories && node.memories.length > 0 && (
              <div>
                <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase mb-2">
                  Memories ({node.memories.length})
                </p>
                <div className="space-y-1.5">
                  {node.memories.slice(0, 3).map((mem, idx) => (
                    <div key={idx} className="p-2 bg-primary/5 border border-primary/15 rounded">
                      <p className="font-mono text-[8px] text-primary/60">
                        {mem.fact}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* Faction Details */}
        {node.type === "faction" && (
          <>
            {node.description && (
              <div>
                <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase mb-2">
                  Description
                </p>
                <p className="font-mono text-[10px] text-primary/70 leading-relaxed">
                  {node.description.slice(0, 150)}...
                </p>
              </div>
            )}

            {node.members && node.members.length > 0 && (
              <div>
                <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase mb-2">
                  Members ({node.members.length})
                </p>
                <div className="space-y-1">
                  {node.members.slice(0, 5).map((member) => (
                    <div key={member.id} className="font-mono text-[9px] text-primary/60 pl-2 border-l border-primary/20">
                      {member.name}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {node.power_level !== undefined && (
              <div>
                <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase mb-2">
                  Power Level
                </p>
                <div className="w-full bg-black/40 h-2 rounded overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-primary to-cyan-400 transition-all"
                    style={{ width: `${(node.power_level / 10) * 100}%` }}
                  />
                </div>
                <p className="font-mono text-[9px] text-primary/50 mt-1">
                  {node.power_level}/10
                </p>
              </div>
            )}
          </>
        )}

        {/* Location Details */}
        {node.type === "location" && (
          <>
            {node.description && (
              <div>
                <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase mb-2">
                  Description
                </p>
                <p className="font-mono text-[10px] text-primary/70 leading-relaxed">
                  {node.description}
                </p>
              </div>
            )}

            {node.x_coord !== undefined && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <p className="font-mono text-[8px] text-primary/40">X Coordinate</p>
                  <p className="font-mono text-[10px] text-primary/70">{node.x_coord}</p>
                </div>
                <div>
                  <p className="font-mono text-[8px] text-primary/40">Y Coordinate</p>
                  <p className="font-mono text-[10px] text-primary/70">{node.y_coord}</p>
                </div>
              </div>
            )}

            {node.significance && (
              <div>
                <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase mb-1">
                  Significance
                </p>
                <p className="font-mono text-[10px] text-primary/70 capitalize">
                  {node.significance}
                </p>
              </div>
            )}

            {node.charactersHere && node.charactersHere.length > 0 && (
              <div>
                <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase mb-2">
                  Characters Here ({node.charactersHere.length})
                </p>
                <div className="space-y-1">
                  {node.charactersHere.map((char) => (
                    <div key={char.id} className="font-mono text-[9px] text-primary/60 pl-2 border-l border-primary/20">
                      {char.name}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </motion.div>
  );
}