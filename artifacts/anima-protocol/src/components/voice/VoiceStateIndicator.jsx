import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Volume2, Pause } from 'lucide-react';

const EMOTION_COLORS = {
  joyful: { bg: 'bg-green-500/20', border: 'border-green-400', text: 'text-green-400', glow: '#22c55e' },
  calm: { bg: 'bg-blue-500/20', border: 'border-blue-400', text: 'text-blue-400', glow: '#3b82f6' },
  sad: { bg: 'bg-cyan-500/20', border: 'border-cyan-400', text: 'text-cyan-400', glow: '#06b6d4' },
  angry: { bg: 'bg-red-500/20', border: 'border-red-400', text: 'text-red-400', glow: '#ef4444' },
  afraid: { bg: 'bg-orange-500/20', border: 'border-orange-400', text: 'text-orange-400', glow: '#f97316' },
  surprised: { bg: 'bg-yellow-500/20', border: 'border-yellow-400', text: 'text-yellow-400', glow: '#eab308' },
  hopeful: { bg: 'bg-lime-500/20', border: 'border-lime-400', text: 'text-lime-400', glow: '#84cc16' },
  conflicted: { bg: 'bg-pink-500/20', border: 'border-pink-400', text: 'text-pink-400', glow: '#ec4899' },
  neutral: { bg: 'bg-primary/20', border: 'border-primary/40', text: 'text-primary/60', glow: 'hsl(185 100% 50%)' },
};

export default function VoiceStateIndicator({
  isPlaying,
  isPaused,
  emotion = 'neutral',
  intensity = 5,
  characterName,
  onPause,
  onResume,
  onStop,
}) {
  const [waveform, setWaveform] = useState(Array(8).fill(0));
  const colors = EMOTION_COLORS[emotion] || EMOTION_COLORS.neutral;

  // Animate waveform based on playback state
  useEffect(() => {
    if (!isPlaying) {
      setWaveform(Array(8).fill(0));
      return;
    }

    const interval = setInterval(() => {
      const newWaveform = Array(8).fill(0).map(() => {
        const baseIntensity = intensity / 10;
        return Math.random() * baseIntensity * (isPaused ? 0.3 : 1);
      });
      setWaveform(newWaveform);
    }, 150);

    return () => clearInterval(interval);
  }, [isPlaying, intensity, isPaused]);

  if (!isPlaying) {
    return null;
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className={`p-4 border rounded-lg space-y-3 ${colors.bg} ${colors.border} border`}
      style={{
        boxShadow: `0 0 20px ${colors.glow}30`,
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-1">
          <Volume2 className={`w-4 h-4 ${colors.text}`} />
          <div className="flex-1 min-w-0">
            <p className={`font-mono text-[9px] ${colors.text} tracking-widest uppercase`}>
              {characterName || 'Voice'} Speaking
            </p>
            <p className={`text-[8px] font-mono mt-0.5 ${colors.text.replace('text', 'text-opacity-60')}`}>
              {emotion.charAt(0).toUpperCase() + emotion.slice(1)} • {intensity}/10
            </p>
          </div>
        </div>

        {/* Controls */}
        <div className="flex gap-1.5">
          {isPaused ? (
            <button
              onClick={onResume}
              className={`px-2 py-1 border rounded text-[8px] font-mono tracking-widest uppercase transition-all ${colors.border} ${colors.text} hover:${colors.bg}`}
            >
              Resume
            </button>
          ) : (
            <button
              onClick={onPause}
              className={`px-2 py-1 border rounded text-[8px] font-mono tracking-widest uppercase transition-all ${colors.border} ${colors.text} hover:${colors.bg}`}
            >
              <Pause className="w-3 h-3" />
            </button>
          )}
          <button
            onClick={onStop}
            className={`px-2 py-1 border rounded text-[8px] font-mono tracking-widest uppercase transition-all ${colors.border} ${colors.text} hover:${colors.bg}`}
          >
            Stop
          </button>
        </div>
      </div>

      {/* Waveform Visualization */}
      <div className="flex items-end justify-center gap-1 h-16 py-2">
        {waveform.map((height, idx) => (
          <motion.div
            key={idx}
            initial={{ height: 0 }}
            animate={{ height: `${height * 100}%` }}
            className={`flex-1 rounded-t ${colors.border} border-t transition-all`}
            style={{
              background: `linear-gradient(to top, ${colors.glow}40, ${colors.glow}10)`,
              minHeight: '4px',
            }}
          />
        ))}
      </div>

      {/* Emotional Intensity Bar */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-[8px] font-mono">
          <span className={colors.text}>Emotional Intensity</span>
          <span className={`${colors.text} opacity-60`}>{intensity}/10</span>
        </div>
        <div className={`h-1.5 border rounded-full overflow-hidden ${colors.border} border`}>
          <motion.div
            animate={{ width: `${intensity * 10}%` }}
            className="h-full rounded-full transition-all"
            style={{ background: `linear-gradient(90deg, ${colors.glow}, ${colors.glow}60)` }}
          />
        </div>
      </div>

      {/* Tone Description */}
      <div className={`text-[8px] font-mono ${colors.text} opacity-70`}>
        {getToneDescription(emotion, intensity)}
      </div>
    </motion.div>
  );
}

function getToneDescription(emotion, intensity) {
  const descriptions = {
    joyful: intensity > 7 ? 'Enthusiastic & energetic' : 'Warm & friendly',
    calm: intensity > 7 ? 'Serene & meditative' : 'Relaxed & composed',
    sad: intensity > 7 ? 'Deeply melancholic' : 'Gentle & somber',
    angry: intensity > 7 ? 'Intense & heated' : 'Frustrated & stern',
    afraid: intensity > 7 ? 'Panicked & urgent' : 'Nervous & cautious',
    surprised: intensity > 7 ? 'Shocked & amazed' : 'Intrigued & curious',
    hopeful: intensity > 7 ? 'Optimistic & inspiring' : 'Cautiously optimistic',
    conflicted: intensity > 7 ? 'Torn & distressed' : 'Uncertain & thoughtful',
    neutral: 'Even & balanced',
  };
  return descriptions[emotion] || 'Neutral tone';
}