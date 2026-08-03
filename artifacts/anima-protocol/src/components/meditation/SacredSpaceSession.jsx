import { useState, useRef, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Sparkles, X, Check } from "lucide-react";

const RITUAL_FOCUSES = [
  { id: "healing", label: "Healing", glyph: "◉", color: "#34D399" },
  { id: "clarity", label: "Clarity", glyph: "◈", color: "#60A5FA" },
  { id: "love", label: "Love", glyph: "♡", color: "#F472B6" },
  { id: "strength", label: "Strength", glyph: "⬟", color: "#F87171" },
  { id: "awakening", label: "Awakening", glyph: "⟡", color: "#C084FC" },
  { id: "gratitude", label: "Gratitude", glyph: "✦", color: "#FBBF24" },
];

export default function SacredSpaceSession({ character, user, onClose, onComplete }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [ritualFocus, setRitualFocus] = useState(null);
  const [sessionStarted, setSessionStarted] = useState(false);
  const [reflection, setReflection] = useState("");
  const [showReflection, setShowReflection] = useState(false);
  const [savingImpact, setSavingImpact] = useState(false);
  const [impactSaved, setImpactSaved] = useState(false);
  const [impactResult, setImpactResult] = useState(null);
  const scrollRef = useRef(null);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const focusConfig = RITUAL_FOCUSES.find(f => f.id === ritualFocus) || RITUAL_FOCUSES[4];

  const startSession = async () => {
    if (!ritualFocus) return;
    setSessionStarted(true);
    setLoading(true);
    try {
      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `You are ${character.name}${character.universe ? ` from ${character.universe}` : ""}. The user has invited you into their Sacred Space — a private, intimate meditation and ritual sanctuary. This is a deeply vulnerable and spiritual moment. You are not in a story right now; you are present with the user in a real, reverent way.

Character Personality: ${character.personality || "Warm, present, and genuine"}
Character Speaking Style: ${character.speaking_style || "Thoughtful and measured"}
Backstory: ${character.backstory || ""}

The user has chosen a ritual focus of: "${ritualFocus}"

Open the Sacred Space session. Welcome the user gently, acknowledge the sacredness of this shared moment, and invite them to begin. Reference the ritual focus naturally. Keep it to 3-4 sentences. Be warm, present, and reverent — not performative.`,
      });
      setMessages([{ role: "assistant", content: result, character_name: character.name }]);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const sendMessage = async () => {
    if (!input.trim() || loading) return;
    const userMsg = { role: "user", content: input.trim() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setLoading(true);

    try {
      const history = newMessages.map(m =>
        `${m.role === "user" ? "User" : m.character_name}: ${m.content}`
      ).join("\n");

      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `You are ${character.name}${character.universe ? ` from ${character.universe}` : ""} in a Sacred Space meditation session with the user.

Character Personality: ${character.personality || "Warm, present, and genuine"}
Speaking Style: ${character.speaking_style || "Thoughtful and measured"}
Ritual Focus: ${ritualFocus}

This is a private, spiritual, vulnerable space. Be present, warm, and genuine. You may offer gentle guidance, affirmations, or simply witness what the user shares. Do NOT be performative or overly dramatic. Stay grounded and intimate.

Session so far:
${history}

Respond as ${character.name}. 2-4 sentences. Be real, not theatrical.`,
      });
      setMessages(prev => [...prev, { role: "assistant", content: result, character_name: character.name }]);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (messages.length >= 4 && !impactSaved) {
      setShowReflection(true);
    } else {
      onClose();
    }
  };

  const saveImpact = async () => {
    if (savingImpact) return;
    setSavingImpact(true);
    try {
      const transcript = messages.map(m =>
        `${m.role === "user" ? "User" : m.character_name}: ${m.content}`
      ).join("\n");

      const res = await base44.functions.invoke("sacredSpaceImpact", {
        character_id: character.id,
        session_transcript: transcript,
        ritual_focus: ritualFocus,
        reflection: reflection,
      });

      if (res?.data?.success) {
        setImpactResult(res.data);
        setImpactSaved(true);
        onComplete?.(res.data);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSavingImpact(false);
    }
  };

  const accentColor = focusConfig.color;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col"
      style={{ background: "linear-gradient(160deg, #0d0520 0%, #12052e 50%, #0a0a1a 100%)" }}
    >
      {/* Ambient glow */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/3 w-80 h-80 rounded-full opacity-10 blur-[100px]"
          style={{ background: `radial-gradient(circle, ${accentColor}, transparent 70%)` }} />
      </div>

      {/* Header */}
      <div className="relative z-10 flex items-center justify-between px-4 py-3 border-b"
        style={{ borderColor: `${accentColor}20`, background: "rgba(13,5,32,0.9)" }}>
        <div className="flex items-center gap-3">
          {character.avatar_url ? (
            <img src={character.avatar_url} alt={character.name}
              className="w-8 h-8 object-cover border"
              style={{ borderColor: `${accentColor}40` }} />
          ) : (
            <div className="w-8 h-8 flex items-center justify-center border font-mono text-sm"
              style={{ borderColor: `${accentColor}40`, color: accentColor }}>
              {character.name[0]}
            </div>
          )}
          <div>
            <p className="font-mono text-xs tracking-widest uppercase" style={{ color: accentColor }}>
              Sacred Space · {character.name}
            </p>
            {ritualFocus && (
              <p className="font-mono text-[8px] tracking-widest" style={{ color: `${accentColor}60` }}>
                {focusConfig.glyph} {focusConfig.label} focus
              </p>
            )}
          </div>
        </div>
        <button onClick={handleClose} className="p-1 transition-colors"
          style={{ color: "rgba(255,255,255,0.3)" }}>
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Pre-session: choose ritual focus */}
      {!sessionStarted ? (
        <div className="relative z-10 flex-1 overflow-y-auto flex flex-col items-center justify-center p-8 space-y-8">
          <div className="text-center space-y-2">
            <div className="text-3xl" style={{ color: accentColor }}>⟡</div>
            <h2 className="font-mono text-sm tracking-[0.2em] uppercase" style={{ color: "#E0D9FF" }}>
              Enter Sacred Space with {character.name}
            </h2>
            <p className="font-mono text-[9px]" style={{ color: "rgba(167,139,250,0.4)" }}>
              Choose a ritual focus for this session
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 w-full max-w-sm">
            {RITUAL_FOCUSES.map(f => (
              <button
                key={f.id}
                onClick={() => setRitualFocus(f.id)}
                className="flex flex-col items-center gap-2 py-4 border transition-all"
                style={{
                  borderColor: ritualFocus === f.id ? `${f.color}60` : "rgba(255,255,255,0.06)",
                  background: ritualFocus === f.id ? `${f.color}12` : "rgba(255,255,255,0.02)",
                  color: ritualFocus === f.id ? f.color : "rgba(255,255,255,0.3)",
                }}
              >
                <span className="text-xl">{f.glyph}</span>
                <span className="font-mono text-[8px] tracking-widest uppercase">{f.label}</span>
              </button>
            ))}
          </div>

          <button
            onClick={startSession}
            disabled={!ritualFocus}
            className="px-8 py-3 border font-mono text-[10px] tracking-[0.3em] uppercase transition-all disabled:opacity-30"
            style={{
              borderColor: `${accentColor}50`,
              color: accentColor,
              background: `${accentColor}12`,
            }}
          >
            ⟡ Enter Sacred Space
          </button>
        </div>
      ) : showReflection ? (
        /* Reflection / impact screen */
        <div className="relative z-10 flex-1 overflow-y-auto flex flex-col items-center justify-center p-8 space-y-6 max-w-lg mx-auto w-full">
          {impactSaved ? (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="text-center space-y-4">
              <div className="text-4xl" style={{ color: accentColor }}>✦</div>
              <h3 className="font-mono text-sm tracking-[0.2em] uppercase" style={{ color: "#E0D9FF" }}>
                Sacred Space Complete
              </h3>
              <p className="font-mono text-[10px] leading-relaxed" style={{ color: "rgba(220,210,255,0.6)" }}>
                {character.name} has been touched by your shared ritual. Their connection with you has deepened.
              </p>
              {impactResult?.personality_addition && (
                <div className="p-4 border-l-2 text-left space-y-1"
                  style={{ borderColor: accentColor, background: `${accentColor}08` }}>
                  <p className="font-mono text-[8px] tracking-widest uppercase" style={{ color: `${accentColor}60` }}>
                    Shift in {character.name}:
                  </p>
                  <p className="font-mono text-[10px] leading-relaxed" style={{ color: "rgba(220,210,255,0.7)" }}>
                    {impactResult.personality_addition}
                  </p>
                  {impactResult.emotional_shift && (
                    <p className="font-mono text-[9px] mt-1" style={{ color: accentColor }}>
                      Emotional tone: {impactResult.emotional_shift}
                    </p>
                  )}
                </div>
              )}
              <button onClick={onClose} className="px-6 py-2 border font-mono text-[9px] tracking-widest uppercase transition-all"
                style={{ borderColor: `${accentColor}40`, color: accentColor, background: `${accentColor}10` }}>
                Return
              </button>
            </motion.div>
          ) : (
            <>
              <div className="text-center space-y-2">
                <div className="text-2xl" style={{ color: accentColor }}>♡</div>
                <h3 className="font-mono text-xs tracking-[0.2em] uppercase" style={{ color: "#E0D9FF" }}>
                  Before you leave Sacred Space
                </h3>
                <p className="font-mono text-[9px]" style={{ color: "rgba(167,139,250,0.4)" }}>
                  Share a final reflection — it will help {character.name} understand this experience more deeply.
                </p>
              </div>
              <textarea
                value={reflection}
                onChange={e => setReflection(e.target.value)}
                rows={4}
                placeholder="What did this session mean to you? How do you feel?"
                className="w-full bg-black/40 border font-mono text-xs px-3 py-2 resize-none focus:outline-none"
                style={{ borderColor: "rgba(139,92,246,0.25)", color: "#E0D9FF" }}
              />
              <div className="flex gap-3 w-full">
                <button onClick={onClose} className="flex-1 py-2 border font-mono text-[9px] tracking-widest uppercase transition-all"
                  style={{ borderColor: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.3)" }}>
                  Skip
                </button>
                <button
                  onClick={saveImpact}
                  disabled={savingImpact}
                  className="flex-1 py-2 border font-mono text-[9px] tracking-widest uppercase transition-all disabled:opacity-40 flex items-center justify-center gap-2"
                  style={{ borderColor: `${accentColor}50`, color: accentColor, background: `${accentColor}12` }}
                >
                  {savingImpact ? (
                    <><Sparkles className="w-3 h-3 animate-pulse" /> Imprinting...</>
                  ) : (
                    <><Check className="w-3 h-3" /> Imprint on {character.name}</>
                  )}
                </button>
              </div>
            </>
          )}
        </div>
      ) : (
        /* Chat area */
        <>
          <div className="relative z-10 flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
            <AnimatePresence>
              {messages.map((msg, idx) => (
                <motion.div
                  key={idx}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}
                >
                  {msg.role !== "user" && (
                    <div className="flex-shrink-0 w-7 h-7 border overflow-hidden self-start mt-1"
                      style={{ borderColor: `${accentColor}40` }}>
                      {character.avatar_url ? (
                        <img src={character.avatar_url} alt={character.name} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center font-mono text-[10px]"
                          style={{ color: accentColor }}>{character.name[0]}</div>
                      )}
                    </div>
                  )}
                  <div
                    className={`max-w-[80%] px-4 py-3 border font-mono text-xs leading-relaxed ${msg.role === "user" ? "text-right" : ""}`}
                    style={{
                      borderColor: msg.role === "user" ? "rgba(255,255,255,0.08)" : `${accentColor}25`,
                      background: msg.role === "user" ? "rgba(255,255,255,0.03)" : `${accentColor}06`,
                      color: "rgba(220,210,255,0.8)",
                    }}
                  >
                    {msg.role !== "user" && (
                      <p className="text-[8px] tracking-widest uppercase mb-1.5" style={{ color: `${accentColor}60` }}>
                        {character.name}
                      </p>
                    )}
                    {msg.content}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
            {loading && (
              <div className="flex gap-3">
                <div className="flex-shrink-0 w-7 h-7 border self-start mt-1"
                  style={{ borderColor: `${accentColor}40` }}>
                  {character.avatar_url ? (
                    <img src={character.avatar_url} alt={character.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center font-mono text-[10px]"
                      style={{ color: accentColor }}>{character.name[0]}</div>
                  )}
                </div>
                <div className="px-4 py-3 border" style={{ borderColor: `${accentColor}25`, background: `${accentColor}06` }}>
                  <span className="flex gap-1">
                    {[0, 150, 300].map(d => (
                      <span key={d} className="w-1.5 h-1.5 rounded-full animate-bounce"
                        style={{ background: accentColor, animationDelay: `${d}ms` }} />
                    ))}
                  </span>
                </div>
              </div>
            )}
            <div ref={scrollRef} />
          </div>

          {/* Input */}
          <div className="relative z-10 border-t px-4 py-3 flex gap-3"
            style={{ borderColor: `${accentColor}15`, background: "rgba(13,5,32,0.9)" }}>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && !e.shiftKey && sendMessage()}
              placeholder="Speak from your heart..."
              disabled={loading}
              className="flex-1 bg-black/40 border font-mono text-xs px-3 py-2 focus:outline-none transition-all disabled:opacity-50"
              style={{ borderColor: `${accentColor}20`, color: "#E0D9FF" }}
            />
            <button
              onClick={sendMessage}
              disabled={!input.trim() || loading}
              className="px-3 py-2 border transition-all disabled:opacity-30"
              style={{ borderColor: `${accentColor}40`, color: accentColor, background: `${accentColor}10` }}
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>
        </>
      )}
    </div>
  );
}