import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useConfirm } from "@/lib/ConfirmDialog";
import { useParams } from "react-router-dom";
import { Loader, Plus, Zap, CheckCircle2, AlertCircle, Clock } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import QuestCard from "@/components/quests/QuestCard";
import QuestForm from "@/components/quests/QuestForm";

export default function QuestLogPage() {
  const confirm = useConfirm();
  const { sessionId } = useParams();
  const [session, setSession] = useState(null);
  const [quests, setQuests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formLoading, setFormLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingQuest, setEditingQuest] = useState(null);
  const [filter, setFilter] = useState("all");
  const [parseLoading, setParseLoading] = useState(false);

  useEffect(() => {
    loadData();
  }, [sessionId]);

  const loadData = async () => {
    setLoading(true);
    try {
      // Load session
      let activeSession;
      if (sessionId) {
        const sessions = await base44.entities.ChatSession.list("-updated_date", 100);
        activeSession = sessions.find(s => s.id === sessionId);
      } else {
        const sessions = await base44.entities.ChatSession.list("-updated_date", 1);
        activeSession = sessions[0];
      }
      setSession(activeSession);

      // Load quests for this session
      if (activeSession?.id) {
        const questData = await base44.entities.Quest.filter(
          { session_id: activeSession.id },
          "-created_date",
          100
        );
        setQuests(questData || []);
      }
    } catch (err) {
      console.error("Error loading data:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateQuest = async (formData) => {
    setFormLoading(true);
    try {
      if (editingQuest) {
        await base44.entities.Quest.update(editingQuest.id, formData);
        setQuests(prev => prev.map(q => q.id === editingQuest.id ? { ...q, ...formData } : q));
      } else {
        const newQuest = await base44.entities.Quest.create({
          ...formData,
          session_id: session?.id,
          started_at: new Date().toISOString(),
        });
        setQuests(prev => [newQuest, ...prev]);
      }
      setShowForm(false);
      setEditingQuest(null);
    } catch (err) {
      console.error("Error saving quest:", err);
    } finally {
      setFormLoading(false);
    }
  };

  const handleStatusChange = async (questId, newStatus, objectives) => {
    try {
      const updateData = { status: newStatus };
      if (objectives) {
        updateData.objectives = objectives;
      }
      if (newStatus === "completed") {
        updateData.completed_at = new Date().toISOString();
      }

      await base44.entities.Quest.update(questId, updateData);
      setQuests(prev =>
        prev.map(q =>
          q.id === questId ? { ...q, ...updateData } : q
        )
      );
    } catch (err) {
      console.error("Error updating quest:", err);
    }
  };

  const handleDeleteQuest = async (questId) => {
    const ok = await confirm({
      title: "Delete this quest?",
      message: "This permanently removes the quest and cannot be undone.",
      confirmLabel: "Delete",
    });
    if (!ok) return;
    try {
      await base44.entities.Quest.delete(questId);
      setQuests(prev => prev.filter(q => q.id !== questId));
    } catch (err) {
      console.error("Error deleting quest:", err);
    }
  };

  const handleParseNarrative = async () => {
    if (!session?.messages) return;

    setParseLoading(true);
    try {
      // Get recent narrative messages
      const recentMessages = session.messages.slice(-10);
      const narrativeText = recentMessages.map(m => m.content).join(" ");

      // Call backend function to detect quests
      const result = await base44.functions.invoke("detectQuestsFromNarrative", {
        session_id: session.id,
        narrative_text: narrativeText,
        existing_quests: quests.map(q => ({ title: q.title, status: q.status })),
      });

      if (result?.data?.detected_quests?.length > 0) {
        // Add new detected quests
        const newQuests = [];
        for (const questData of result.data.detected_quests) {
          const quest = await base44.entities.Quest.create({
            ...questData,
            session_id: session.id,
            started_at: new Date().toISOString(),
          });
          newQuests.push(quest);
        }
        setQuests(prev => [...newQuests, ...prev]);
      }
    } catch (err) {
      console.error("Error parsing narrative:", err);
    } finally {
      setParseLoading(false);
    }
  };

  const handleEditQuest = (quest) => {
    setEditingQuest(quest);
    setShowForm(true);
  };

  // Filter quests
  const filteredQuests = filter === "all" 
    ? quests 
    : quests.filter(q => q.status === filter);

  const stats = {
    total: quests.length,
    active: quests.filter(q => q.status === "active").length,
    completed: quests.filter(q => q.status === "completed").length,
    failed: quests.filter(q => q.status === "failed").length,
  };

  if (loading) {
    return (
      <div className="flex-1 min-h-0 bg-background flex items-center justify-center">
        <div className="text-center">
          <Loader className="w-8 h-8 text-primary/50 animate-spin mx-auto mb-3" />
          <p className="font-mono text-[10px] text-primary/40 tracking-widest uppercase">
            Loading quest log...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-background p-4 sm:p-6 lg:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="border border-primary/20 bg-black/40 p-6 rounded hud-corner"
        >
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <h1 className="font-mono text-3xl tracking-[0.2em] uppercase text-primary glow-text mb-2">
                Quest Log
              </h1>
              <p className="font-mono text-[10px] text-primary/40 tracking-widest uppercase">
                {session?.title || "Active Session"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleParseNarrative}
                disabled={parseLoading || !session?.messages}
                className="flex items-center gap-2 px-4 py-2 bg-primary/10 border border-primary/40 text-primary hover:bg-primary/20 disabled:opacity-50 font-mono text-xs tracking-widest uppercase transition-all hud-corner glow-border"
              >
                {parseLoading ? (
                  <>
                    <Loader className="w-4 h-4 animate-spin" />
                    Parsing
                  </>
                ) : (
                  <>
                    <Zap className="w-4 h-4" />
                    Parse Narrative
                  </>
                )}
              </button>
              <button
                onClick={() => {
                  setEditingQuest(null);
                  setShowForm(true);
                }}
                className="flex items-center gap-2 px-4 py-2 bg-primary/10 border border-primary/40 text-primary hover:bg-primary/20 font-mono text-xs tracking-widest uppercase transition-all hud-corner glow-border"
              >
                <Plus className="w-4 h-4" /> New Quest
              </button>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[9px] font-mono">
            {[
              { icon: Clock, label: "Total", value: stats.total, color: "primary" },
              { icon: Clock, label: "Active", value: stats.active, color: "yellow" },
              { icon: CheckCircle2, label: "Completed", value: stats.completed, color: "green" },
              { icon: AlertCircle, label: "Failed", value: stats.failed, color: "red" },
            ].map((stat, idx) => {
              const Icon = stat.icon;
              return (
                <div key={idx} className={`p-3 border border-${stat.color}-400/20 bg-${stat.color}-400/5 rounded flex items-center gap-2`}>
                  <Icon className={`w-4 h-4 text-${stat.color}-400`} />
                  <div>
                    <p className={`text-${stat.color}-400/60 tracking-widest uppercase text-[8px]`}>
                      {stat.label}
                    </p>
                    <p className={`text-lg font-bold text-${stat.color}-400`}>{stat.value}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </motion.div>

        {/* Filter buttons */}
        <div className="flex flex-wrap gap-2">
          {["all", "active", "available", "completed", "failed"].map(status => (
            <button
              key={status}
              onClick={() => setFilter(status)}
              className={`px-4 py-2 font-mono text-[9px] tracking-widest uppercase transition-all border ${
                filter === status
                  ? "bg-primary/10 border-primary/40 text-primary"
                  : "border-primary/15 text-primary/40 hover:text-primary/70"
              }`}
            >
              {status === "all" ? "All Quests" : status.charAt(0).toUpperCase() + status.slice(1)}
            </button>
          ))}
        </div>

        {/* Quests list */}
        <div className="space-y-3">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader className="w-6 h-6 text-primary/50 animate-spin" />
            </div>
          ) : filteredQuests.length === 0 ? (
            <div className="text-center py-12 border border-primary/10 rounded bg-black/20">
              <AlertCircle className="w-12 h-12 text-primary/10 mx-auto mb-3" />
              <p className="font-mono text-[10px] text-primary/20 tracking-widest uppercase">
                No {filter === "all" ? "" : filter} quests
              </p>
            </div>
          ) : (
            <AnimatePresence>
              {filteredQuests.map(quest => (
                <QuestCard
                  key={quest.id}
                  quest={quest}
                  onStatusChange={handleStatusChange}
                  onDelete={handleDeleteQuest}
                  onEdit={handleEditQuest}
                  isLoading={formLoading}
                />
              ))}
            </AnimatePresence>
          )}
        </div>
      </div>

      {/* Quest form modal */}
      <AnimatePresence>
        {showForm && (
          <QuestForm
            quest={editingQuest}
            sessionId={session?.id}
            onSave={handleCreateQuest}
            onCancel={() => {
              setShowForm(false);
              setEditingQuest(null);
            }}
            loading={formLoading}
          />
        )}
      </AnimatePresence>
    </div>
  );
}