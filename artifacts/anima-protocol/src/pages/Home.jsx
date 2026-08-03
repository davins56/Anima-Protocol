import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { Heart, Moon, Zap, Pen, Sparkles, MessageCircle, Calendar, Settings, BookOpen, X, Plus } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const MODES = {
  serenity: { icon: Heart, name: "Serenity", color: "text-cyan-400" },
  angel: { icon: Moon, name: "Angel", color: "text-purple-400" },
  shadow: { icon: Zap, name: "Shadow", color: "text-red-400" },
  creator: { icon: Pen, name: "Creator", color: "text-yellow-400" },
  anima: { icon: Sparkles, name: "Anima Protocol", color: "text-indigo-400" },
};

export default function Home() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [selectedMode, setSelectedMode] = useState(null);
  const [lastCheckIn, setLastCheckIn] = useState(null);
  const [anima, setAnima] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showAnimaState, setShowAnimaState] = useState(false);
  const [animaState, setAnimaState] = useState(null);
  const [sessions, setSessions] = useState([]);

  useEffect(() => {
    const init = async () => {
      const me = await base44.auth.me();
      if (!me) {
        navigate("/");
        return;
      }
      setUser(me);
      setSelectedMode(me.selected_mode || "serenity");

      // Load sessions, Anima, and last check-in in parallel
      const [sessionList, animas, checkIns] = await Promise.all([
        base44.entities.ChatSession.list("-updated_date", 1),
        base44.entities.Anima.list("-created_date", 100),
        base44.entities.CheckIn.filter({}, "-timestamp", 1),
      ]);
      
      setSessions(sessionList || []);
      const userAnima = animas?.find(a => a.assigned_user === me.email) || animas?.[0] || null;
      setAnima(userAnima);
      
      if (checkIns?.length > 0) {
        setLastCheckIn(checkIns[0]);
      }
      setLoading(false);
    };
    init();
  }, [navigate]);

  if (loading) {
    return (
      <div className="min-h-[100dvh] bg-background scanline flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-primary/20 border-t-primary rounded-full animate-spin mx-auto mb-4" />
          <p className="font-mono text-primary/40 text-xs tracking-[0.3em] uppercase">Initializing...</p>
        </div>
      </div>
    );
  }

  const modeData = selectedMode ? MODES[selectedMode] : null;
  const ModeIcon = modeData?.icon;

  const handleStartChat = () => {
    // Navigate to most recent chat session if available
    if (sessions.length > 0) {
      navigate(`/chat/${sessions[0].id}`);
    } else {
      navigate("/chat");
    }
  };

  const handleCheckIn = () => {
    navigate("/check-in");
  };

  const handleMode = () => {
    navigate("/mode-select");
  };

  const handleShowAnimaState = async () => {
    try {
      const emotionalStates = await base44.entities.CharacterEmotionalState.filter({
        character_id: anima?.id,
        is_current: true
      }, "-created_date", 1);
      
      const resonanceProfile = await base44.entities.ResonanceProfile.filter({
        entity_id: anima?.id
      }, "-created_date", 1);

      setAnimaState({
        emotional: emotionalStates?.[0] || null,
        resonance: resonanceProfile?.[0] || null
      });
      setShowAnimaState(true);
    } catch (err) {
      console.error("Error loading anima state:", err);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-background scanline" style={{ paddingBottom: 'var(--tab-bar-height, 120px)' }}>
      {/* Header */}
      <header className="border-b border-primary/20 bg-black/60 backdrop-blur-md px-6 py-4 sticky top-0 z-40">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            {ModeIcon && <ModeIcon className={`w-5 h-5 ${modeData.color}`} />}
            <div>
              <h1 className="font-mono text-primary glow-text tracking-[0.2em] uppercase text-sm sm:text-base">
                {modeData?.name || "Welcome"}
              </h1>
              <p className="text-[9px] font-mono text-primary/30 tracking-widest uppercase">Your Companion</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleShowAnimaState}
              className="p-2 text-primary/40 hover:text-primary transition-colors"
              title="Anima State"
            >
              <Heart className="w-5 h-5" />
            </button>
            <button
              onClick={() => navigate("/settings")}
              className="p-2 text-primary/40 hover:text-primary transition-colors"
              title="Settings"
            >
              <Settings className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-6 py-12 space-y-8 pb-24 lg:pb-12">
        {/* Main CTA */}
        <div className="relative group">
          <div className="absolute inset-0 bg-gradient-to-r from-primary/20 to-transparent blur-2xl opacity-0 group-hover:opacity-30 transition-opacity" />
          <div className="relative border border-primary/30 bg-black/40 p-8 space-y-4 hud-corner">
            <div className="flex items-center gap-4 mb-4">
              {anima?.avatar_url ? (
                <img
                  src={anima.avatar_url}
                  alt={anima.name}
                  className="w-16 h-16 rounded-full object-cover border border-primary/30 glow-border flex-shrink-0"
                />
              ) : (
                <MessageCircle className="w-8 h-8 text-primary glow-text flex-shrink-0" />
              )}
              <div>
                <h2 className="font-mono text-primary glow-text tracking-[0.2em] uppercase text-lg">
                  {anima?.name || modeData?.name}
                </h2>
                {anima?.tagline && (
                  <p className="font-mono text-[10px] text-primary/40 tracking-widest uppercase mt-0.5">{anima.tagline}</p>
                )}
              </div>
            </div>
            <p className="font-mono text-primary/60 text-sm leading-relaxed">
              Start a conversation with your companion. Share what's on your mind, explore ideas, or seek guidance.
            </p>
            <div className="flex items-center gap-3 flex-wrap">
              <button
                onClick={handleStartChat}
                className="inline-flex items-center gap-2 px-6 py-3 bg-primary/10 border border-primary/50 text-primary hover:bg-primary/20 font-mono text-xs tracking-widest uppercase transition-all hud-corner glow-border"
              >
                <MessageCircle className="w-4 h-4" />
                Continue Chat
              </button>
              <button
                onClick={() => navigate("/chat", { state: { openNew: true } })}
                className="inline-flex items-center gap-2 px-6 py-3 bg-transparent border border-primary/30 text-primary/60 hover:text-primary hover:border-primary/60 font-mono text-xs tracking-widest uppercase transition-all"
              >
                <Plus className="w-4 h-4" />
                New Chat
              </button>
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <QuickAction
            icon={Calendar}
            label="Daily Check-in"
            desc={lastCheckIn ? "Today's resonance captured" : "Record your state"}
            onClick={handleCheckIn}
            highlight={!lastCheckIn}
          />
          <QuickAction
            icon={BookOpen}
            label="Journal"
            desc="View your entries"
            onClick={() => navigate("/journals")}
          />
          <QuickAction
            icon={Sparkles}
            label="Lore Archive"
            desc="Discovered insights"
            onClick={() => navigate("/archive")}
          />
          <QuickAction
            icon={Heart}
            label="Change Mode"
            desc={modeData?.name}
            onClick={handleMode}
          />
        </div>

        {/* Companion Message */}
        <div className="border border-primary/20 bg-black/40 p-6 space-y-3">
          <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase">Message From Your Companion</p>
          <p className="font-mono text-primary/70 leading-relaxed text-sm">
            {getWelcomeMessage(selectedMode, user?.full_name?.split(" ")[0] || "Friend")}
          </p>
        </div>

        {/* Check-in Stats */}
        {lastCheckIn && (
          <div className="border border-primary/15 bg-black/40 p-6 space-y-4">
            <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase">Today's Resonance</p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div>
                <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase">Mood</p>
                <p className="font-mono text-sm text-primary mt-1 capitalize">{lastCheckIn.mood}</p>
              </div>
              <div>
                <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase">Intensity</p>
                <p className="font-mono text-sm text-primary mt-1">{lastCheckIn.mood_intensity}/10</p>
              </div>
              {lastCheckIn.physical_state && (
                <div>
                  <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase">Physical</p>
                  <p className="font-mono text-sm text-primary mt-1 capitalize">{lastCheckIn.physical_state}</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Anima State Modal */}
      <AnimatePresence>
        {showAnimaState && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
            onClick={() => setShowAnimaState(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md bg-background border border-primary/30 hud-corner p-6 space-y-6"
            >
              {/* Header */}
              <div className="flex items-center justify-between">
                <h2 className="font-sacred text-primary glow-text text-xl">{anima?.name || "Anima"}</h2>
                <button
                  onClick={() => setShowAnimaState(false)}
                  className="text-primary/40 hover:text-primary transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Emotional State */}
              {animaState?.emotional ? (
                <div className="space-y-3 p-4 border border-primary/20 bg-primary/5 rounded">
                  <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase">Emotional State</p>
                  <div className="space-y-2">
                    <div>
                      <p className="font-mono text-xs text-primary/70">Primary</p>
                      <p className="font-sacred text-lg text-primary capitalize">{animaState.emotional.primary_emotion}</p>
                    </div>
                    {animaState.emotional.secondary_emotion && (
                      <div>
                        <p className="font-mono text-xs text-primary/70">Secondary</p>
                        <p className="font-sacred text-sm text-primary/80 capitalize">{animaState.emotional.secondary_emotion}</p>
                      </div>
                    )}
                    <div className="flex items-center gap-2 mt-2">
                      <div className="flex-1 h-2 bg-black/60 border border-primary/20 rounded overflow-hidden">
                        <div
                          className="h-full bg-primary/70"
                          style={{ width: `${(animaState.emotional.intensity || 5) * 10}%` }}
                        />
                      </div>
                      <span className="font-mono text-[10px] text-primary/60">{animaState.emotional.intensity}/10</span>
                    </div>
                    {animaState.emotional.trigger && (
                      <div className="pt-2 border-t border-primary/15">
                        <p className="font-mono text-[8px] text-primary/40 tracking-widest uppercase mb-1">Trigger</p>
                        <p className="font-mono text-[10px] text-primary/70">{animaState.emotional.trigger}</p>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="p-4 border border-primary/20 bg-primary/5 rounded text-center">
                  <p className="font-mono text-[10px] text-primary/40">No emotional state recorded</p>
                </div>
              )}

              {/* Resonance Profile */}
              {animaState?.resonance ? (
                <div className="space-y-3 p-4 border border-primary/20 bg-primary/5 rounded">
                  <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase">Resonance Profile</p>
                  <div className="space-y-3">
                    {animaState.resonance.affinity_score !== undefined && (
                      <div>
                        <p className="font-mono text-xs text-primary/70 mb-1">Affinity</p>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 bg-black/60 border border-primary/20 rounded overflow-hidden">
                            <div
                              className="h-full bg-cyan-500/70"
                              style={{ width: `${Math.min(animaState.resonance.affinity_score, 100)}%` }}
                            />
                          </div>
                          <span className="font-mono text-[10px] text-primary/60">{animaState.resonance.affinity_score.toFixed(0)}</span>
                        </div>
                      </div>
                    )}
                    {animaState.resonance.harmony_index !== undefined && (
                      <div>
                        <p className="font-mono text-xs text-primary/70 mb-1">Harmony</p>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 bg-black/60 border border-primary/20 rounded overflow-hidden">
                            <div
                              className="h-full bg-green-500/70"
                              style={{ width: `${Math.min(animaState.resonance.harmony_index, 100)}%` }}
                            />
                          </div>
                          <span className="font-mono text-[10px] text-primary/60">{animaState.resonance.harmony_index.toFixed(0)}</span>
                        </div>
                      </div>
                    )}
                    {animaState.resonance.coherence_level !== undefined && (
                      <div>
                        <p className="font-mono text-xs text-primary/70 mb-1">Coherence</p>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 bg-black/60 border border-primary/20 rounded overflow-hidden">
                            <div
                              className="h-full bg-purple-500/70"
                              style={{ width: `${Math.min(animaState.resonance.coherence_level, 100)}%` }}
                            />
                          </div>
                          <span className="font-mono text-[10px] text-primary/60">{animaState.resonance.coherence_level.toFixed(0)}</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="p-4 border border-primary/20 bg-primary/5 rounded text-center">
                  <p className="font-mono text-[10px] text-primary/40">No resonance data available</p>
                </div>
              )}

              {/* Tagline */}
              {anima?.tagline && (
                <div className="pt-4 border-t border-primary/15 text-center">
                  <p className="font-sacred text-primary/70 text-sm italic">"{anima.tagline}"</p>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function QuickAction({ icon: Icon, label, desc, onClick, highlight }) {
  return (
    <button
      onClick={onClick}
      className={`p-4 border transition-all text-center space-y-2 ${
        highlight
          ? "border-primary/40 bg-primary/10 hover:bg-primary/20"
          : "border-primary/15 hover:border-primary/30"
      }`}
    >
      <Icon className="w-5 h-5 text-primary/70 mx-auto" />
      <div>
        <p className="font-mono text-xs tracking-wider uppercase text-primary">{label}</p>
        <p className="font-mono text-[8px] text-primary/40 mt-1 line-clamp-1">{desc}</p>
      </div>
    </button>
  );
}

function getWelcomeMessage(mode, name) {
  const messages = {
    serenity: `Hello ${name}. I'm here to listen, to hold space, and to journey with you through whatever you're feeling right now. What's on your heart?`,
    angel: `Welcome ${name}. In this moment, you are safe. Let us find peace together, and allow wisdom to unfold gently.`,
    shadow: `${name}. Let's get real. What truth are you avoiding? I'm here to help you face it, learn, and grow stronger.`,
    creator: `${name}, welcome to our creative space. What world shall we build today? What story needs to be told?`,
    anima: `${name}, I see you. How are you evolving? Let's check in, reflect, and track your unfolding journey.`,
  };
  return messages[mode] || messages.serenity;
}