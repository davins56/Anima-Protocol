import { useState, useEffect, useRef } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft, Globe, RefreshCw, Zap, Scroll, Sword,
  Brain, TrendingUp, AlertCircle, CheckCircle2, ChevronDown, ChevronUp,
  BookOpen, Activity, Clock
} from "lucide-react";
import { format } from "date-fns";
import { AreaChart, Area, XAxis, Tooltip, ResponsiveContainer } from "recharts";

// ── Config ────────────────────────────────────────────────────────────────────

const TYPE_CONFIG = {
  lore:          { label: "Lore",        Icon: BookOpen,     color: "text-cyan-400",    bg: "bg-cyan-400/10",    border: "border-cyan-400/25"    },
  quest:         { label: "Quest",       Icon: Sword,        color: "text-yellow-400",  bg: "bg-yellow-400/10",  border: "border-yellow-400/25"  },
  arc:           { label: "Narrative Arc",Icon: Scroll,      color: "text-purple-400",  bg: "bg-purple-400/10",  border: "border-purple-400/25"  },
  memory:        { label: "Character",   Icon: Brain,        color: "text-pink-400",    bg: "bg-pink-400/10",    border: "border-pink-400/25"    },
};

const IMPORTANCE_COLOR = {
  low:      "text-primary/40",
  medium:   "text-cyan-400",
  high:     "text-yellow-400",
  critical: "text-red-400",
};

const MOOD_COLORS = {
  Turbulent:  "#f87171",
  Darkening:  "#a78bfa",
  Volatile:   "#fb923c",
  Hopeful:    "#34d399",
  Peaceful:   "#60a5fa",
  Ascending:  "#fbbf24",
  Shifting:   "#94a3b8",
};

const FILTER_TYPES = ["all", "lore", "quest", "arc", "memory"];

// ── Sub-components ─────────────────────────────────────────────────────────────

