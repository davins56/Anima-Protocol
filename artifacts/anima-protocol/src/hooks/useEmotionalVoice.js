import { useState, useCallback, useRef } from 'react';
import { speakToAnima } from '@/components/voice/speakToAnima';

/**
 * Hook to manage emotional voice synthesis with ElevenLabs.
 * Plays through POST /api/tts so replay always settles (success or error).
 */
export function useEmotionalVoice() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const audioRef = useRef(null);

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
      audioRef.current = null;
    }
    setIsPlaying(false);
    setIsLoading(false);
  }, []);

  const speakWithEmotion = useCallback(async (
    text,
    voiceId,
    characterId,
    emotion = 'neutral',
    intensity = 5
  ) => {
    if (!text) return;

    stop();
    setError(null);
    setIsLoading(true);
    try {
      const { audioUrl } = await speakToAnima({
        text,
        voiceId,
        characterId,
        emotion,
        intensity,
      });

      if (!audioUrl) {
        setIsLoading(false);
        return;
      }

      const audio = new Audio(audioUrl);
      audioRef.current = audio;
      audio.onended = () => {
        URL.revokeObjectURL(audioUrl);
        setIsPlaying(false);
        audioRef.current = null;
      };
      audio.onerror = () => {
        URL.revokeObjectURL(audioUrl);
        setIsPlaying(false);
        audioRef.current = null;
        setError('Playback failed');
      };

      await audio.play();
      setIsPlaying(true);
    } catch (err) {
      console.error('Emotional voice synthesis error:', err);
      setError(err?.message || 'Voice replay failed');
      setIsPlaying(false);
    } finally {
      setIsLoading(false);
    }
  }, [stop]);

  return {
    speakWithEmotion,
    isPlaying,
    isLoading,
    error,
    stop,
    audioRef,
  };
}
