import { useState, useEffect, useRef, useCallback } from 'react';
import { base44 } from '@/api/base44Client';

export function useAmbientAudio(sessionId, location, characterEmotions, narrativeContext) {
  const audioRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(0.6);
  const [currentTrack, setCurrentTrack] = useState(null);
  const [tempo, setTempo] = useState(100);
  const [intensity, setIntensity] = useState(0.5);
  const [loading, setLoading] = useState(false);

  const fetchTrack = useCallback(async () => {
    if (!sessionId) return;

    setLoading(true);
    try {
      const result = await base44.functions.invoke('generateAmbientAudioContext', {
        location: location || 'unknown',
        emotional_state: Object.values(characterEmotions).reduce((avg, e) => avg + (e?.emotion || ''), '') || '',
        narrative_context: narrativeContext || '',
        character_emotions: characterEmotions || {},
      });

      if (result?.data?.track) {
        setCurrentTrack(result.data.track);
        setTempo(result.data.track.tempo);
        setIntensity(result.data.track.intensity);

        if (audioRef.current) {
          audioRef.current.src = result.data.track.url;
          audioRef.current.volume = volume;
          if (isPlaying) {
            audioRef.current.play().catch(() => {});
          }
        }
      }
    } catch (error) {
      console.error('Ambient audio error:', error);
    } finally {
      setLoading(false);
    }
  }, [sessionId, location, characterEmotions, narrativeContext, isPlaying, volume]);

  // Fetch on mount and location/emotion changes
  useEffect(() => {
    fetchTrack();
  }, [location, characterEmotions, fetchTrack]);

  // Auto-update every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      if (isPlaying && sessionId) {
        fetchTrack();
      }
    }, 30000);

    return () => clearInterval(interval);
  }, [isPlaying, sessionId, fetchTrack]);

  const togglePlay = useCallback(() => {
    if (!currentTrack) {
      fetchTrack();
      setIsPlaying(true);
    } else {
      if (isPlaying) {
        audioRef.current?.pause();
      } else {
        audioRef.current?.play().catch(() => {});
      }
      setIsPlaying(!isPlaying);
    }
  }, [currentTrack, isPlaying, fetchTrack]);

  const setVol = useCallback((newVolume) => {
    setVolume(newVolume);
    if (audioRef.current) {
      audioRef.current.volume = newVolume;
    }
  }, []);

  return {
    audioRef,
    isPlaying,
    togglePlay,
    volume,
    setVolume: setVol,
    currentTrack,
    tempo,
    intensity,
    loading,
    fetchTrack,
  };
}