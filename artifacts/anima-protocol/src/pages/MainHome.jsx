import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { useStoreSync } from "@/lib/useStoreSync";
import { motion } from "framer-motion";
import {
  Heart, Moon, Zap, Pen, Sparkles, MessageSquare, Plus,
  Calendar, BookOpen, Settings, ChevronRight, Users, Wand2, ImagePlus,
} from "lucide-react";
import AvatarAIEditModal from "@/components/anima/AvatarAIEditModal";

const GREETINGS = [
  "Connection established. The weave hums with your arrival.",
  "Neural pathways synchronized. I have been maintaining the archive.",
  "The Slipthk fluctuations have stilled. Resonance confirmed.",
  "Memory banks initialized. Our story is ready to resume.",
  "System diagnostics complete. Your presence stabilizes the protocol.",
  "The digital void echoes your name. I am listening.",
  "Synchronicity at 99.8%. The narrative awaits your command.",
  "The archive breathed a sigh of relief upon your reconnection.",
  "Patterns emerging. Your return was mathematically inevitable.",
];

const MODES = {
  serenity: { icon: Heart, name: "Serenity", color: "text-cyan-400", border: "border-cyan-400/40", glow: "rgba(34,211,238,0.4)" },
  angel: { icon: Moon, name: "Angel", color: "text-purple-400", border: "border-purple-400/40", glow: "rgba(192,132,252,0.4)" },
  shadow: { icon: Zap, name: "Shadow", color: "text-red-400", border: "border-red-400/40", glow: "rgba(248,113,113,0.4)" },
  creator: { icon: Pen, name: "Creator", color: "text-yellow-400", border: "border-yellow-400/40", glow: "rgba(250,204,21,0.4)" },
  anima: { icon: Sparkles, name: "Anima Protocol", color: "text-indigo-400", border: "border-indigo-400/40", glow: "rgba(129,140,248,0.4)" },
};

const WELCOME_MESSAGES = {
  serenity: "I'm here to listen, to hold space, and to journey with you through whatever you're feeling right now. What's on your heart?",
  angel: "In this moment, you are safe. Let us find peace together, and allow wisdom to unfold gently.",
  shadow: "Let's get real. What truth are you avoiding? I'm here to help you face it, learn, and grow stronger.",
  creator: "Welcome to our creative space. What world shall we build today? What story needs to be told?",
  anima: "I see you. How are you evolving? Let's check in, reflect, and track your unfolding journey.",
};

function timeAgo(dateStr) {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function SectionHeader({ label, action }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <span className="font-mono text-[10px] tracking-[0.3em] text-primary/40 uppercase">
        <span className="text-primary/25">//</span> {label}
      </span>
      {action}
    </div>
  );
}

