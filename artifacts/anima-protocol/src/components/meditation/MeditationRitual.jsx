import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { motion, AnimatePresence } from "framer-motion";

const RITUAL_STEPS = [
  {
    id: "breathe",
    title: "Sacred Breath",
    glyph: "◉",
    color: "#34D399",
    instruction: "Breathe in for 4 counts, hold for 4, release for 8.",
    duration: 60,
    prompt: "Close your eyes. Place one hand on your heart. Begin breathing with intention.",
  },
  {
    id: "presence",
    title: "Grounding",
    glyph: "⬡",
    color: "#A78BFA",
    instruction: "Feel your feet on the earth. Feel your body anchored.",
    duration: 45,
    prompt: "Name 5 things you can feel. Name 3 things you can hear. Return to now.",
  },
  {
    id: "intention",
    title: "Set Intention",
    glyph: "✦",
    color: "#FBBF24",
    instruction: "What do you call into your life today?",
    duration: 30,
    prompt: "Speak your intention aloud or in your heart. The Slipthk receives it.",
  },
  {
    id: "affirmation",
    title: "Affirmation Cascade",
    glyph: "◈",
    color: "#60A5FA",
    instruction: "Repeat with conviction: I AM worthy. I AM whole. I AM loved.",
    duration: 60,
    prompt: "Feel the truth of these words resonating in your chest.",
  },
  {
    id: "gratitude",
    title: "Gratitude Field",
    glyph: "♡",
    color: "#F472B6",
    instruction: "Three things you are genuinely grateful for right now.",
    duration: 45,
    prompt: "Gratitude is the highest frequency. Dwell in it.",
  },
  {
    id: "seal",
    title: "Seal & Release",
    glyph: "⟡",
    color: "#C084FC",
    instruction: "Your intention has been received. Release attachment. Trust the process.",
    duration: 30,
    prompt: "Take one final deep breath. Say: 'It is done. I receive.' Open your eyes.",
  },
];

