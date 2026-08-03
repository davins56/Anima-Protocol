import { useState, useEffect, useRef } from "react";
import { ChevronDown, Loader, Users, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function RelationshipEvolutionMap({ relationships, characters }) {
  const [expandedRelationship, setExpandedRelationship] = useState(null);
  const [selectedConnection, setSelectedConnection] = useState(null);
  const svgRef = useRef(null);

  if (!relationships || Object.keys(relationships).length === 0) {
    return null;
  }

  // Prepare data for visualization
  const relationshipPairs = [];
  const processedPairs = new Set();

  Object.entries(relationships).forEach(([charId, rel]) => {
    const key = [charId, rel.character_id].sort().join("-");
    if (!processedPairs.has(key)) {
      relationshipPairs.push({
        id: key,
        character1Id: charId,
        character2Id: rel.character_id,
        character1Name: characters?.find(c => c.id === charId)?.name || charId,
        character2Name: characters?.find(c => c.id === rel.character_id)?.name || rel.character_id,
        score: rel.score || 0,
        tier: rel.tier || "neutral",
        totalInteractions: rel.total_interactions || 0,
        lastDelta: rel.last_delta || 0,
      });
      processedPairs.add(key);
    }
  });

  const getTierColor = (tier) => {
    const colors = {
      hostile: "#ff6b6b",
      cold: "#ffa94d",
      neutral: "#868e96",
      warm: "#74c0fc",
      close: "#51cf66",
      devoted: "#ff6b9d",
    };
    return colors[tier] || "#868e96";
  };

  const getTierLabel = (tier) => {
    const labels = {
      hostile: "⚔️ Hostile",
      cold: "❄️ Cold",
      neutral: "😐 Neutral",
      warm: "☀️ Warm",
      close: "❤️ Close",
      devoted: "💕 Devoted",
    };
    return labels[tier] || tier;
  };

  return (
    <div className="space-y-3 mb-4">
      <div className="flex items-center gap-2 px-3 py-1.5 border border-primary/15 bg-primary/5 rounded">
        <Users className="w-3 h-3 text-primary/50" />
        <span className="font-mono text-[9px] text-primary/40 tracking-widest uppercase">
          Relationship Evolution ({relationshipPairs.length} connections)
        </span>
      </div>

      {/* Relationship Connections List */}
      <div className="space-y-1.5 border border-primary/20 bg-black/40 rounded p-3 max-h-64 overflow-y-auto">
        {relationshipPairs.length === 0 ? (
          <p className="text-center text-[9px] font-mono text-primary/30 py-4">
            No relationships established yet
          </p>
        ) : (
          relationshipPairs.map((pair) => {
            const tierColor = getTierColor(pair.tier);
            const isExpanded = expandedRelationship === pair.id;

            return (
              <motion.div
                key={pair.id}
                layout
                className="border border-primary/15 hover:border-primary/30 rounded transition-all"
              >
                <button
                  onClick={() =>
                    setExpandedRelationship(isExpanded ? null : pair.id)
                  }
                  className="w-full text-left p-2 hover:bg-primary/5 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <div
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: tierColor }}
                        />
                        <span className="font-mono text-[9px] font-semibold tracking-wider truncate">
                          {pair.character1Name} ↔ {pair.character2Name}
                        </span>
                      </div>

                      {/* Score Bar */}
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1 bg-black/60 border border-primary/10 rounded">
                          <div
                            className="h-full transition-all"
                            style={{
                              width: `${((pair.score + 100) / 200) * 100}%`,
                              backgroundColor: tierColor,
                              opacity: 0.7,
                            }}
                          />
                        </div>
                        <span className="text-[8px] font-mono text-primary/50 whitespace-nowrap">
                          {pair.score > 0 ? "+" : ""}{pair.score}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <span className="text-[8px] font-mono text-primary/40">
                        {getTierLabel(pair.tier)}
                      </span>
                      <ChevronDown
                        className={`w-3 h-3 text-primary/40 transition-transform ${
                          isExpanded ? "rotate-180" : ""
                        }`}
                      />
                    </div>
                  </div>
                </button>

                {/* Expanded Details */}
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="px-2 pb-2 border-t border-primary/10 space-y-2"
                    >
                      <div className="grid grid-cols-2 gap-2 text-[8px] font-mono text-primary/60 mt-2">
                        <div>
                          <p className="text-primary/40 tracking-widest uppercase mb-0.5">
                            Interactions
                          </p>
                          <p className="text-primary/70">{pair.totalInteractions}</p>
                        </div>
                        <div>
                          <p className="text-primary/40 tracking-widest uppercase mb-0.5">
                            Last Change
                          </p>
                          <p className={pair.lastDelta > 0 ? "text-green-400" : pair.lastDelta < 0 ? "text-red-400" : "text-primary/70"}>
                            {pair.lastDelta > 0 ? "+" : ""}{pair.lastDelta}
                          </p>
                        </div>
                      </div>

                      {/* Tier Progression */}
                      <div>
                        <p className="text-[8px] font-mono text-primary/40 tracking-widest uppercase mb-1">
                          Relationship Status
                        </p>
                        <p className="text-[9px] font-mono leading-relaxed" style={{ color: tierColor }}>
                          {getTierLabel(pair.tier)}
                        </p>
                      </div>

                      <p className="text-[8px] font-mono text-primary/40 border-t border-primary/10 pt-1.5 mt-1.5">
                        Score: {pair.score}/100 ({Math.round(((pair.score + 100) / 200) * 100)}%)
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })
        )}
      </div>

      {/* Legend */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 text-[8px] font-mono">
        {[
          { tier: "hostile", label: "⚔️ Hostile" },
          { tier: "cold", label: "❄️ Cold" },
          { tier: "neutral", label: "😐 Neutral" },
          { tier: "warm", label: "☀️ Warm" },
          { tier: "close", label: "❤️ Close" },
          { tier: "devoted", label: "💕 Devoted" },
        ].map(({ tier, label }) => (
          <div key={tier} className="flex items-center gap-1.5">
            <div
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: getTierColor(tier) }}
            />
            <span className="text-primary/60">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}