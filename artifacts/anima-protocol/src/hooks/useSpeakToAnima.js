import { useCallback, useRef, useState } from 'react';
import { speakToAnima as speakToAnimaFn } from '@/components/voice/speakToAnima';

/**
 * Hook: speaks text with the active character's assigned ElevenLabs voice.
 * Includes simple concurrency control so "speak" calls won't overlap.
 */
export function useSpeakToAnima() {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [error, setError] = useState(null);
  const audioRef = useRef(null);

  const stop = useCallback(() => {
    try {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
        audioRef.current = null;
      }
    } catch {
      // ignore
    }
    setIsSpeaking(false);
  }, []);

  const speak = useCallback(
    async ({
      text,
      characterId,
      voiceId,
      emotion = 'neutral',
      intensity = 5,
    }) => {
      if (!text || !text.trim()) return;
      stop();
      setError(null);
      setIsSpeaking(true);

      try {
        const { audioUrl } = await speakToAnimaFn({
          text,
          characterId,
          voiceId,
          emotion,
          intensity,
        });

        if (!audioUrl) {
          setIsSpeaking(false);
          return;
        }

        const audio = new Audio(audioUrl);
        audioRef.current = audio;

        await audio.play().catch(() => {
          // play() may reject if user gesture is missing
          throw new Error('Playback blocked by the browser. Try again after a user gesture.');
        });

        audio.onended = () => {
          setIsSpeaking(false);
          try {
            URL.revokeObjectURL(audioUrl);
          } catch {
            // ignore
          }
        };

        audio.onerror = () => {
          setIsSpeaking(false);
          try {
            URL.revokeObjectURL(audioUrl);
          } catch {
            // ignore
          }
        };
      } catch (e) {
        setError(e?.message || String(e));
        setIsSpeaking(false);
        stop();
      }
    },
    [stop]
  );

  return { isSpeaking, error, speak, stop };
}

