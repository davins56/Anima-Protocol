import { useEffect, useState } from "react";

/**
 * Maps character emotions to ElevenLabs voice parameters
 * Adjusts: stability, similarity_boost, style, speaker_boost
 */
export const emotionToVoiceParams = (emotion, intensity = 5) => {
  const baseParams = {
    stability: 0.5,
    similarity_boost: 0.75,
    style: 0,
    speaker_boost: true,
  };

  const intensityRatio = Math.max(0, Math.min(10, intensity)) / 10; // 0-1 range

  switch (emotion?.toLowerCase()) {
    case "joyful":
      return {
        ...baseParams,
        stability: 0.4 + intensityRatio * 0.2, // More variation when joyful
        similarity_boost: 0.85, // More character similarity
        style: 25 + intensityRatio * 25, // Add style (exaggeration)
        speaker_boost: true,
        pace: 1.1 + intensityRatio * 0.1, // Slightly faster
      };

    case "calm":
      return {
        ...baseParams,
        stability: 0.7 + intensityRatio * 0.15, // Very stable
        similarity_boost: 0.8,
        style: 5 + intensityRatio * 10,
        speaker_boost: true,
        pace: 0.95 - intensityRatio * 0.05, // Slightly slower
      };

    case "sad":
      return {
        ...baseParams,
        stability: 0.65 + intensityRatio * 0.15,
        similarity_boost: 0.7, // Less similar, more emotional
        style: 30 + intensityRatio * 20, // More emotional style
        speaker_boost: true,
        pace: 0.9 - intensityRatio * 0.1, // Slower pacing
      };

    case "angry":
      return {
        ...baseParams,
        stability: 0.3 + intensityRatio * 0.2, // High variation
        similarity_boost: 0.85,
        style: 50 + intensityRatio * 20, // Very expressive
        speaker_boost: true,
        pace: 1.2 + intensityRatio * 0.15, // Faster, more clipped
      };

    case "anxious":
      return {
        ...baseParams,
        stability: 0.4 + intensityRatio * 0.15, // Variable, jittery
        similarity_boost: 0.75,
        style: 40 + intensityRatio * 20, // Expressive anxiety
        speaker_boost: true,
        pace: 1.15 + intensityRatio * 0.1, // Faster speech
      };

    case "peaceful":
      return {
        ...baseParams,
        stability: 0.75 + intensityRatio * 0.2, // Very stable
        similarity_boost: 0.8,
        style: 10 + intensityRatio * 5,
        speaker_boost: true,
        pace: 0.9 - intensityRatio * 0.08,
      };

    case "hopeful":
      return {
        ...baseParams,
        stability: 0.55 + intensityRatio * 0.15,
        similarity_boost: 0.85,
        style: 20 + intensityRatio * 15, // Positive expression
        speaker_boost: true,
        pace: 1.05 + intensityRatio * 0.08,
      };

    case "conflicted":
      return {
        ...baseParams,
        stability: 0.45 + intensityRatio * 0.2, // Wavering
        similarity_boost: 0.7, // Less certain
        style: 35 + intensityRatio * 20,
        speaker_boost: true,
        pace: 1.0 + intensityRatio * 0.08,
      };

    default:
      return baseParams;
  }
};

/**
 * Hook to manage emotional voice synthesis
 * Integrates character emotions with TTS parameters
 */
export const useEmotionalVoice = () => {
  const [voiceParams, setVoiceParams] = useState(null);
  const [currentEmotion, setCurrentEmotion] = useState(null);

  const updateVoiceForEmotion = (emotion, intensity = 5) => {
    const params = emotionToVoiceParams(emotion, intensity);
    setVoiceParams(params);
    setCurrentEmotion(emotion);
    return params;
  };

  const resetVoice = () => {
    setVoiceParams(null);
    setCurrentEmotion(null);
  };

  return {
    voiceParams,
    currentEmotion,
    updateVoiceForEmotion,
    resetVoice,
  };
};

/**
 * Component for visual emotional voice feedback
 */
export default function EmotionalVoiceIndicator({ emotion, intensity }) {
  const params = emotionToVoiceParams(emotion, intensity);

  const getEmotionColor = () => {
    switch (emotion?.toLowerCase()) {
      case "joyful": return "#fbbf24";
      case "calm": return "#06b6d4";
      case "sad": return "#3b82f6";
      case "angry": return "#ef4444";
      case "anxious": return "#f59e0b";
      case "peaceful": return "#10b981";
      case "hopeful": return "#f59e0b";
      case "conflicted": return "#a78bfa";
      default: return "#6b7280";
    }
  };

  return (
    <div className="space-y-2 p-3 border border-primary/15 bg-black/30 rounded text-[8px] font-mono">
      <div className="flex items-center justify-between">
        <span className="text-primary/40 tracking-widest uppercase">Voice Emotion</span>
        <div
          className="w-2.5 h-2.5 rounded-full"
          style={{ backgroundColor: getEmotionColor() }}
        />
      </div>

      {/* Voice Parameters Visualization */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-primary/60">
          <span>Stability</span>
          <div className="flex-1 h-1 bg-black/60 rounded ml-2 overflow-hidden">
            <div
              className="h-full bg-cyan-400"
              style={{ width: `${params.stability * 100}%` }}
            />
          </div>
        </div>

        <div className="flex items-center justify-between text-primary/60">
          <span>Style</span>
          <div className="flex-1 h-1 bg-black/60 rounded ml-2 overflow-hidden">
            <div
              className="h-full bg-purple-400"
              style={{ width: `${params.style}%` }}
            />
          </div>
        </div>

        <div className="flex items-center justify-between text-primary/60">
          <span>Pace</span>
          <span className="ml-2 text-primary/40">
            {(params.pace || 1).toFixed(2)}x
          </span>
        </div>
      </div>

      <div className="pt-1.5 border-t border-primary/10 text-primary/50">
        <p className="capitalize">
          {emotion || "Neutral"} (Level {intensity})
        </p>
      </div>
    </div>
  );
}