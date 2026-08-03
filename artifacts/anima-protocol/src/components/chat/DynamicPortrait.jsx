import { useState, useEffect } from "react";
import { Loader } from "lucide-react";
import { motion } from "framer-motion";

const emotionColors = {
  joyful: "from-yellow-400 to-orange-400",
  calm: "from-blue-400 to-cyan-400",
  sad: "from-blue-600 to-indigo-600",
  angry: "from-red-600 to-orange-600",
  afraid: "from-purple-600 to-pink-600",
  disgusted: "from-green-600 to-emerald-600",
  surprised: "from-yellow-500 to-pink-500",
  hopeful: "from-green-400 to-emerald-400",
  conflicted: "from-purple-400 to-pink-400",
  desperate: "from-red-500 to-purple-500",
};

const emotionLabels = {
  joyful: "😊 Joyful",
  calm: "😌 Calm",
  sad: "😢 Sad",
  angry: "😠 Angry",
  afraid: "😨 Afraid",
  disgusted: "🤢 Disgusted",
  surprised: "😲 Surprised",
  hopeful: "🙂 Hopeful",
  conflicted: "🤔 Conflicted",
  desperate: "😩 Desperate",
};

export default function DynamicPortrait({
  character,
  emotion = "calm",
  intensity = 5,
  onGeneratePortrait,
}) {
  const [portraitUrl, setPortraitUrl] = useState(character?.avatar_url);
  const [isGenerating, setIsGenerating] = useState(false);
  const [lastEmotion, setLastEmotion] = useState(emotion);

  // Generate new portrait when emotion changes significantly
  useEffect(() => {
    if (emotion !== lastEmotion && onGeneratePortrait && !isGenerating) {
      setIsGenerating(true);
      onGeneratePortrait(
        character?.name,
        character?.personality,
        emotion,
        intensity,
        portraitUrl
      )
        .then((url) => {
          if (url) {
            setPortraitUrl(url);
            setLastEmotion(emotion);
          }
        })
        .catch((err) => console.error("Portrait generation error:", err))
        .finally(() => setIsGenerating(false));
    }
  }, [emotion, intensity, character, onGeneratePortrait, lastEmotion, isGenerating]);

  const colorGradient = emotionColors[emotion] || emotionColors.calm;

  return (
    <div className="flex flex-col items-center gap-2">
      {/* Portrait Container */}
      <div className="relative w-24 h-32 sm:w-32 sm:h-48 rounded-lg overflow-hidden border-2 border-primary/40">
        {/* Background Gradient based on emotion */}
        <div
          className={`absolute inset-0 bg-gradient-to-b ${colorGradient} opacity-20`}
        />

        {/* Portrait Image */}
        {portraitUrl ? (
          <motion.img
            key={portraitUrl}
            src={portraitUrl}
            alt={character?.name}
            className="w-full h-full object-cover"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4 }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-primary/5">
            <span className="text-3xl sm:text-5xl">
              {character?.name?.[0] || "?"}
            </span>
          </div>
        )}

        {/* Emotion Overlay */}
        <motion.div
          className="absolute inset-0 opacity-0 pointer-events-none"
          animate={{
            backgroundColor: `hsl(0, 0%, 0%, ${intensity / 10 * 0.3})`,
            opacity: intensity / 10,
          }}
          transition={{ duration: 0.3 }}
        />

        {/* Loading Indicator */}
        {isGenerating && (
          <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
            <Loader className="w-4 sm:w-6 h-4 sm:h-6 text-primary animate-spin" />
          </div>
        )}
      </div>

      {/* Character Info */}
      <div className="text-center">
        <h3 className="font-mono text-[10px] sm:text-xs text-primary tracking-wider uppercase">
          {character?.name}
        </h3>
        <div className="flex items-center justify-center gap-1.5 mt-1">
          <span
            className="text-[8px] sm:text-[9px] font-mono tracking-widest uppercase"
            style={{ color: Object.values(emotionColors)[Object.keys(emotionColors).indexOf(emotion)] || "#868e96" }}
          >
            {emotionLabels[emotion] || emotion}
          </span>
          {/* Intensity Bar */}
          <div className="w-12 h-1 border border-primary/20 rounded bg-black/40">
            <motion.div
              className="h-full bg-primary/60 rounded transition-all"
              animate={{ width: `${(intensity / 10) * 100}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}