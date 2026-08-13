import { Volume2, VolumeX, Loader } from 'lucide-react';
import { motion } from 'framer-motion';
import { useEmotionalVoice } from '@/hooks/useEmotionalVoice';

/**
 * Per-message replay for a companion / Anima line.
 * Uses POST /api/tts (server default voice when no clone is assigned).
 */
export default function EmotionalVoiceSynthesis({
  content,
  characterId,
  characterName,
  characterEmotion = 'neutral',
  characterEmotionIntensity = 5,
  voiceId = null,
  onPlay,
  onStop,
}) {
  const { speakWithEmotion, isPlaying, isLoading, error, stop } = useEmotionalVoice();

  const handleSpeak = () => {
    speakWithEmotion(
      content,
      voiceId,
      characterId,
      characterEmotion,
      characterEmotionIntensity
    );
    onPlay?.();
  };

  const handleStop = () => {
    stop();
    onStop?.();
  };

  return (
    <motion.button
      type="button"
      whileHover={{ scale: 1.1 }}
      onClick={isPlaying ? handleStop : handleSpeak}
      disabled={isLoading}
      className={`flex items-center justify-center w-5 h-5 rounded-full transition-all ${
        isPlaying
          ? 'bg-green-500/30 text-green-400'
          : isLoading
          ? 'bg-yellow-500/20 text-yellow-400'
          : error
          ? 'bg-red-500/20 text-red-400'
          : 'bg-primary/20 text-primary/60 hover:text-primary'
      }`}
      title={
        isLoading
          ? 'Loading voice…'
          : isPlaying
          ? 'Stop playing'
          : error
          ? `Replay failed: ${error}`
          : `Hear ${characterName || 'Anima'}'s voice (${characterEmotion})`
      }
      aria-label={isPlaying ? 'Stop voice replay' : 'Replay voice'}
    >
      {isLoading ? (
        <Loader className="w-3 h-3 animate-spin" />
      ) : isPlaying ? (
        <VolumeX className="w-3 h-3" />
      ) : (
        <Volume2 className="w-3 h-3" />
      )}
    </motion.button>
  );
}
