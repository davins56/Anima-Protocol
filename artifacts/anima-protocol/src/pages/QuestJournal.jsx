import { useState, useEffect, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { useConfirm } from "@/lib/ConfirmDialog";
import { Link, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft, Scroll, Search, CheckCircle2, Clock, AlertCircle,
  Sword, Star, Filter, RefreshCw, TrendingUp, Trophy, Target,
  BookOpen, ChevronDown, ChevronUp, Trash2, Check, X, Zap
} from "lucide-react";
import { format } from "date-fns";

// ── Config ────────────────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  available: { label: "Available",   color: "text-primary/50",  border: "border-primary/20",    bg: "bg-primary/5",    Icon: Clock },
  active:    { label: "In Progress", color: "text-yellow-400",  border: "border-yellow-400/30", bg: "bg-yellow-400/5", Icon: Sword },
  completed: { label: "Completed",   color: "text-green-400",   border: "border-green-400/30",  bg: "bg-green-400/5",  Icon: CheckCircle2 },
  failed:    { label: "Failed",      color: "text-red-400",     border: "border-red-400/30",    bg: "bg-red-400/5",    Icon: AlertCircle },
  abandoned: { label: "Abandoned",   color: "text-gray-500",    border: "border-gray-500/20",   bg: "bg-gray-500/5",   Icon: X },
};

const DIFFICULTY_CONFIG = {
  trivial:  { label: "Trivial",    color: "text-gray-400" },
  easy:     { label: "Easy",       color: "text-green-400" },
  moderate: { label: "Moderate",   color: "text-yellow-400" },
  hard:     { label: "Hard",       color: "text-red-400" },
  legendary:{ label: "Legendary",  color: "text-purple-400" },
};

const FILTER_TABS = ["all", "active", "available", "completed", "failed", "abandoned"];

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({ icon: Icon, label, value, color }) {
  return (
    <div className="border border-primary/15 bg-black/40 px-4 py-3 flex items-center gap-3">
      <Icon className={`w-4 h-4 ${color}`} />
      <div>
        <p className="font-mono text-xl font-bold text-primary">{value}</p>
        <p className="font-mono text-[8px] text-primary/40 tracking-widest uppercase">{label}</p>
      </div>
    </div>
  );
}

function ObjectiveRow({ obj, questId, onToggle, disabled }) {
  return (
    <label className={`flex items-start gap-2 p-2 border cursor-pointer transition-all ${
      obj.completed ? "border-green-400/20 bg-green-400/5" : "border-primary/10 bg-black/30 hover:border-primary/25"
    }`}>
      <input
        type="checkbox"
        checked={!!obj.completed}
        onChange={() => onToggle(obj, !obj.completed)}
        disabled={disabled}
        className="mt-0.5 accent-green-400 cursor-pointer"
      />
      <span className={`font-mono text-[10px] leading-relaxed ${obj.completed ? "line-through text-primary/30" : "text-primary/70"}`}>
        {obj.description}
      </span>
    </label>
  );
}