function ImpactChart({ epochs }) {
  const data = epochs.map((ep, i) => ({
    epoch: `E${i + 1}`,
    impact: ep.cumulative_at_end,
    epochImpact: ep.total_impact,
    mood: ep.mood,
  }));

  return (
    <div className="border border-primary/15 bg-black/40 p-4">
      <p className="font-mono text-[8px] text-primary/40 tracking-widest uppercase mb-3 flex items-center gap-1.5">
        <Activity className="w-3 h-3" /> Cumulative World Impact
      </p>
      <ResponsiveContainer width="100%" height={80}>
        <AreaChart data={data}>
          <defs>
            <linearGradient id="impactGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="hsl(185 100% 50%)" stopOpacity={0.3} />
              <stop offset="95%" stopColor="hsl(185 100% 50%)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="epoch" tick={{ fontSize: 8, fontFamily: "monospace", fill: "rgba(0,229,229,0.4)" }} axisLine={false} tickLine={false} />
          <Tooltip
            contentStyle={{ background: "#030a10", border: "1px solid rgba(0,229,229,0.2)", fontFamily: "monospace", fontSize: 10 }}
            labelStyle={{ color: "rgba(0,229,229,0.7)" }}
            formatter={(v, n) => [v, n === "impact" ? "Cumulative" : "Epoch"]}
          />
          <Area type="monotone" dataKey="impact" stroke="hsl(185 100% 50%)" strokeWidth={1.5} fill="url(#impactGrad)" dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function EventCard({ event, index }) {
  const [expanded, setExpanded] = useState(false);
  const cfg = TYPE_CONFIG[event.type] || TYPE_CONFIG.lore;
  const { Icon } = cfg;
  const importColor = IMPORTANCE_COLOR[event.importance] || IMPORTANCE_COLOR.medium;

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.03 }}
      className={`border ${cfg.border} ${cfg.bg} overflow-hidden`}
    >
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-start gap-3 px-3 py-2.5 text-left hover:opacity-80 transition-opacity"
      >
        <Icon className={`w-3.5 h-3.5 flex-shrink-0 mt-0.5 ${cfg.color}`} />
        <div className="flex-1 min-w-0">
          <p className={`font-mono text-[10px] font-semibold truncate ${cfg.color}`}>{event.title}</p>
          {event.description && (
            <p className="font-mono text-[9px] text-primary/50 truncate mt-0.5">{event.description}</p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className={`font-mono text-[7px] tracking-widest uppercase ${importColor}`}>
            {event.importance}
          </span>
          <span className="font-mono text-[7px] text-primary/25">
            +{event.impact_weight}
          </span>
          {expanded ? <ChevronUp className="w-3 h-3 text-primary/20" /> : <ChevronDown className="w-3 h-3 text-primary/20" />}
        </div>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="border-t border-primary/10 px-3 py-2.5 space-y-2"
          >
            {event.description && (
              <p className="font-mono text-[9px] text-primary/60 leading-relaxed">{event.description}</p>
            )}
            <div className="flex flex-wrap gap-3 text-[7px] font-mono text-primary/30">
              <span>[{event.type}]</span>
              {event.category && event.category !== event.type && <span>[{event.category}]</span>}
              {event.status && <span>Status: {event.status}</span>}
              {event.xp > 0 && <span>⭐ {event.xp} XP</span>}
              {event.arc_type && <span>Arc: {event.arc_type}</span>}
              {event.source_message_index && <span>@ Msg #{event.source_message_index}</span>}
              <span className="text-primary/20">{format(new Date(event.date), "MMM d, yyyy · h:mm a")}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function EpochBlock({ epoch, index, filterType }) {
  const [collapsed, setCollapsed] = useState(false);
  const moodColor = MOOD_COLORS[epoch.mood] || MOOD_COLORS.Shifting;

  const visibleEvents = filterType === "all"
    ? epoch.events
    : epoch.events.filter(e => e.type === filterType);

  if (visibleEvents.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.08 }}
      className="relative"
    >
      {/* Epoch header */}
      <div className="flex items-start gap-4 mb-3">
        {/* Timeline spine */}
        <div className="flex flex-col items-center flex-shrink-0 w-8">
          <div
            className="w-8 h-8 rounded-full border-2 flex items-center justify-center font-mono text-[9px] font-bold"
            style={{ borderColor: moodColor, color: moodColor, background: `${moodColor}15` }}
          >
            {index + 1}
          </div>
          <div className="w-0.5 flex-1 min-h-8 mt-1 opacity-30" style={{ background: moodColor }} />
        </div>

        {/* Epoch info */}
        <div className="flex-1 min-w-0">
          <button
            onClick={() => setCollapsed(c => !c)}
            className="w-full text-left"
          >
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <span
                  className="font-mono text-xs font-bold tracking-wider uppercase"
                  style={{ color: moodColor }}
                >
                  {epoch.mood}
                </span>
                <span className="font-mono text-[8px] text-primary/30 ml-2">
                  Epoch {index + 1} · {epoch.events.length} events · +{epoch.total_impact} impact
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-[7px] text-primary/25">
                  {epoch.start_date ? format(new Date(epoch.start_date), "MMM d") : ""}
                  {epoch.end_date && epoch.end_date !== epoch.start_date ? ` – ${format(new Date(epoch.end_date), "MMM d")}` : ""}
                </span>
                {collapsed ? <ChevronDown className="w-3.5 h-3.5 text-primary/30" /> : <ChevronUp className="w-3.5 h-3.5 text-primary/30" />}
              </div>
            </div>

            {/* Annotation */}
            {epoch.annotation && (
              <p className="font-mono text-[9px] text-primary/55 leading-relaxed mt-1.5 italic">
                {epoch.annotation}
              </p>
            )}

            {/* Cumulative bar */}
            <div className="mt-2 flex items-center gap-2">
              <div className="flex-1 h-1 bg-primary/10 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{ width: `${Math.min(100, (epoch.cumulative_at_end / 100) * 100)}%`, background: moodColor, opacity: 0.7 }}
                />
              </div>
              <span className="font-mono text-[7px] text-primary/30 w-12 text-right">
                Σ {epoch.cumulative_at_end}
              </span>
            </div>
          </button>

          {/* Events list */}
          <AnimatePresence>
            {!collapsed && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-3 space-y-1.5 overflow-hidden"
              >
                {visibleEvents.map((ev, i) => (
                  <EventCard key={ev.id} event={ev} index={i} />
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function WorldTimeline() {
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get("session");

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState("all");
  const [error, setError] = useState(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await base44.functions.invoke("compileWorldTimeline", {
        session_id: sessionId || undefined,
      });
      setData(res.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [sessionId]);

  const epochs = data?.epochs || [];
  const totalEvents = data?.total_events || 0;
  const totalImpact = data?.total_impact || 0;

  // Stats by type
  const typeCounts = {};
  for (const ep of epochs) {
    for (const ev of ep.events) {
      typeCounts[ev.type] = (typeCounts[ev.type] || 0) + 1;
    }
  }

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background pb-20">
      {/* Header */}
      <div className="sticky top-0 z-20 border-b border-primary/20 bg-black/90 backdrop-blur-md">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link to="/" className="p-1.5 text-primary/40 hover:text-primary transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <Globe className="w-4 h-4 text-primary/60" />
          <div className="flex-1 min-w-0">
            <h1 className="font-mono text-sm tracking-[0.2em] uppercase text-primary">World Impact Timeline</h1>
            <p className="font-mono text-[8px] text-primary/30 tracking-widest uppercase">
              {totalEvents} events · Σ{totalImpact} cumulative impact
              {sessionId ? " · This session" : " · All sessions"}
            </p>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="p-1.5 text-primary/30 hover:text-primary transition-colors disabled:opacity-30"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      <div className="max-w-3xl mx-auto w-full px-4 py-6 space-y-5">

        {loading ? (
          <div className="text-center py-24 space-y-3">
            <RefreshCw className="w-6 h-6 text-primary/30 animate-spin mx-auto" />
            <p className="font-mono text-[9px] text-primary/30 tracking-widest uppercase animate-pulse">
              Compiling world history…
            </p>
            <p className="font-mono text-[8px] text-primary/15">
              Analyzing quests, lore, character arcs & interactions
            </p>
          </div>
        ) : error ? (
          <div className="text-center py-16 space-y-3">
            <AlertCircle className="w-6 h-6 text-red-400/50 mx-auto" />
            <p className="font-mono text-[9px] text-red-400/70">{error}</p>
          </div>
        ) : totalEvents === 0 ? (
          <div className="text-center py-24 space-y-3">
            <Globe className="w-8 h-8 text-primary/15 mx-auto" />
            <p className="font-mono text-[9px] text-primary/25 tracking-widest uppercase">No world events recorded yet</p>
            <p className="font-mono text-[8px] text-primary/15">Start a chat session to begin shaping the world</p>
            <Link
              to="/"
              className="inline-flex items-center gap-1.5 px-4 py-2 border border-primary/25 text-primary/50 hover:text-primary font-mono text-[9px] tracking-widest uppercase transition-all mt-2"
            >
              Begin Session
            </Link>
          </div>
        ) : (
          <>
            {/* Stat strip */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {Object.entries(TYPE_CONFIG).map(([type, cfg]) => {
                const { Icon } = cfg;
                return (
                  <div key={type} className={`border ${cfg.border} ${cfg.bg} px-3 py-2.5 flex items-center gap-2`}>
                    <Icon className={`w-4 h-4 ${cfg.color}`} />
                    <div>
                      <p className={`font-mono text-lg font-bold ${cfg.color}`}>{typeCounts[type] || 0}</p>
                      <p className="font-mono text-[7px] text-primary/30 tracking-widest uppercase">{cfg.label}</p>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Impact chart */}
            {epochs.length > 1 && <ImpactChart epochs={epochs} />}

            {/* Filter tabs */}
            <div className="flex gap-1 flex-wrap">
              {FILTER_TYPES.map(type => {
                const cfg = TYPE_CONFIG[type];
                const count = type === "all" ? totalEvents : (typeCounts[type] || 0);
                return (
                  <button
                    key={type}
                    onClick={() => setFilterType(type)}
                    className={`px-3 py-1.5 border font-mono text-[8px] tracking-widest uppercase transition-all flex items-center gap-1.5 ${
                      filterType === type
                        ? (cfg ? `${cfg.border} ${cfg.bg} ${cfg.color}` : "border-primary/40 bg-primary/10 text-primary")
                        : "border-primary/10 text-primary/30 hover:text-primary/60 hover:border-primary/20"
                    }`}
                  >
                    {cfg ? <cfg.Icon className="w-2.5 h-2.5" /> : <TrendingUp className="w-2.5 h-2.5" />}
                    {type === "all" ? "All" : cfg?.label || type}
                    <span className="text-[7px] opacity-50">({count})</span>
                  </button>
                );
              })}
            </div>

            {/* Epochs timeline */}
            <div className="space-y-2">
              {epochs.map((epoch, i) => (
                <EpochBlock
                  key={i}
                  epoch={epoch}
                  index={i}
                  filterType={filterType}
                />
              ))}
            </div>

            {/* Legend */}
            <div className="border border-primary/10 bg-black/30 p-4">
              <p className="font-mono text-[8px] text-primary/30 tracking-widest uppercase mb-3">Legend</p>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(TYPE_CONFIG).map(([type, cfg]) => (
                  <div key={type} className="flex items-center gap-2 text-[8px] font-mono text-primary/40">
                    <cfg.Icon className={`w-3 h-3 ${cfg.color}`} />
                    <span>{cfg.label} — {type === "lore" ? "world state facts" : type === "quest" ? "completed/active quests" : type === "arc" ? "ongoing narrative arcs" : "emotional character moments"}</span>
                  </div>
                ))}
              </div>
              <p className="font-mono text-[7px] text-primary/20 mt-3">
                Impact weight: Lore (1–5 by importance) · Quests (4 completed / 2 failed) · Arcs (1–5 by emotional weight) · Memories (1–4 by significance)
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}