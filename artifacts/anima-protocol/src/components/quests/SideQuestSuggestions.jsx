import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Scroll, X, ChevronDown, ChevronUp, Sparkles, Package, BookOpen, Swords } from "lucide-react";
import { base44 } from "@/api/base44Client";

const DIFFICULTY_COLORS = {
  easy: "text-green-400 border-green-400/30 bg-green-400/5",
  moderate: "text-yellow-400 border-yellow-400/30 bg-yellow-400/5",
  hard: "text-red-400 border-red-400/30 bg-red-400/5",
};

const TRIGGER_ICONS = {
  inventory: Package,
  lore: BookOpen,
  both: Sparkles,
};

function SideQuestCard({ quest, onAccept, onDismiss }) {
  const [expanded, setExpanded] = useState(false);
  const TriggerIcon = TRIGGER_ICONS[quest.trigger_source] || Scroll;
  const diffClass = DIFFICULTY_COLORS[quest.difficulty] || DIFFICULTY_COLORS.moderate;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="border border-amber-400/25 bg-black/60 rounded overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-start gap-2 p-3">
        <TriggerIcon className="w-3.5 h-3.5 text-amber-400/70 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-[10px] text-amber-300 tracking-wider uppercase font-semibold truncate">
              {quest.title}
            </span>
            <span className={`text-[7px] font-mono tracking-widest uppercase px-1.5 py-0.5 border rounded ${diffClass}`}>
              {quest.difficulty}
            </span>
          </div>
          <p className="text-[9px] font-mono text-primary/70 mt-0.5 leading-relaxed line-clamp-2">
            {quest.hook}
          </p>
          {quest.trigger_detail && (
            <p className="text-[7px] font-mono text-amber-400/40 mt-1 italic">
              ✦ Triggered by: {quest.trigger_detail}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={() => setExpanded(e => !e)}
            className="p-1 text-primary/30 hover:text-primary/60 transition-colors"
          >
            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
          <button
            onClick={() => onDismiss(quest.id)}
            className="p-1 text-primary/20 hover:text-red-400 transition-colors"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Expanded details */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="px-3 pb-3 space-y-2 border-t border-amber-400/10"
          >
            <p className="text-[9px] font-mono text-primary/60 leading-relaxed pt-2">
              {quest.description}
            </p>
            {quest.objectives?.length > 0 && (
              <div className="space-y-1">
                <p className="text-[7px] font-mono text-amber-400/50 tracking-widest uppercase">Objectives</p>
                {quest.objectives.map((obj, i) => (
                  <div key={i} className="flex items-start gap-1.5 text-[8px] font-mono text-primary/60">
                    <span className="text-amber-400/40 flex-shrink-0">◦</span>
                    <span>{obj}</span>
                  </div>
                ))}
              </div>
            )}
            {quest.reward_hint && (
              <p className="text-[8px] font-mono text-amber-400/60 italic">
                ✦ {quest.reward_hint}
              </p>
            )}
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => onAccept(quest)}
                className="flex-1 py-1.5 border border-amber-400/40 bg-amber-400/10 text-amber-400 font-mono text-[8px] tracking-widest uppercase hover:bg-amber-400/20 transition-all"
              >
                Accept Quest
              </button>
              <button
                onClick={() => onDismiss(quest.id)}
                className="px-3 py-1.5 border border-primary/15 text-primary/30 font-mono text-[8px] tracking-widest uppercase hover:text-primary/60 transition-all"
              >
                Skip
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export default function SideQuestSuggestions({
  sessionId,
  characterId,
  recentMessages = [],
  inventoryItems = [],
  loreEntries = [],
  onQuestAccepted,
  messageCount = 0,
}) {
  const [suggestions, setSuggestions] = useState([]);
  const [dismissed, setDismissed] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const lastCheckRef = useRef(0);
  const CHECK_INTERVAL = 6; // check every 6 new messages

  useEffect(() => {
    // Only trigger when enough new messages have come in
    if (!sessionId || !characterId) return;
    if (messageCount - lastCheckRef.current < CHECK_INTERVAL) return;
    if (recentMessages.length < 4) return;

    lastCheckRef.current = messageCount;
    fetchSuggestions();
  }, [messageCount]);

  const fetchSuggestions = async () => {
    setLoading(true);
    try {
      const res = await base44.functions.invoke("suggestSideQuests", {
        session_id: sessionId,
        character_id: characterId,
        recent_messages: recentMessages.slice(-10),
        inventory_items: inventoryItems,
        lore_entries: loreEntries,
      });
      const newSuggestions = (res?.data?.suggestions || []).filter(
        s => !dismissed.has(s.id)
      );
      if (newSuggestions.length > 0) {
        setSuggestions(newSuggestions);
        setCollapsed(false);
      }
    } catch (err) {
      console.error("Side quest suggestions error:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleDismiss = (id) => {
    setDismissed(prev => new Set([...prev, id]));
    setSuggestions(prev => prev.filter(s => s.id !== id));
  };

  const handleAccept = (quest) => {
    handleDismiss(quest.id);
    onQuestAccepted?.(quest);
  };

  const visible = suggestions.filter(s => !dismissed.has(s.id));
  if (visible.length === 0 && !loading) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="border border-amber-400/20 bg-black/50 rounded overflow-hidden"
    >
      {/* Header */}
      <button
        onClick={() => setCollapsed(c => !c)}
        className="w-full flex items-center justify-between px-3 py-2 bg-amber-400/5 hover:bg-amber-400/10 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Scroll className="w-3.5 h-3.5 text-amber-400/70" />
          <span className="font-mono text-[9px] text-amber-400/70 tracking-widest uppercase">
            Side Quest Opportunities
          </span>
          {visible.length > 0 && (
            <span className="text-[7px] font-mono px-1.5 py-0.5 bg-amber-400/20 text-amber-400 border border-amber-400/30 rounded">
              {visible.length}
            </span>
          )}
          {loading && (
            <span className="text-[7px] font-mono text-amber-400/40 animate-pulse">analyzing…</span>
          )}
        </div>
        {collapsed ? <ChevronDown className="w-3 h-3 text-amber-400/40" /> : <ChevronUp className="w-3 h-3 text-amber-400/40" />}
      </button>

      {/* Quest cards */}
      <AnimatePresence>
        {!collapsed && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="divide-y divide-amber-400/10"
          >
            {visible.map(quest => (
              <SideQuestCard
                key={quest.id}
                quest={quest}
                onAccept={handleAccept}
                onDismiss={handleDismiss}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}