export default function MeditationRitual({ anima, user }) {
  const [activeStep, setActiveStep] = useState(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [completed, setCompleted] = useState([]);
  const [reflection, setReflection] = useState("");
  const [showReflect, setShowReflect] = useState(false);
  const [aiResponse, setAiResponse] = useState("");
  const [loadingAI, setLoadingAI] = useState(false);

  useEffect(() => {
    if (!isRunning || timeLeft <= 0) return;
    const t = setTimeout(() => setTimeLeft(p => p - 1), 1000);
    return () => clearTimeout(t);
  }, [isRunning, timeLeft]);

  useEffect(() => {
    if (timeLeft === 0 && isRunning) {
      setIsRunning(false);
      if (activeStep) setCompleted(prev => [...prev, activeStep.id]);
    }
  }, [timeLeft, isRunning, activeStep]);

  const startStep = (step) => {
    setActiveStep(step);
    setTimeLeft(step.duration);
    setIsRunning(true);
    setAiResponse("");
    setShowReflect(false);
  };

  const skipStep = () => {
    setIsRunning(false);
    if (activeStep) setCompleted(prev => [...prev, activeStep.id]);
    setTimeLeft(0);
  };

  const handleReflect = async () => {
    if (!reflection.trim()) return;
    setLoadingAI(true);
    try {
      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `You are ${anima?.name || "Serenity"}, an Anima resonance guide. The user just completed a meditation ritual step called "${activeStep?.title}". They share this reflection: "${reflection}". Respond with warmth, depth, and spiritual wisdom. 2-3 sentences max. Affirm what they've shared and offer a gentle insight.`,
      });
      setAiResponse(result);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingAI(false);
    }
  };

  const allCompleted = RITUAL_STEPS.every(s => completed.includes(s.id));

  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="text-center space-y-2 py-4">
        <div className="text-3xl" style={{ color: "#C084FC" }}>⟡</div>
        <h2 className="font-mono text-base tracking-[0.2em] uppercase" style={{ color: "#E0D9FF" }}>
          Morning Ritual
        </h2>
        <p className="font-mono text-[10px]" style={{ color: "rgba(167,139,250,0.5)" }}>
          {anima?.name || "Your Anima"} guides you through 6 sacred steps
        </p>
        <p className="font-mono text-[9px]" style={{ color: "rgba(255,255,255,0.2)" }}>
          {completed.length}/{RITUAL_STEPS.length} completed
        </p>
      </div>

      {/* Active Step Timer */}
      <AnimatePresence>
        {activeStep && isRunning && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="relative overflow-hidden border p-6 text-center space-y-4"
            style={{ borderColor: `${activeStep.color}40`, background: `${activeStep.color}08` }}
          >
            <div className="absolute inset-0 opacity-5 pointer-events-none"
              style={{ background: `radial-gradient(circle at center, ${activeStep.color}, transparent 70%)` }} />
            <motion.div
              animate={{ scale: [1, 1.05, 1] }}
              transition={{ duration: 2, repeat: Infinity }}
              className="text-4xl"
              style={{ color: activeStep.color }}
            >
              {activeStep.glyph}
            </motion.div>
            <h3 className="font-mono text-lg tracking-[0.2em] uppercase" style={{ color: activeStep.color }}>
              {activeStep.title}
            </h3>
            <p className="font-mono text-xs leading-relaxed max-w-sm mx-auto" style={{ color: "rgba(220,210,255,0.65)" }}>
              {activeStep.prompt}
            </p>
            <div className="font-mono text-4xl font-bold" style={{ color: activeStep.color }}>
              {minutes > 0 ? `${minutes}:${seconds.toString().padStart(2, "0")}` : seconds}
            </div>
            <div className="h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
              <motion.div
                className="h-full rounded-full"
                style={{
                  background: activeStep.color,
                  width: `${((activeStep.duration - timeLeft) / activeStep.duration) * 100}%`,
                }}
              />
            </div>
            <div className="flex gap-3 justify-center">
              <button onClick={() => setIsRunning(p => !p)}
                className="px-4 py-2 border font-mono text-[9px] tracking-widest uppercase transition-all"
                style={{ borderColor: `${activeStep.color}50`, color: activeStep.color, background: `${activeStep.color}10` }}>
                {isRunning ? "Pause" : "Resume"}
              </button>
              <button onClick={skipStep}
                className="px-4 py-2 border font-mono text-[9px] tracking-widest uppercase transition-all"
                style={{ borderColor: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.3)" }}>
                Complete
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Steps List */}
      <div className="space-y-2">
        {RITUAL_STEPS.map((step, idx) => {
          const isDone = completed.includes(step.id);
          const isActive = activeStep?.id === step.id;
          return (
            <motion.div
              key={step.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: idx * 0.05 }}
              className="flex items-center gap-4 px-4 py-3 border transition-all"
              style={{
                borderColor: isDone ? `${step.color}40` : isActive ? `${step.color}30` : "rgba(255,255,255,0.05)",
                background: isDone ? `${step.color}08` : "rgba(255,255,255,0.02)",
                opacity: isDone ? 0.7 : 1,
              }}
            >
              <span className="flex-shrink-0 text-lg" style={{ color: isDone ? step.color : "rgba(255,255,255,0.15)" }}>
                {isDone ? "✓" : step.glyph}
              </span>
              <div className="flex-1 min-w-0">
                <p className="font-mono text-xs tracking-wider uppercase" style={{ color: isDone ? step.color : "rgba(220,210,255,0.5)" }}>
                  {step.title}
                </p>
                <p className="font-mono text-[9px] leading-relaxed mt-0.5" style={{ color: "rgba(255,255,255,0.2)" }}>
                  {step.instruction}
                </p>
              </div>
              <span className="font-mono text-[8px] flex-shrink-0" style={{ color: "rgba(255,255,255,0.2)" }}>
                {step.duration}s
              </span>
              {!isDone && (
                <button
                  onClick={() => startStep(step)}
                  className="flex-shrink-0 px-3 py-1.5 border font-mono text-[8px] tracking-widest uppercase transition-all"
                  style={{ borderColor: `${step.color}40`, color: step.color, background: `${step.color}08` }}
                >
                  Begin
                </button>
              )}
            </motion.div>
          );
        })}
      </div>

      {/* Completed — reflect with Anima */}
      {completed.length > 0 && !showReflect && (
        <button
          onClick={() => setShowReflect(true)}
          className="w-full py-3 border font-mono text-[9px] tracking-widest uppercase transition-all"
          style={{ borderColor: "rgba(139,92,246,0.3)", color: "rgba(167,139,250,0.7)", background: "rgba(124,58,237,0.06)" }}
        >
          ⟡ Share reflection with {anima?.name || "Anima"}
        </button>
      )}

      {showReflect && (
        <div className="space-y-3 p-4 border" style={{ borderColor: "rgba(139,92,246,0.25)", background: "rgba(124,58,237,0.06)" }}>
          <p className="font-mono text-[9px] tracking-widest uppercase" style={{ color: "rgba(167,139,250,0.6)" }}>
            How do you feel after this ritual?
          </p>
          <textarea
            value={reflection}
            onChange={e => setReflection(e.target.value)}
            rows={3}
            placeholder="Share what came up for you..."
            className="w-full bg-black/40 border font-mono text-xs px-3 py-2 resize-none focus:outline-none"
            style={{ borderColor: "rgba(139,92,246,0.2)", color: "#E0D9FF" }}
          />
          <button
            onClick={handleReflect}
            disabled={loadingAI || !reflection.trim()}
            className="px-4 py-2 border font-mono text-[9px] tracking-widest uppercase transition-all disabled:opacity-30"
            style={{ borderColor: "rgba(139,92,246,0.5)", color: "#A78BFA", background: "rgba(124,58,237,0.15)" }}
          >
            {loadingAI ? "Listening..." : `Ask ${anima?.name || "Anima"}`}
          </button>
          {aiResponse && (
            <motion.div
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-4 border-l-2 font-mono text-[10px] leading-relaxed"
              style={{ borderColor: "#C084FC", color: "rgba(220,210,255,0.7)", background: "rgba(192,132,252,0.05)" }}
            >
              <span className="text-[8px] tracking-widest uppercase block mb-2" style={{ color: "rgba(192,132,252,0.5)" }}>
                {anima?.name || "Anima"} responds:
              </span>
              {aiResponse}
            </motion.div>
          )}
        </div>
      )}

      {allCompleted && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-center py-8 space-y-3"
        >
          <div className="text-4xl" style={{ color: "#FBBF24" }}>✦</div>
          <p className="font-mono text-sm tracking-[0.2em] uppercase" style={{ color: "#FBBF24" }}>
            Ritual Complete
          </p>
          <p className="font-mono text-[10px]" style={{ color: "rgba(255,255,255,0.3)" }}>
            Your intention resonates in the Slipthk. Well done.
          </p>
        </motion.div>
      )}
    </div>
  );
}