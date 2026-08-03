import { useState } from "react";
import { ChevronDown, Users, Heart } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const getTierColor = (tier) => {
  const colors = {
    hostile: "text-red-400",
    cold: "text-orange-400",
    neutral: "text-primary/60",
    warm: "text-yellow-400",
    close: "text-green-400",
    devoted: "text-cyan-400",
  };
  return colors[tier] || colors.neutral;
};

export default function GroupDynamicsPanel({ characters, relationships }) {
  const [expanded, setExpanded] = useState(false);

  if (!characters || characters.length < 2) return null;

  return (
    <div className="border border-primary/20 bg-primary/5 rounded overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-primary/10 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Users className="w-3.5 h-3.5 text-primary/60" />
          <span className="font-mono text-[9px] text-primary/40 tracking-widest uppercase">
            Group Dynamics ({characters.length} members)
          </span>
        </div>
        <ChevronDown
          className={`w-3 h-3 text-primary/40 transition-transform ${
            expanded ? "rotate-180" : ""
          }`}
        />
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="border-t border-primary/10 px-4 py-3 bg-black/40 space-y-3 max-h-60 overflow-y-auto"
          >
            {characters.map((char) => {
              const charRelationships = Object.entries(relationships)
                .filter(([charId]) => charId === char.id)
                .map(([_, rel]) => rel)[0];

              if (!charRelationships) return null;

              return (
                <div key={char.id} className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    {char.avatar_url ? (
                      <img src={char.avatar_url} alt={char.name} className="w-5 h-5 border border-primary/20 rounded" />
                    ) : (
                      <div className="w-5 h-5 border border-primary/20 bg-primary/10 flex items-center justify-center text-[8px] font-mono text-primary/60">
                        {char.name[0]}
                      </div>
                    )}
                    <span className="font-mono text-[9px] text-primary/80 tracking-wider flex-1">{char.name}</span>
                    <span className={`font-mono text-[8px] tracking-widest uppercase ${getTierColor(charRelationships.tier)}`}>
                      {charRelationships.tier}
                    </span>
                  </div>

                  {/* Relationship bars to other characters */}
                  <div className="ml-7 space-y-0.5">
                    {characters
                      .filter(c => c.id !== char.id)
                      .map((otherChar) => {
                        // Find relationship from this char to otherChar
                        const rel = relationships[char.id]?.[otherChar.id];
                        if (!rel) return null;

                        const scorePercent = ((rel.score + 100) / 200) * 100;
                        const barColor =
                          rel.score > 50 ? "bg-green-500/60" :
                          rel.score > 0 ? "bg-cyan-500/60" :
                          rel.score > -50 ? "bg-yellow-500/60" :
                          "bg-red-500/60";

                        return (
                          <div key={otherChar.id} className="flex items-center gap-1.5 text-[8px]">
                            <span className="text-primary/40 tracking-wider truncate max-w-12">
                              {otherChar.name.slice(0, 8)}
                            </span>
                            <div className="flex-1 h-1.5 bg-black/60 border border-primary/10 rounded overflow-hidden">
                              <div
                                className={`h-full ${barColor} transition-all`}
                                style={{ width: `${scorePercent}%` }}
                              />
                            </div>
                            <span className="text-primary/40 min-w-8 text-right">{rel.score}</span>
                          </div>
                        );
                      })}
                  </div>
                </div>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}