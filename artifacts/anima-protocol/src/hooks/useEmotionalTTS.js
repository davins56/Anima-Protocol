import { useRef, useState, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
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

  const speakWithEmotion = useCallback(async (content, voiceId, emotion = 'neutral', intensity = 5) => {
    if (!isEnabled || !voiceId || !content) return;
    stop();

    const clean = content
      .replace(/\*[^*]*\*/g, '')
      .replace(/\[[^\]]*\]/g, '')
      .replace(/#{1,6}\s/g, '')
      .trim();

    if (!clean) return;

    setIsSpeaking(true);
    try {
      // Get emotion-adjusted voice parameters
      let voiceParams = {};
      try {
        const paramRes = await base44.functions.invoke('adjustVoiceForEmotion', { emotion, intensity });
        voiceParams = paramRes.data?.voice_params || {};
      } catch (e) {
        console.warn('Could not get emotion voice params, using defaults');
      }

      const blob = await fetchTTSAudio('elevenLabsTTS', {
        text: clean,
        voice_id: voiceId,
        stability: voiceParams.stability || 0.5,
        similarity_boost: voiceParams.similarity || 0.75,
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

  return { speakWithEmotion, stop, isEnabled, isSpeaking, toggle };
}