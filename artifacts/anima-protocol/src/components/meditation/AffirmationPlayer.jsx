import { useState, useEffect, useRef, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { Play, Pause, SkipForward, SkipBack, Volume2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const CATEGORY_COLORS = {
  abundance: "#FBBF24",
  healing: "#34D399",
  love: "#F472B6",
  strength: "#F87171",
  clarity: "#60A5FA",
  protection: "#A78BFA",
  awakening: "#C084FC",
  custom: "#94A3B8",
};

export default function AffirmationPlayer({ affirmations, anima }) {
  const [currentIdx, setCurrentIdx] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [autoAdvance, setAutoAdvance] = useState(true);
  const [intervalSecs, setIntervalSecs] = useState(8);
  const timerRef = useRef(null);
  const synthRef = useRef(window.speechSynthesis);

  const current = affirmations[currentIdx];
  const color = current ? (CATEGORY_COLORS[current.category] || "#A78BFA") : "#A78BFA";

  const speakCurrent = useCallback((text) => {
    if (!text) return;
    synthRef.current?.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.85;
    utterance.pitch = 1.05;
    utterance.volume = 0.9;
    // Try to pick a pleasant voice
    const voices = synthRef.current?.getVoices() || [];
    const preferred = voices.find(v => v.name.includes("Samantha") || v.name.includes("Karen") || v.name.includes("Moira") || v.lang === "en-US");
    if (preferred) utterance.voice = preferred;
    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    synthRef.current?.speak(utterance);
  }, []);

  const stopSpeaking = () => {
    synthRef.current?.cancel();
    setIsSpeaking(false);
  };

  const goTo = useCallback((idx) => {
    stopSpeaking();
    setCurrentIdx(idx);
  }, []);

  const next = useCallback(() => {
    if (!affirmations.length) return;
    const nextIdx = (currentIdx + 1) % affirmations.length;
    goTo(nextIdx);
    if (isPlaying) setTimeout(() => speakCurrent(affirmations[nextIdx]?.text), 300);
  }, [currentIdx, affirmations, isPlaying, goTo, speakCurrent]);

  const prev = () => {
    if (!affirmations.length) return;
    const prevIdx = (currentIdx - 1 + affirmations.length) % affirmations.length;
    goTo(prevIdx);
  };

  const togglePlay = () => {
    if (isPlaying) {
      stopSpeaking();
      clearInterval(timerRef.current);
      setIsPlaying(false);
    } else {
      setIsPlaying(true);
      speakCurrent(current?.text);
    }
  };

  // Auto-advance timer
  useEffect(() => {
    if (isPlaying && autoAdvance) {
      timerRef.current = setInterval(() => {
        setCurrentIdx(prev => {
          const next = (prev + 1) % affirmations.length;
          setTimeout(() => speakCurrent(affirmations[next]?.text), 300);
          return next;
        });
      }, intervalSecs * 1000);
    }
    return () => clearInterval(timerRef.current);
  }, [isPlaying, autoAdvance, intervalSecs, affirmations.length, speakCurrent]);

  useEffect(() => {
    return () => { synthRef.current?.cancel(); clearInterval(timerRef.current); };
  }, []);

  if (!current) {
    return (
      <div className="text-center py-12 font-mono text-[10px]" style={{ color: "rgba(167,139,250,0.4)" }}>
        No affirmations available.
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-none border p-6 sm:p-8 space-y-6"
      style={{ borderColor: `${color}30`, background: `linear-gradient(135deg, ${color}08, rgba(13,5,32,0.9))` }}>

      {/* Pulse glow behind text */}
      <AnimatePresence mode="wait">
        <motion.div
          key={currentIdx}
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 1.05 }}
          transition={{ duration: 0.5 }}
          className="text-center space-y-4"
        >
          {/* Orbital ring */}
          <div className="flex justify-center">
            <motion.div
              animate={isPlaying ? { rotate: 360 } : { rotate: 0 }}
              transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
              className="w-16 h-16 rounded-full border-2 flex items-center justify-center"
              style={{ borderColor: `${color}40`, boxShadow: isPlaying ? `0 0 20px ${color}30` : "none" }}
            >
              <span className="text-2xl" style={{ color }}>{isSpeaking ? "◉" : "◦"}</span>
            </motion.div>
          </div>

          {/* Affirmation text */}
          <div className="min-h-[80px] flex items-center justify-center">
            <p className="font-mono text-lg sm:text-xl leading-relaxed text-center max-w-md mx-auto"
              style={{ color: "#F0EAFF", textShadow: isPlaying ? `0 0 20px ${color}50` : "none" }}>
              "{current.text}"
            </p>
          </div>

          <p className="font-mono text-[8px] tracking-[0.4em] uppercase" style={{ color: `${color}60` }}>
            {currentIdx + 1} of {affirmations.length} · {current.category}
          </p>
        </motion.div>
      </AnimatePresence>

      {/* Progress dots */}
      <div className="flex justify-center gap-1.5 flex-wrap max-w-xs mx-auto">
        {affirmations.slice(0, 20).map((_, i) => (
          <button
            key={i}
            onClick={() => goTo(i)}
            className="w-1.5 h-1.5 rounded-full transition-all"
            style={{
              background: i === currentIdx ? color : `${color}30`,
              transform: i === currentIdx ? "scale(1.4)" : "scale(1)",
            }}
          />
        ))}
      </div>

      {/* Controls */}
      <div className="flex items-center justify-center gap-6">
        <button onClick={prev} className="p-2 transition-all hover:opacity-70" style={{ color: `${color}60` }}>
          <SkipBack className="w-5 h-5" />
        </button>
        <button
          onClick={togglePlay}
          className="w-14 h-14 rounded-full border-2 flex items-center justify-center transition-all"
          style={{
            borderColor: color,
            background: isPlaying ? `${color}25` : "transparent",
            boxShadow: isPlaying ? `0 0 25px ${color}40` : "none",
            color,
          }}
        >
          {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6 ml-0.5" />}
        </button>
        <button onClick={next} className="p-2 transition-all hover:opacity-70" style={{ color: `${color}60` }}>
          <SkipForward className="w-5 h-5" />
        </button>
      </div>

      {/* Settings */}
      <div className="flex items-center justify-center gap-6 flex-wrap">
        <label className="flex items-center gap-2 cursor-pointer">
          <div
            onClick={() => setAutoAdvance(p => !p)}
            className="w-8 h-4 rounded-full relative transition-all cursor-pointer"
            style={{ background: autoAdvance ? `${color}50` : "rgba(255,255,255,0.08)" }}
          >
            <div className="absolute top-0.5 w-3 h-3 rounded-full transition-all"
              style={{ background: autoAdvance ? color : "rgba(255,255,255,0.3)", left: autoAdvance ? "18px" : "2px" }} />
          </div>
          <span className="font-mono text-[9px] tracking-widest uppercase" style={{ color: "rgba(220,210,255,0.4)" }}>Auto</span>
        </label>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[9px] tracking-widest uppercase" style={{ color: "rgba(220,210,255,0.4)" }}>Interval</span>
          <select
            value={intervalSecs}
            onChange={e => setIntervalSecs(Number(e.target.value))}
            className="bg-black/40 border font-mono text-[9px] px-2 py-1 focus:outline-none"
            style={{ borderColor: `${color}25`, color: "rgba(220,210,255,0.6)" }}
          >
            {[5, 8, 12, 20, 30].map(s => (
              <option key={s} value={s}>{s}s</option>
            ))}
          </select>
        </div>
      </div>

      {anima && (
        <p className="text-center font-mono text-[9px] tracking-widest uppercase" style={{ color: "rgba(167,139,250,0.3)" }}>
          Voiced by {anima.name}
        </p>
      )}
    </div>
  );
}