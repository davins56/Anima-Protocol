import { useEffect, useState } from "react";
import { Loader, Cloud, Zap, Heart } from "lucide-react";
import { motion } from "framer-motion";

const emotionColors = {
  joyful: "from-yellow-500 to-orange-400",
  calm: "from-blue-500 to-cyan-400",
  sad: "from-slate-500 to-blue-600",
  angry: "from-red-500 to-orange-500",
  afraid: "from-orange-600 to-red-600",
  hopeful: "from-green-400 to-cyan-400",
  conflicted: "from-purple-500 to-pink-500",
  desperate: "from-red-600 to-purple-700",
  peaceful: "from-indigo-400 to-blue-400",
  neutral: "from-slate-400 to-slate-500",
};

const toneDescriptions = {
  uplifting: "The story radiates hope and joy. Characters are optimistic despite challenges.",
  serene: "A calm, peaceful atmosphere. The narrative unfolds at a measured pace.",
  melancholic: "Sadness and reflection permeate the story. Themes of loss and acceptance.",
  tense: "High stakes and conflict. The narrative crackles with urgency and anger.",
  ominous: "Dread and fear create an unsettling atmosphere. Something dark approaches.",
  optimistic: "Forward momentum and possibility. Characters believe in a better outcome.",
  turbulent: "Clashing emotions and inner turmoil. Characters face internal contradictions.",
  crisis: "Desperate stakes. The story teeters on a knife's edge. Last chances matter.",
  complex: "Multiple emotional currents flowing through the narrative.",
};

export default function EmotionalClimatePanel({ sessionId, climateData, loading }) {
  const climate = climateData?.emotional_climate;
  const characters = climateData?.character_emotions || [];

  if (loading) {
    return (
      <div className="p-4 border border-primary/20 bg-black/30 rounded text-center">
        <Loader className="w-4 h-4 text-primary/60 animate-spin mx-auto mb-2" />
        <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase">
          Analyzing emotional climate...
        </p>
      </div>
    );
  }

  if (!climate) return null;

  const gradientClass = emotionColors[climate.dominant_emotion] || emotionColors.neutral;

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4"
    >
      {/* Main Climate Card */}
      <div className={`bg-gradient-to-r ${gradientClass} p-0.5 rounded overflow-hidden`}>
        <div className="bg-background p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-mono text-sm text-primary tracking-widest uppercase">
                Emotional Climate
              </h3>
              <p className="text-[10px] font-mono text-primary/60 mt-0.5">
                {climate.narrative_tone.toUpperCase()}
              </p>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold text-primary">
                {climate.average_intensity}/10
              </div>
              <p className="text-[8px] font-mono text-primary/40 tracking-widest">
                INTENSITY
              </p>
            </div>
          </div>

          {/* Description */}
          <p className="text-[9px] font-mono text-primary/70 leading-relaxed border-l-2 border-primary/30 pl-2">
            {toneDescriptions[climate.narrative_tone] || "A complex emotional tapestry unfolds."}
          </p>

          {/* Emotion Distribution */}
          <div>
            <p className="text-[8px] font-mono text-primary/40 tracking-widest uppercase mb-2">
              Emotion Distribution ({climate.total_characters} characters)
            </p>
            <div className="space-y-1">
              {Object.entries(climate.emotion_distribution).map(([emotion, count]) => (
                <div key={emotion} className="flex items-center gap-2">
                  <span className="text-[8px] font-mono text-primary/50 w-16 truncate">
                    {emotion}
                  </span>
                  <div className="flex-1 h-1.5 bg-primary/10 border border-primary/20 rounded overflow-hidden">
                    <div
                      className="h-full bg-primary/60"
                      style={{
                        width: `${(count / climate.total_characters) * 100}%`,
                      }}
                    />
                  </div>
                  <span className="text-[8px] font-mono text-primary/40 w-6 text-right">
                    {count}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Character Emotions Grid */}
      {characters.length > 0 && (
        <div className="border border-primary/15 bg-black/30 rounded p-3 space-y-2">
          <p className="text-[8px] font-mono text-primary/40 tracking-widest uppercase">
            Character Emotional States
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto">
            {characters.map((char, idx) => (
              <motion.div
                key={char.character_id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.05 }}
                className="p-2 bg-black/40 border border-primary/10 rounded"
              >
                <div className="flex items-start justify-between gap-2 mb-1">
                  <p className="text-[9px] font-mono text-primary/80 font-semibold truncate">
                    {char.character_name}
                  </p>
                  <span className="text-[7px] font-mono text-primary/40 flex-shrink-0">
                    {char.intensity}/10
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-primary/60" />
                  <p className="text-[8px] font-mono text-primary/60">
                    {char.emotion}
                    {char.secondary && ` + ${char.secondary}`}
                  </p>
                </div>
                {char.trigger && (
                  <p className="text-[7px] font-mono text-primary/40 mt-0.5 line-clamp-1">
                    Trigger: {char.trigger}
                  </p>
                )}
              </motion.div>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}