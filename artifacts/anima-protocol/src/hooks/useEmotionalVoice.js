import { useState, useCallback, useRef } from 'react';
import { speakToAnima } from '@/components/voice/speakToAnima';

// A tiny silent WAV. Playing it inside the tap unlocks the <audio> element on
// iOS Safari, so the real clip can start after the /api/tts round-trip
// without being rejected as autoplay (NotAllowedError).
export const SILENT_WAV =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

function speechSynth() {
  try {
    const s = globalThis.speechSynthesis;
    return s && typeof globalThis.SpeechSynthesisUtterance === 'function' ? s : null;
  } catch {
    return null;
  }
}

/** Strip roleplay markup so the device voice reads only the spoken words. */
export function speakableText(text) {
  return (text || '')
    .replace(/\*[^*]*\*/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/#{1,6}\s/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Hook for the per-message "hear this line" button.
 *
 * Plays through POST /api/tts (ElevenLabs). The audio element is created and
 * unlocked synchronously inside the tap, because iOS blocks play() that starts
 * after an await. If the server voice is unavailable (no key, quota, network),
 * the line is read with the device's own speech synthesis instead of failing
 * silently. The tap itself is the request to hear the line.
 */
export function useEmotionalVoice() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const audioRef = useRef(null);
  const runRef = useRef(0);

  const stop = useCallback(() => {
    runRef.current += 1;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeAttribute?.('src');
      audioRef.current = null;
    }
    try {
      speechSynth()?.cancel();
    } catch {
      /* ignore */
    }
    setIsPlaying(false);
    setIsLoading(false);
  }, []);

  const speakOnDevice = useCallback((text, run) => {
    const synth = speechSynth();
    const words = speakableText(text);
    if (!synth || !words) return false;
    const utter = new globalThis.SpeechSynthesisUtterance(words.slice(0, 4000));
    utter.onend = () => {
      if (runRef.current === run) setIsPlaying(false);
    };
    utter.onerror = () => {
      if (runRef.current === run) {
        setIsPlaying(false);
        setError('Device voice failed');
      }
    };
    synth.cancel();
    synth.speak(utter);
    setIsPlaying(true);
    return true;
  }, []);

  const speakWithEmotion = useCallback((
    text,
    voiceId,
    characterId,
    emotion = 'neutral',
    intensity = 5
  ) => {
    if (!text) return Promise.resolve();

    stop();
    const run = runRef.current;
    setError(null);
    setIsLoading(true);

    // Inside the user gesture: unlock an audio element for later playback.
    let audio = null;
    try {
      audio = new Audio();
      audio.playsInline = true;
      audio.src = SILENT_WAV;
      const p = audio.play();
      p?.catch?.(() => {});
    } catch {
      audio = null;
    }
    audioRef.current = audio;
    // iOS also gates speechSynthesis on a gesture: an empty utterance now lets
    // the device-voice fallback speak after the network call.
    try {
      const synth = speechSynth();
      if (synth) synth.speak(new globalThis.SpeechSynthesisUtterance(''));
    } catch {
      /* ignore */
    }

    const fallback = (reason) => {
      if (runRef.current !== run) return;
      if (audioRef.current === audio) audioRef.current = null;
      if (!speakOnDevice(text, run)) {
        setIsPlaying(false);
        setError(reason || 'Voice replay failed');
      }
    };

    return (async () => {
      try {
        const { audioUrl } = await speakToAnima({
          text,
          voiceId,
          characterId,
          emotion,
          intensity,
        });
        if (runRef.current !== run) {
          if (audioUrl) URL.revokeObjectURL(audioUrl);
          return;
        }
        if (!audioUrl) {
          setIsLoading(false);
          return;
        }

        const player = audio || new Audio();
        audioRef.current = player;
        player.onended = () => {
          URL.revokeObjectURL(audioUrl);
          if (runRef.current === run) setIsPlaying(false);
          if (audioRef.current === player) audioRef.current = null;
        };
        player.onerror = null;
        player.pause();
        player.src = audioUrl;
        try {
          await player.play();
          if (runRef.current === run) setIsPlaying(true);
        } catch (err) {
          URL.revokeObjectURL(audioUrl);
          console.warn('Voice clip playback blocked, using device voice:', err);
          fallback('Playback failed');
        }
      } catch (err) {
        console.warn('Server voice unavailable, using device voice:', err);
        fallback(err?.message || 'Voice replay failed');
      } finally {
        if (runRef.current === run) setIsLoading(false);
      }
    })();
  }, [stop, speakOnDevice]);

  return {
    speakWithEmotion,
    isPlaying,
    isLoading,
    error,
    stop,
    audioRef,
  };
}
