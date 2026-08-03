import { useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';

// Global voice cache to prevent multiple API calls
let voiceCache = null;
let voiceCachePromise = null;

export function useElevenLabsVoiceCache() {
  const isMountedRef = useRef(true);

  useEffect(() => {
    // Preload voices on mount (fires once per app lifecycle)
    if (!voiceCache && !voiceCachePromise) {
      voiceCachePromise = base44.functions.invoke('elevenLabsVoices', {})
        .then((res) => {
          voiceCache = res?.data?.voices || [];
          return voiceCache;
        })
        .catch((err) => {
          console.warn('Failed to preload ElevenLabs voices:', err);
          return [];
        });
    }

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  return {
    getVoices: async () => {
      if (voiceCache) return voiceCache;
      if (voiceCachePromise) return voiceCachePromise;
      return [];
    },
  };
}