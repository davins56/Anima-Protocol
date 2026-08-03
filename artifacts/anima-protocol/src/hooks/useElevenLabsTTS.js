import { useRef, useState, useCallback } from 'react';
import { appParams } from '@/lib/app-params';

async function fetchTTSAudio(functionName, payload) {
  const { appId, appBaseUrl, functionsVersion } = appParams;
  const baseUrl = appBaseUrl || '';
  const version = functionsVersion || 'v3';
  const url = `${baseUrl}/api/apps/${appId}/functions/${version}/${functionName}`;

  const token = localStorage.getItem('base44_access_token') || localStorage.getItem('token');
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    credentials: 'include',
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`TTS failed: ${response.status} ${errText}`);
  }

  return response.blob();
}

export function useElevenLabsTTS() {
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

  const speak = useCallback(async (text, voiceId) => {
    if (!isEnabled || !text) return;
    stop();

    const clean = text
      .replace(/\*[^*]*\*/g, '')
      .replace(/\[[^\]]*\]/g, '')
      .replace(/#{1,6}\s/g, '')
      .trim();

    if (!clean) return;

    setIsSpeaking(true);
    try {
      const blob = await fetchTTSAudio('elevenLabsTTS', {
        text: clean,
        voice_id: voiceId || null,
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
    } catch (err) {
      console.error('ElevenLabs TTS error:', err);
      setIsSpeaking(false);
    }
  }, [isEnabled, stop]);

  const toggle = useCallback(() => {
    setIsEnabled((v) => {
      if (v) stop();
      return !v;
    });
  }, [stop]);

  return { isEnabled, isSpeaking, speak, stop, toggle };
}