import { useRef, useState, useCallback } from 'react';
import { apiUrl } from '@/lib/apiOrigin';

function stripMarkup(text) {
  return text
    .replace(/\*[^*]*\*/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/#{1,6}\s/g, '')
    .trim();
}

async function fetchTTSAudio(payload) {
  const res = await fetch(apiUrl('/tts'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    let msg = `${res.status}`;
    try {
      const j = await res.json();
      if (j?.error) msg = j.error;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(`TTS failed: ${msg}`);
  }

  return res.blob();
}

export function useEmotionalTTS() {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isEnabled, setIsEnabled] = useState(false);
  const audioRef = useRef(null);

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
      audioRef.current = null;
    }
    setIsSpeaking(false);
  }, []);

  // Emotion + intensity are forwarded to the server, which maps them to
  // ElevenLabs voice_settings (stability / style) for an expressive delivery.
  const speakWithEmotion = useCallback(async (content, voiceId, emotion = 'neutral', intensity = 5) => {
    if (!isEnabled || !content) return;
    stop();

    const clean = stripMarkup(content);
    if (!clean) return;

    setIsSpeaking(true);
    try {
      const blob = await fetchTTSAudio({
        text: clean,
        voice_id: voiceId || null,
        emotion,
        intensity,
      });

      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;

      audio.onended = () => {
        URL.revokeObjectURL(url);
        setIsSpeaking(false);
        audioRef.current = null;
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        setIsSpeaking(false);
        audioRef.current = null;
      };

      audio.play();
    } catch (error) {
      console.error('EmotionalTTS error:', error);
      setIsSpeaking(false);
    }
  }, [isEnabled, stop]);

  const toggle = useCallback(() => {
    setIsEnabled((v) => {
      if (v) stop();
      return !v;
    });
  }, [stop]);

  return { isEnabled, isSpeaking, speakWithEmotion, stop, toggle };
}
