import { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useEmotionalVoice } from '@/hooks/useEmotionalVoice';
import { Volume2, VolumeX } from 'lucide-react';
import { motion } from 'framer-motion';

/**
 * Component that manages emotional voice synthesis for a character message.
 * Automatically adjusts voice based on character's emotional state.
 */
export default function EmotionalVoiceSynthesis({
  content,
  characterId,
  characterName,
  characterEmotion = 'neutral',
  characterEmotionIntensity = 5,
  onPlay,
  onStop,
}) {
  const { speakWithEmotion, isPlaying, isLoading, stop } = useEmotionalVoice();
  const [voiceId, setVoiceId] = useState(null);
  const [hasVoice, setHasVoice] = useState(false);

  // Load character's voice ID on mount
  useEffect(() => {
    if (!characterId) return;

    base44.entities.Character.list()
      .then(chars => {
        const char = chars.find(c => c.id === characterId);
        if (char?.elevenlabs_voice_id) {
          setVoiceId(char.elevenlabs_voice_id);
          setHasVoice(true);
        }
      })
      .catch(() => setHasVoice(false));
  }, [characterId]);

  const handleSpeak = () => {
    if (!voiceId) {
      console.warn('No voice ID available for character');
      return;
    }

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

  if (!hasVoice) return null;

  return (
    <motion.button
      whileHover={{ scale: 1.1 }}
      onClick={isPlaying ? handleStop : handleSpeak}
      disabled={isLoading}
      className={`flex items-center justify-center w-5 h-5 rounded-full transition-all ${
        isPlaying
          ? 'bg-green-500/30 text-green-400'
          : isLoading
          ? 'bg-yellow-500/20 text-yellow-400 animate-pulse'
          : 'bg-primary/20 text-primary/60 hover:text-primary'
      }`}
      title={isPlaying ? 'Stop playing' : `Hear ${characterName}'s voice (${characterEmotion})`}
    >
      {isPlaying ? (
        <VolumeX className="w-3 h-3" />
      ) : (
        <Volume2 className="w-3 h-3" />
      )}
    </motion.button>
  );
}