import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useParams } from "react-router-dom";
import { Package, Zap, TrendingUp, BookOpen, Loader } from "lucide-react";
import { motion } from "framer-motion";
import InventoryManager from "@/components/inventory/InventoryManager";

export default function InteractiveInventory() {
  const { sessionId, characterId } = useParams();
  const [session, setSession] = useState(null);
  const [character, setCharacter] = useState(null);
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [showNarrativeLog, setShowNarrativeLog] = useState(false);
  const [narrativeEvents, setNarrativeEvents] = useState([]);

  useEffect(() => {
    loadData();
  }, [sessionId, characterId]);

  const loadData = async () => {
    setLoading(true);
    try {
      // Load session and character
      const [sessions, chars] = await Promise.all([
        base44.entities.ChatSession.list("-updated_date", 1),
        base44.entities.Character.list("-created_date", 100),
      ]);

      const activeSession = sessions[0];
      const activeChar = activeSession?.character_id
        ? chars.find(c => c.id === activeSession.character_id)
        : chars[0];

      setSession(activeSession);
      setCharacter(activeChar);

      // Load items for this character
      if (activeChar?.id) {
        const invItems = await base44.entities.Inventory.filter(
          { character_id: activeChar.id },
          "-created_date",
          100
        );
        setItems(invItems || []);
      }
    } catch (err) {
      console.error("Error loading data:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleApplyNarrativeItems = async () => {
    if (!session || !character) return;

    const recentMessages = session.messages?.slice(-4) || [];
    const messageText = recentMessages.map(m => m.content).join(" ");

    try {
      const result = await base44.functions.invoke("applyNarrativeItemEvents", {
        session_id: session.id,
        character_id: character.id,
        message_content: messageText,
        ai_response: recentMessages[recentMessages.length - 1]?.content || "",
      });

      if (result?.data?.created?.length > 0) {
        setNarrativeEvents([
          ...narrativeEvents,
          {
            timestamp: new Date(),
            items: result.data.created,
            message: `Acquired ${result.data.items_acquired} item(s)`,
          },
        ]);
        // Reload items
        const updatedItems = await base44.entities.Inventory.filter(
          { character_id: character.id },
          "-created_date",
          100
        );
        setItems(updatedItems || []);
      }
    } catch (err) {
      console.error("Error applying narrative items:", err);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Loader className="w-8 h-8 text-primary/50 animate-spin mx-auto mb-3" />
          <p className="font-mono text-[10px] text-primary/40 tracking-widest uppercase">
            Loading inventory...
          </p>
        </div>
      </div>
    );
  }

  if (!character) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="text-center">
          <Package className="w-12 h-12 text-primary/20 mx-auto mb-3" />
          <p className="font-mono text-sm text-primary/40 tracking-widest uppercase">
            No character selected
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4 sm:p-6 lg:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="border border-primary/20 bg-black/40 p-6 rounded hud-corner"
        >
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <h1 className="font-mono text-3xl tracking-[0.2em] uppercase text-primary glow-text mb-2">
                Character Inventory
              </h1>
              <p className="font-mono text-[10px] text-primary/40 tracking-widest uppercase">
                {character.name || "Unknown Character"}
                {session && <span> · Session: {session.title}</span>}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowNarrativeLog(!showNarrativeLog)}
                title="Narrative item events log"
                className="p-2.5 border border-primary/20 text-primary/40 hover:text-primary hover:border-primary/40 transition-all rounded relative"
              >
                <BookOpen className="w-5 h-5" />
                {narrativeEvents.length > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 bg-primary/60 rounded-full flex items-center justify-center text-[8px] font-mono text-background">
                    {narrativeEvents.length}
                  </span>
                )}
              </button>
              <button
                onClick={handleApplyNarrativeItems}
                title="Scan recent narrative for item acquisitions"
                className="p-2.5 border border-primary/20 text-primary/40 hover:text-primary hover:border-primary/40 transition-all rounded"
              >
                <Zap className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Character info */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[9px] font-mono">
            {[
              { label: "Total Items", value: items.length, color: "primary" },
              { label: "Equipped", value: items.filter(i => i.equipped).length, color: "green" },
              { label: "Weapons", value: items.filter(i => i.type === "weapon").length, color: "red" },
              { label: "Artifacts", value: items.filter(i => i.type === "artifact").length, color: "yellow" },
            ].map((stat, idx) => (
              <div key={idx} className={`p-2 border border-${stat.color}-400/20 bg-${stat.color}-400/5 rounded`}>
                <p className={`text-${stat.color}-400/60 tracking-widest uppercase`}>{stat.label}</p>
                <p className={`text-lg font-bold text-${stat.color}-400 mt-1`}>{stat.value}</p>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Main inventory manager */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="border border-primary/20 bg-black/40 p-6 rounded"
        >
          <InventoryManager
            characterId={character.id}
            sessionId={session?.id}
            onItemsChange={setItems}
          />
        </motion.div>

        {/* Narrative events log */}
        {showNarrativeLog && narrativeEvents.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="border border-cyan-400/30 bg-cyan-400/5 p-6 rounded space-y-4"
          >
            <h2 className="font-mono text-lg tracking-[0.2em] uppercase text-cyan-400 glow-text">
              Narrative Item Events
            </h2>
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {narrativeEvents.map((event, idx) => (
                <div
                  key={idx}
                  className="p-3 border border-cyan-400/20 bg-black/40 rounded text-[9px] font-mono"
                >
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-cyan-400 font-semibold">{event.message}</p>
                    <p className="text-cyan-400/40 text-[8px]">
                      {new Date(event.timestamp).toLocaleTimeString()}
                    </p>
                  </div>
                  <div className="space-y-1">
                    {event.items.map((item, itemIdx) => (
                      <div key={itemIdx} className="text-cyan-300/70 ml-2">
                        • {item.name} ({item.type})
                        {item.quantity > 1 && ` x${item.quantity}`}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}