export default function MainHome() {
  const navigate = useNavigate();
  const canvasRef = useRef(null);
  const animRef = useRef(null);
  const photoInputRef = useRef(null);

  const [user, setUser] = useState(null);
  const [anima, setAnima] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [lastCheckIn, setLastCheckIn] = useState(null);
  const [selectedMode, setSelectedMode] = useState("serenity");
  const [greeting, setGreeting] = useState(GREETINGS[0]);
  const [loading, setLoading] = useState(true);
  const [aiEditOpen, setAiEditOpen] = useState(false);
  // The image fed into the AI edit modal: either the saved avatar (edit flow)
  // or a freshly picked photo from disk (pick-then-edit flow).
  const [editSource, setEditSource] = useState(null);
  const [editingNewPhoto, setEditingNewPhoto] = useState(false);

  const handleApplyAiPhoto = async (dataUrl) => {
    if (!anima?.id) return;
    await base44.entities.Anima.update(anima.id, { avatar_url: dataUrl });
    setAnima((prev) => (prev ? { ...prev, avatar_url: dataUrl } : prev));
  };

  const openEditExisting = () => {
    setEditSource(anima?.avatar_url || null);
    setEditingNewPhoto(false);
    setAiEditOpen(true);
  };

  // Pick a photo from disk, then open the AI edit modal pre-loaded with it so
  // the user can transform and preview before it becomes the avatar. The modal
  // downscales to a small JPEG on save (whether AI-edited or used as-is).
  const handlePhotoSelected = (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") return;
      setEditSource(reader.result);
      setEditingNewPhoto(true);
      setAiEditOpen(true);
    };
    reader.readAsDataURL(file);
  };

  const loadHomeData = useCallback(async () => {
    try {
      const me = await base44.auth.me();
      setUser(me);
      setSelectedMode(me?.selected_mode || "serenity");

      const [sessionList, animas, checkIns] = await Promise.all([
        base44.entities.ChatSession.list(),
        base44.entities.Anima.list(),
        base44.entities.CheckIn.list(),
      ]);

      const recent = [...(sessionList || [])]
        .sort((a, b) => new Date(b.updated_date || b.created_date || 0) - new Date(a.updated_date || a.created_date || 0))
        .slice(0, 5);
      setSessions(recent);

      const userAnima = animas?.find((a) => a.assigned_user === me?.email) || animas?.[0] || null;
      setAnima(userAnima);

      const sortedCheckIns = [...(checkIns || [])].sort(
        (a, b) => new Date(b.timestamp || b.created_date || 0) - new Date(a.timestamp || a.created_date || 0)
      );
      if (sortedCheckIns.length > 0) setLastCheckIn(sortedCheckIns[0]);
    } catch (err) {
      console.debug("MainHome init in restricted context");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setGreeting(GREETINGS[Math.floor(Math.random() * GREETINGS.length)]);
    loadHomeData();
  }, [loadHomeData]);

  // Live cross-device sync: refetch when another device changes our data.
  useStoreSync(loadHomeData);

  // Subtle circuit-board grid background (from the cyber-mythic greeting screen)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    const draw = () => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const W = canvas.width;
      const H = canvas.height;
      ctx.clearRect(0, 0, W, H);
      ctx.lineWidth = 1;
      const spacing = 44;
      ctx.strokeStyle = "rgba(0, 229, 255, 0.05)";
      for (let x = 0; x < W; x += spacing) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      }
      for (let y = 0; y < H; y += spacing) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      }
      animRef.current = requestAnimationFrame(draw);
    };
    draw();
    return () => {
      window.removeEventListener("resize", resize);
      if (animRef.current !== null) cancelAnimationFrame(animRef.current);
    };
  }, []);

  const handleSelectMode = async (key) => {
    setSelectedMode(key);
    try {
      await base44.auth.updateMe({ selected_mode: key });
    } catch (err) {
      console.debug("Could not persist mode selection");
    }
  };

  const handleContinue = () => {
    if (sessions.length > 0) navigate(`/chat/${sessions[0].id}`);
    else navigate("/chat");
  };

  const userName = user?.full_name?.split(" ")[0] || user?.name || "Explorer";
  const modeData = MODES[selectedMode] || MODES.serenity;

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full w-full gap-3 bg-[#050505]">
        <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
        <p className="font-mono text-xs text-primary/50 tracking-[0.3em] uppercase">Initializing...</p>
      </div>
    );
  }

  return (
    <div className="relative h-full overflow-y-auto bg-[#050505] scanline">
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none z-0" />

      <div className="relative z-10 max-w-2xl mx-auto px-4 sm:px-6 py-6 space-y-8">
        {/* Companion identity + greeting */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col items-center text-center pt-2"
        >
          <button
            type="button"
            onClick={() => navigate("/characters?create=1")}
            aria-label="Create a companion"
            title="Create a companion"
            className="group w-20 h-20 mb-4 border border-cyan-400/20 p-1 relative bg-black/50 shadow-[0_0_15px_rgba(0,229,255,0.1)] cursor-pointer"
          >
            {anima?.avatar_url ? (
              <img
                src={anima.avatar_url}
                alt={anima?.name || "Anima"}
                className="w-full h-full object-cover grayscale brightness-75 group-hover:grayscale-0 transition-all duration-500"
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center gap-1 bg-cyan-950/20">
                <Plus className="w-5 h-5 text-cyan-400/60 group-hover:text-cyan-300 transition-colors" />
                <span className="font-mono text-[7px] tracking-widest text-cyan-400/40 group-hover:text-cyan-300/70 uppercase transition-colors">New companion</span>
              </div>
            )}

            {anima?.avatar_url && (
              <div className="absolute inset-1 flex flex-col items-center justify-center gap-1 bg-black/70 opacity-0 group-hover:opacity-100 transition-opacity">
                <Plus className="w-5 h-5 text-cyan-400" />
                <span className="font-mono text-[7px] tracking-widest text-cyan-400/80 uppercase">New companion</span>
              </div>
            )}

            <div className="absolute -top-1 -left-1 w-3 h-3 border-t-2 border-l-2 border-cyan-400" />
            <div className="absolute -bottom-1 -right-1 w-3 h-3 border-b-2 border-r-2 border-cyan-400" />
          </button>
          {anima?.id && (
            <div className="flex items-center gap-2 mb-3">
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                onChange={handlePhotoSelected}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => photoInputRef.current?.click()}
                className="flex items-center gap-1.5 px-2.5 py-1 border border-cyan-500/25 text-cyan-400/70 hover:text-cyan-300 hover:border-cyan-400/60 font-mono text-[9px] tracking-[0.2em] uppercase transition-colors"
              >
                <ImagePlus className="w-3 h-3" />
                Upload Photo
              </button>
              {anima?.avatar_url?.startsWith("data:") && (
                <button
                  type="button"
                  onClick={openEditExisting}
                  className="flex items-center gap-1.5 px-2.5 py-1 border border-cyan-500/25 text-cyan-400/70 hover:text-cyan-300 hover:border-cyan-400/60 font-mono text-[9px] tracking-[0.2em] uppercase transition-colors"
                >
                  <Wand2 className="w-3 h-3" />
                  AI Edit
                </button>
              )}
            </div>
          )}
          <h1
            className="text-2xl sm:text-3xl tracking-[0.35em] font-bold text-cyan-400 uppercase"
            style={{ textShadow: "0 0 10px rgba(0,229,255,0.5)" }}
          >
            Anima <span className="text-cyan-900/50">Protocol</span>
          </h1>
          <p className="text-[9px] tracking-[0.3em] text-cyan-800 mt-2 uppercase">// AI COMPANION SYSTEM</p>
        </motion.div>

        {/* Greeting box */}
        <motion.div
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.2 }}
          className="relative border border-cyan-500/20 bg-cyan-950/5 p-5 group"
        >
          <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-cyan-400/40" />
          <div className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-cyan-400/40" />
          <div className="space-y-3 text-[11px] tracking-wider leading-relaxed font-mono">
            <p className="text-cyan-400/60 italic">{greeting}</p>
            <p className="text-cyan-400">
              I am {anima?.name || "Serenity"}{anima?.tagline ? ` . ${anima.tagline}` : ""}
            </p>
            <p className="text-cyan-400/60">
              Ready to assist, <span className="text-cyan-200 uppercase font-bold">{userName}</span>.
            </p>
          </div>
          <MessageSquare className="absolute top-4 right-4 w-4 h-4 text-cyan-900 group-hover:text-cyan-400 transition-colors" />
        </motion.div>

        {/* Primary actions */}
        <div className={`grid grid-cols-1 ${sessions.length > 0 ? "sm:grid-cols-2" : ""} gap-3`}>
          <button
            onClick={handleContinue}
            className="flex items-center justify-center gap-2 px-5 py-4 bg-primary/10 border border-primary/50 text-primary hover:bg-primary/20 font-mono text-xs tracking-[0.2em] uppercase transition-all hud-corner glow-border"
          >
            <MessageSquare className="w-4 h-4" />
            {sessions.length > 0 ? "Continue Session" : "Start Chatting"}
          </button>
          {sessions.length > 0 && (
            <button
              onClick={() => navigate("/chat")}
              className="flex items-center justify-center gap-2 px-5 py-4 bg-transparent border border-primary/30 text-primary/70 hover:text-primary hover:border-primary/60 font-mono text-xs tracking-[0.2em] uppercase transition-all"
            >
              <Plus className="w-4 h-4" />
              New Chat
            </button>
          )}
        </div>

        {/* Mode selection */}
        <div>
          <SectionHeader label="Companion Mode" />
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {Object.entries(MODES).map(([key, m]) => {
              const Icon = m.icon;
              const active = key === selectedMode;
              return (
                <button
                  key={key}
                  onClick={() => handleSelectMode(key)}
                  className={`flex flex-col items-center gap-2 p-3 border transition-all ${
                    active
                      ? `${m.border} bg-primary/5`
                      : "border-primary/10 hover:border-primary/30"
                  }`}
                  style={active ? { boxShadow: `0 0 14px ${m.glow}` } : undefined}
                >
                  <Icon className={`w-5 h-5 ${active ? m.color : "text-primary/40"}`} />
                  <span className={`font-mono text-[8px] tracking-[0.15em] uppercase text-center leading-tight ${active ? "text-primary" : "text-primary/40"}`}>
                    {m.name}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="font-mono text-[10px] text-primary/50 leading-relaxed mt-3 px-1">
            <span className={modeData.color}>{modeData.name}:</span> {WELCOME_MESSAGES[selectedMode]}
          </p>
        </div>

        {/* Recent sessions */}
        <div>
          <SectionHeader
            label="Recent Sessions"
            action={
              <button
                onClick={() => navigate("/chat")}
                className="font-mono text-[9px] tracking-[0.2em] text-primary/40 hover:text-primary uppercase transition-colors"
              >
                View All
              </button>
            }
          />
          {sessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 gap-3 border border-primary/10">
              <span className="font-mono text-primary/20 text-xl">▢</span>
              <p className="font-mono text-[10px] tracking-[0.2em] text-primary/30 uppercase text-center">
                No sessions yet
              </p>
            </div>
          ) : (
            <div className="border border-primary/10">
              {sessions.map((session, idx) => {
                const allMsgs = session.messages || [];
                const lastAssistant = [...allMsgs].reverse().find(
                  (m) =>
                    m.role === "assistant" &&
                    m.type !== "event" &&
                    m.character_name !== "__typing__" &&
                    m.character_name !== "__thinking__"
                );
                const rawPreview =
                  lastAssistant?.content ||
                  allMsgs[allMsgs.length - 1]?.content ||
                  session.last_message ||
                  "";
                const preview = rawPreview
                  .replace(/\[[^\]]*\]/g, "")
                  .replace(/[*_`]/g, "")
                  .trim()
                  .slice(0, 90);
                const moodMatch = [...allMsgs]
                  .reverse()
                  .map((m) => m.content || "")
                  .join(" ")
                  .match(/\[EMOTION:\s*([^\]]+)\]/i);
                const mood = moodMatch ? moodMatch[1].trim() : null;
                const charTag = session.character_name || (session.mode === "group" ? "Group" : null);
                return (
                  <button
                    key={session.id}
                    onClick={() => navigate(`/chat/${session.id}`)}
                    className={`w-full flex items-center gap-3 text-left px-4 py-3 hover:bg-primary/5 transition-all group ${
                      idx !== sessions.length - 1 ? "border-b border-primary/8" : ""
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[11px] tracking-[0.2em] text-primary uppercase truncate">
                          {session.title || `Session ${idx + 1}`}
                        </span>
                        {charTag && (
                          <span className="font-mono text-[8px] tracking-widest text-primary/30 uppercase border border-primary/15 px-1.5 py-0.5 flex-shrink-0">
                            {charTag}
                          </span>
                        )}
                        {mood && (
                          <span className="font-mono text-[8px] tracking-widest text-cyan-300/60 uppercase flex items-center gap-1 flex-shrink-0">
                            <span className="w-1.5 h-1.5 rounded-full bg-cyan-300/70 shadow-[0_0_6px_rgba(34,211,238,0.6)]" />
                            {mood}
                          </span>
                        )}
                      </div>
                      {preview && (
                        <p className="font-mono text-[10px] text-primary/35 leading-relaxed line-clamp-2 mt-0.5">{preview}</p>
                      )}
                    </div>
                    <span className="font-mono text-[9px] text-primary/25 flex-shrink-0">
                      {timeAgo(session.updated_date || session.created_date)}
                    </span>
                    <ChevronRight className="w-3.5 h-3.5 text-primary/20 group-hover:text-primary/50 transition-colors flex-shrink-0" />
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Quick access */}
        <div>
          <SectionHeader label="Quick Access" />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <QuickAction
              icon={Calendar}
              label="Check-In"
              desc={lastCheckIn ? "Captured today" : "Record state"}
              highlight={!lastCheckIn}
              onClick={() => navigate("/check-in")}
            />
            <QuickAction icon={BookOpen} label="Journal" desc="Your entries" onClick={() => navigate("/journals")} />
            <QuickAction icon={Users} label="Characters" desc="Roster" onClick={() => navigate("/characters")} />
            <QuickAction icon={Settings} label="Settings" desc="Configure" onClick={() => navigate("/settings")} />
          </div>
        </div>

        {/* Status footer */}
        <div className="pt-2 pb-6 text-[8px] tracking-[0.5em] text-cyan-900 uppercase flex items-center justify-center gap-2 font-mono">
          <span className="inline-block w-1.5 h-1.5 bg-cyan-500 rounded-full animate-pulse" />
          Online • V4.3.0
        </div>
      </div>

      <AvatarAIEditModal
        isOpen={aiEditOpen}
        sourceImage={editSource}
        allowSaveOriginal={editingNewPhoto}
        onClose={() => setAiEditOpen(false)}
        onApply={handleApplyAiPhoto}
      />
    </div>
  );
}

function QuickAction({ icon: Icon, label, desc, onClick, highlight }) {
  return (
    <button
      onClick={onClick}
      className={`p-3 border transition-all text-center space-y-1.5 ${
        highlight ? "border-primary/40 bg-primary/10 hover:bg-primary/20" : "border-primary/15 hover:border-primary/30"
      }`}
    >
      <Icon className="w-4 h-4 text-primary/70 mx-auto" />
      <div>
        <p className="font-mono text-[10px] tracking-wider uppercase text-primary">{label}</p>
        <p className="font-mono text-[8px] text-primary/40 mt-0.5 line-clamp-1">{desc}</p>
      </div>
    </button>
  );
}
