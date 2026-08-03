import { useState } from "react";
import { ChevronDown, BookOpen } from "lucide-react";
import PersistentQuestLog from "./PersistentQuestLog";
import QuestHintsPanel from "./QuestHintsPanel";
import SpecialQuestPanel from "./SpecialQuestPanel";
import QuestStatsDashboard from "./QuestStatsDashboard";
import { motion, AnimatePresence } from "framer-motion";

export default function QuestHub({
  sessionId,
  characterId,
  activeQuests = [],
}) {
  const [expandedTab, setExpandedTab] = useState("active");

  const tabs = ["active", "special", "hints", "stats"];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="border border-primary/20 bg-black/30 rounded overflow-hidden"
    >
      {/* Tab Navigation */}
      <div className="grid grid-cols-4 border-b border-primary/10">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setExpandedTab(expandedTab === tab ? null : tab)}
            className={`py-2 font-mono text-[9px] tracking-widest uppercase transition-all border-b-2 ${
              expandedTab === tab
                ? "bg-primary/10 text-primary border-b-primary"
                : "text-primary/30 hover:text-primary/60 border-b-transparent"
            }`}
          >
            {tab === "active" && "Active"}
            {tab === "special" && "Events"}
            {tab === "hints" && "Tips"}
            {tab === "stats" && "Stats"}
          </button>
        ))}
      </div>

      {/* Content */}
      <AnimatePresence mode="wait">
        {expandedTab && (
          <motion.div
            key={expandedTab}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="p-4 space-y-3 max-h-96 overflow-y-auto"
          >
            {expandedTab === "active" && (
              <PersistentQuestLog sessionId={sessionId} characterId={characterId} />
            )}
            {expandedTab === "special" && (
              <SpecialQuestPanel sessionId={sessionId} />
            )}
            {expandedTab === "hints" && (
              <QuestHintsPanel activeQuests={activeQuests} sessionId={sessionId} />
            )}
            {expandedTab === "stats" && (
              <QuestStatsDashboard sessionId={sessionId} characterId={characterId} />
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Collapsed View */}
      {!expandedTab && (
        <div className="px-4 py-2.5 flex items-center justify-between text-[9px] font-mono text-primary/50">
          <div className="flex items-center gap-2">
            <BookOpen className="w-3.5 h-3.5" />
            <span className="tracking-widest uppercase">
              {activeQuests.length} active quest{activeQuests.length !== 1 ? "s" : ""}
            </span>
          </div>
          <ChevronDown className="w-3.5 h-3.5" />
        </div>
      )}
    </motion.div>
  );
}