function QuestRow({ quest, characters, sessions, onStatusChange, onObjectiveToggle, onDelete, loading }) {
  const [expanded, setExpanded] = useState(false);
  const cfg = STATUS_CONFIG[quest.status] || STATUS_CONFIG.available;
  const diff = DIFFICULTY_CONFIG[quest.difficulty] || DIFFICULTY_CONFIG.moderate;
  const { Icon } = cfg;

  const completed = quest.objectives?.filter(o => o.completed).length || 0;
  const total = quest.objectives?.length || 0;
  const progress = total > 0 ? Math.round((completed / total) * 100) : 0;

  const sessionTitle = sessions.find(s => s.id === quest.session_id)?.title;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className={`border overflow-hidden ${cfg.border} ${cfg.bg}`}
    >
      {/* Header row */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-start gap-3 p-4 text-left hover:opacity-80 transition-opacity"
      >
        <Icon className={`w-4 h-4 flex-shrink-0 mt-0.5 ${cfg.color}`} />
        <div className="flex-1 min-w-0">
          <p className="font-mono text-sm font-semibold tracking-wide truncate">{quest.title}</p>
          <div className="flex flex-wrap items-center gap-2 mt-1">
            <span className={`text-[8px] font-mono tracking-widest uppercase ${diff.color}`}>{diff.label}</span>
            <span className={`text-[8px] font-mono tracking-widest uppercase ${cfg.color}`}>{cfg.label}</span>
            {total > 0 && (
              <span className="text-[8px] font-mono text-primary/40">{completed}/{total} objectives</span>
            )}
            {sessionTitle && (
              <span className="text-[7px] font-mono text-primary/25 truncate max-w-[120px]">
                ◦ {sessionTitle}
              </span>
            )}
          </div>
          {/* Progress bar */}
          {total > 0 && (
            <div className="mt-2 h-1 bg-primary/10 rounded-full overflow-hidden w-full max-w-xs">
              <motion.div
                className="h-full bg-green-400/60 rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.4 }}
              />
            </div>
          )}
        </div>
        {quest.rewards?.xp > 0 && (
          <span className="flex-shrink-0 text-[8px] font-mono text-yellow-400/70 flex items-center gap-1">
            <Star className="w-2.5 h-2.5" />{quest.rewards.xp} XP
          </span>
        )}
        {expanded ? <ChevronUp className="w-3.5 h-3.5 text-primary/30 flex-shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 text-primary/30 flex-shrink-0" />}
      </button>

      {/* Expanded body */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="border-t border-primary/10 overflow-hidden"
          >
            <div className="p-4 space-y-4">
              {quest.description && (
                <p className="font-mono text-[10px] text-primary/60 leading-relaxed">{quest.description}</p>
              )}

              {/* Objectives */}
              {total > 0 && (
                <div>
                  <p className="font-mono text-[8px] text-primary/40 tracking-widest uppercase mb-2">
                    Objectives ({completed}/{total})
                  </p>
                  <div className="space-y-1">
                    {quest.objectives.map((obj, idx) => (
                      <ObjectiveRow
                        key={obj.id || idx}
                        obj={obj}
                        questId={quest.id}
                        onToggle={(o, val) => onObjectiveToggle(quest, idx, val)}
                        disabled={loading || quest.status === "completed" || quest.status === "failed"}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Rewards */}
              {quest.rewards && (quest.rewards.xp > 0 || quest.rewards.items?.length > 0) && (
                <div>
                  <p className="font-mono text-[8px] text-primary/40 tracking-widest uppercase mb-1.5">Rewards</p>
                  <div className="space-y-1 text-[10px] font-mono">
                    {quest.rewards.xp > 0 && (
                      <p className="text-yellow-400/80">⭐ {quest.rewards.xp} XP</p>
                    )}
                    {quest.rewards.items?.map((item, i) => (
                      <p key={i} className="text-primary/60">📦 {item}</p>
                    ))}
                  </div>
                </div>
              )}

              {/* Narrative context */}
              {quest.narrative_context && (
                <div>
                  <p className="font-mono text-[8px] text-primary/30 tracking-widest uppercase mb-1">Context</p>
                  <p className="font-mono text-[9px] text-primary/40 italic leading-relaxed">{quest.narrative_context}</p>
                </div>
              )}

              {/* Timeline */}
              <div className="text-[7px] font-mono text-primary/25 space-y-0.5 border-t border-primary/10 pt-2">
                {quest.started_at && <p>Started: {format(new Date(quest.started_at), "MMM d, yyyy · h:mm a")}</p>}
                {quest.completed_at && <p>Completed: {format(new Date(quest.completed_at), "MMM d, yyyy · h:mm a")}</p>}
                <p>Created: {format(new Date(quest.created_date), "MMM d, yyyy")}</p>
              </div>

              {/* Actions */}
              <div className="flex flex-wrap gap-2 pt-1">
                {quest.status === "active" && (
                  <button
                    onClick={() => onStatusChange(quest.id, "completed")}
                    disabled={loading}
                    className="px-3 py-1.5 bg-green-400/10 border border-green-400/30 text-green-400 hover:bg-green-400/20 disabled:opacity-40 font-mono text-[8px] tracking-widest uppercase transition-all flex items-center gap-1"
                  >
                    <Check className="w-3 h-3" /> Mark Complete
                  </button>
                )}
                {(quest.status === "active" || quest.status === "available") && (
                  <button
                    onClick={() => onStatusChange(quest.id, "failed")}
                    disabled={loading}
                    className="px-3 py-1.5 bg-red-400/10 border border-red-400/30 text-red-400 hover:bg-red-400/20 disabled:opacity-40 font-mono text-[8px] tracking-widest uppercase transition-all"
                  >
                    Fail
                  </button>
                )}
                {quest.status !== "active" && quest.status !== "completed" && (
                  <button
                    onClick={() => onStatusChange(quest.id, "active")}
                    disabled={loading}
                    className="px-3 py-1.5 bg-yellow-400/10 border border-yellow-400/30 text-yellow-400 hover:bg-yellow-400/20 disabled:opacity-40 font-mono text-[8px] tracking-widest uppercase transition-all"
                  >
                    Activate
                  </button>
                )}
                <button
                  onClick={() => onDelete(quest.id)}
                  disabled={loading}
                  className="ml-auto px-2.5 py-1.5 border border-red-900/20 text-red-900/40 hover:text-red-400 hover:border-red-400/30 font-mono text-[8px] transition-all"
                  title="Delete quest"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function QuestJournal() {
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [quests, setQuests] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [characters, setCharacters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState(false);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("updated"); // "updated" | "difficulty" | "progress"
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState(null); // { found, added }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [qs, ss, cs] = await Promise.all([
        base44.entities.Quest.list("-updated_date", 200),
        base44.entities.ChatSession.list("-updated_date", 100),
        base44.entities.Character.list("-created_date", 200),
      ]);
      setQuests(qs || []);
      setSessions(ss || []);
      setCharacters(cs || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleStatusChange = async (questId, newStatus) => {
    setMutating(true);
    const updates = { status: newStatus };
    if (newStatus === "active" && !quests.find(q => q.id === questId)?.started_at) {
      updates.started_at = new Date().toISOString();
    }
    if (newStatus === "completed") {
      updates.completed_at = new Date().toISOString();
    }
    await base44.entities.Quest.update(questId, updates);
    setQuests(prev => prev.map(q => q.id === questId ? { ...q, ...updates } : q));
    setMutating(false);
  };

  const handleObjectiveToggle = async (quest, idx, newVal) => {
    const updated = quest.objectives.map((o, i) =>
      i === idx ? { ...o, completed: newVal } : o
    );
    setMutating(true);
    await base44.entities.Quest.update(quest.id, { objectives: updated });
    setQuests(prev => prev.map(q => q.id === quest.id ? { ...q, objectives: updated } : q));
    setMutating(false);
  };

  const handleDelete = async (questId) => {
    const ok = await confirm({
      title: "Delete this quest?",
      message: "This permanently removes the quest and cannot be undone.",
      confirmLabel: "Delete",
    });
    if (!ok) return;
    setMutating(true);
    await base44.entities.Quest.delete(questId);
    setQuests(prev => prev.filter(q => q.id !== questId));
    setMutating(false);
  };

  const handleScanSessions = async () => {
    setScanning(true);
    setScanResult(null);
    try {
      const allSessions = await base44.entities.ChatSession.list("-updated_date", 20);
      const existingQuests = await base44.entities.Quest.list("-created_date", 200);

      let totalFound = 0;
      let totalAdded = 0;

      for (const session of allSessions) {
        const messages = session.messages || [];
        if (messages.length < 3) continue;

        // Build narrative text from last 30 messages
        const narrativeText = messages
          .slice(-30)
          .filter(m => m.content && m.character_name !== "__typing__" && m.character_name !== "__thinking__")
          .map(m => m.content)
          .join(" ");

        if (!narrativeText || narrativeText.length < 50) continue;

        const sessionQuests = existingQuests.filter(q => q.session_id === session.id);

        const result = await base44.functions.invoke("detectQuestsFromNarrative", {
          session_id: session.id,
          narrative_text: narrativeText,
          existing_quests: sessionQuests.map(q => ({ title: q.title })),
        });

        const detected = result?.data?.detected_quests || [];
        totalFound += detected.length;

        for (const q of detected) {
          await base44.entities.Quest.create({
            session_id: session.id,
            title: q.title,
            description: q.description || "Detected from narrative",
            difficulty: q.difficulty || "moderate",
            status: "active",
            objectives: q.objectives || [{ description: q.description || "Complete the quest", completed: false }],
            rewards: q.rewards || { xp: 250, items: [] },
            narrative_context: "Auto-detected from session narrative",
            started_at: new Date().toISOString(),
          });
          totalAdded++;
        }
      }

      setScanResult({ found: totalFound, added: totalAdded });
      await load();
    } catch (err) {
      console.error("Scan error:", err);
      setScanResult({ found: 0, added: 0, error: err.message });
    } finally {
      setScanning(false);
    }
  };

  const handleCompleteQuest = async (questId) => {
    setMutating(true);
    const quest = quests.find(q => q.id === questId);
    const updates = { status: "completed", completed_at: new Date().toISOString() };
    await base44.entities.Quest.update(questId, updates);

    // Award XP to resonance profile
    if (quest?.rewards?.xp) {
      try {
        const user = await base44.auth.me();
        const profiles = await base44.entities.ResonanceProfile.filter({ user_email: user.email });
        if (profiles.length > 0) {
          const profile = profiles[0];
          const newXP = (profile.resonance_xp || 0) + quest.rewards.xp;
          await base44.entities.ResonanceProfile.update(profile.id, { resonance_xp: newXP });
        }
      } catch (_) { /* non-critical */ }
    }

    setQuests(prev => prev.map(q => q.id === questId ? { ...q, ...updates } : q));
    setMutating(false);
  };

  // Stats
  const stats = {
    total: quests.length,
    active: quests.filter(q => q.status === "active").length,
    completed: quests.filter(q => q.status === "completed").length,
    totalXP: quests.filter(q => q.status === "completed").reduce((s, q) => s + (q.rewards?.xp || 0), 0),
  };

  // Filter + search + sort
  const filtered = quests
    .filter(q => filter === "all" || q.status === filter)
    .filter(q => !search || q.title.toLowerCase().includes(search.toLowerCase()) || q.description?.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (sortBy === "difficulty") {
        const order = { legendary: 0, hard: 1, moderate: 2, easy: 3, trivial: 4 };
        return (order[a.difficulty] ?? 2) - (order[b.difficulty] ?? 2);
      }
      if (sortBy === "progress") {
        const prog = q => q.objectives?.length ? q.objectives.filter(o => o.completed).length / q.objectives.length : 0;
        return prog(b) - prog(a);
      }
      return new Date(b.updated_date) - new Date(a.updated_date);
    });

  return (
    <div className="flex-1 min-h-0 overflow-y-auto flex flex-col bg-background pb-20">
      {/* Header */}
      <div className="sticky top-0 z-20 border-b border-primary/20 bg-black/90 backdrop-blur-md">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="p-1.5 text-primary/40 hover:text-primary transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <Scroll className="w-4 h-4 text-primary/60" />
          <div className="flex-1 min-w-0">
            <h1 className="font-mono text-sm tracking-[0.2em] uppercase text-primary">Quest Journal</h1>
            <p className="font-mono text-[8px] text-primary/30 tracking-widest uppercase">
              {stats.total} quests · {stats.active} active · {stats.totalXP.toLocaleString()} XP earned
            </p>
          </div>
          <button
            onClick={handleScanSessions}
            disabled={scanning || loading}
            title="Scan all sessions for new quests"
            className="flex items-center gap-1.5 px-3 py-1.5 border border-yellow-400/30 bg-yellow-400/5 text-yellow-400 hover:bg-yellow-400/10 disabled:opacity-30 font-mono text-[8px] tracking-widest uppercase transition-all"
          >
            {scanning ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
            {scanning ? "Scanning…" : "Scan"}
          </button>
          <button
            onClick={load}
            disabled={loading}
            className="p-1.5 text-primary/30 hover:text-primary transition-colors disabled:opacity-30"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      <div className="max-w-3xl mx-auto w-full px-4 py-6 space-y-6">

        {/* Scan result banner */}
        {scanResult && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className={`flex items-center justify-between px-4 py-3 border font-mono text-[10px] ${
              scanResult.error
                ? "border-red-400/30 bg-red-400/5 text-red-400"
                : scanResult.added > 0
                ? "border-green-400/30 bg-green-400/5 text-green-400"
                : "border-primary/20 bg-black/40 text-primary/50"
            }`}
          >
            <span>
              {scanResult.error
                ? `Scan error: ${scanResult.error}`
                : scanResult.added > 0
                ? `✦ Found ${scanResult.found} quest${scanResult.found !== 1 ? "s" : ""} — added ${scanResult.added} new`
                : "No new quests detected in recent sessions"}
            </span>
            <button onClick={() => setScanResult(null)} className="opacity-50 hover:opacity-100">
              <X className="w-3.5 h-3.5" />
            </button>
          </motion.div>
        )}

        {/* Stats strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <StatCard icon={Scroll}       label="Total Quests"  value={stats.total}     color="text-primary/60" />
          <StatCard icon={Sword}        label="Active"        value={stats.active}    color="text-yellow-400" />
          <StatCard icon={Trophy}       label="Completed"     value={stats.completed} color="text-green-400" />
          <StatCard icon={Star}         label="XP Earned"     value={stats.totalXP.toLocaleString()} color="text-yellow-400" />
        </div>

        {/* Progress overview */}
        {stats.total > 0 && (
          <div className="border border-primary/15 bg-black/40 p-4 space-y-2">
            <div className="flex items-center justify-between">
              <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase flex items-center gap-1.5">
                <TrendingUp className="w-3 h-3" /> Overall Completion
              </p>
              <p className="font-mono text-[9px] text-primary/60">
                {stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0}%
              </p>
            </div>
            <div className="h-1.5 bg-primary/10 rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-green-400/60 rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${stats.total > 0 ? (stats.completed / stats.total) * 100 : 0}%` }}
                transition={{ duration: 0.6, ease: "easeOut" }}
              />
            </div>
            <div className="flex gap-4 text-[7px] font-mono text-primary/25">
              {Object.entries(STATUS_CONFIG).map(([key, cfg]) => {
                const count = quests.filter(q => q.status === key).length;
                if (count === 0) return null;
                return (
                  <span key={key} className={cfg.color}>
                    {cfg.label}: {count}
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {/* Search + Sort */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-primary/30" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search quests…"
              className="w-full bg-black/50 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-xs pl-8 pr-3 py-2 focus:outline-none focus:border-primary/40 transition-colors"
            />
          </div>
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value)}
            className="bg-black/50 border border-primary/20 text-primary/60 font-mono text-[9px] px-2 py-2 focus:outline-none focus:border-primary/40 tracking-widest uppercase"
          >
            <option value="updated">Recent</option>
            <option value="difficulty">Difficulty</option>
            <option value="progress">Progress</option>
          </select>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1 flex-wrap">
          {FILTER_TABS.map(tab => {
            const count = tab === "all" ? quests.length : quests.filter(q => q.status === tab).length;
            const cfg = STATUS_CONFIG[tab];
            return (
              <button
                key={tab}
                onClick={() => setFilter(tab)}
                className={`px-3 py-1.5 border font-mono text-[8px] tracking-widest uppercase transition-all flex items-center gap-1.5 ${
                  filter === tab
                    ? (cfg ? `${cfg.border} ${cfg.bg} ${cfg.color}` : "border-primary/40 bg-primary/10 text-primary")
                    : "border-primary/10 text-primary/30 hover:text-primary/60 hover:border-primary/20"
                }`}
              >
                {tab === "all" ? <Filter className="w-2.5 h-2.5" /> : cfg && <cfg.Icon className="w-2.5 h-2.5" />}
                {tab === "all" ? "All" : STATUS_CONFIG[tab]?.label || tab}
                <span className="text-[7px] opacity-60">({count})</span>
              </button>
            );
          })}
        </div>

        {/* Quest list */}
        {loading ? (
          <div className="text-center py-16">
            <RefreshCw className="w-5 h-5 text-primary/30 animate-spin mx-auto mb-3" />
            <p className="font-mono text-[9px] text-primary/30 tracking-widest uppercase animate-pulse">
              Loading journal…
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 space-y-3">
            <BookOpen className="w-8 h-8 text-primary/15 mx-auto" />
            <p className="font-mono text-[9px] text-primary/25 tracking-widest uppercase">
              {search ? "No quests match your search" : filter === "all" ? "No quests recorded yet" : `No ${filter} quests`}
            </p>
            <p className="font-mono text-[8px] text-primary/15">
              Quests are detected automatically during chat sessions
            </p>
            <Link
              to="/"
              className="inline-flex items-center gap-1.5 px-4 py-2 border border-primary/25 text-primary/50 hover:text-primary hover:border-primary/40 font-mono text-[9px] tracking-widest uppercase transition-all mt-2"
            >
              <Sword className="w-3 h-3" /> Start a Session
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="font-mono text-[8px] text-primary/25 tracking-widest px-1">
              Showing {filtered.length} of {quests.length} quests
            </p>
            <AnimatePresence>
              {filtered.map(quest => (
                <QuestRow
                  key={quest.id}
                  quest={quest}
                  sessions={sessions}
                  characters={characters}
                  onStatusChange={(id, status) =>
                    status === "completed" ? handleCompleteQuest(id) : handleStatusChange(id, status)
                  }
                  onObjectiveToggle={handleObjectiveToggle}
                  onDelete={handleDelete}
                  loading={mutating}
                />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}