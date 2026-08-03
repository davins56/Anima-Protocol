import { useState, useCallback, useRef } from 'react';
import { base44 } from '@/api/base44Client';

/**
 * Hook to manage emotional voice synthesis with ElevenLabs.
 * Automatically adjusts voice parameters based on character's emotional state.
 */
export function useEmotionalVoice() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const audioRef = useRef(null);

  const speakWithEmotion = useCallback(async (
    text,
    voiceId,
    characterId,
    emotion = 'neutral',
    intensity = 5
  ) => {
    if (!voiceId || !text) return;

    setIsLoading(true);
    try {
      // Get emotionally adjusted voice parameters
      const adjustmentResult = await base44.functions.invoke(
        'adjustVoiceEmotionalParameters',
        { character_id: characterId, emotion, intensity }
      );

      if (!adjustmentResult?.data?.voice_settings) {
        throw new Error('Failed to adjust voice parameters');
      }

      const voiceSettings = adjustmentResult.data.voice_settings;

      // Construct ElevenLabs TTS request with emotional parameters
      const ttsResponse = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'xi-api-key': '', // Will be handled server-side in production
          },
          body: JSON.stringify({
            text,
            model_id: 'eleven_monolingual_v1',
            voice_settings: {
              stability: voiceSettings.stability,
              similarity_boost: 0.85,
              style: voiceSettings.style,
              use_speaker_boost: voiceSettings.speaker_boost,
            },
          }),
        }
      );

      if (!ttsResponse.ok) {
        throw new Error(`TTS API error: ${ttsResponse.statusText}`);
      }

      const audioData = await ttsResponse.arrayBuffer();
      const audioBlob = new Blob([audioData], { type: 'audio/mpeg' });
      const audioUrl = URL.createObjectURL(audioBlob);

      // Play audio
      if (audioRef.current) {
        audioRef.current.src = audioUrl;
        audioRef.current.play().catch(err => console.error('Playback error:', err));
        setIsPlaying(true);

        audioRef.current.onended = () => setIsPlaying(false);
      }
    } catch (error) {
      console.error('Emotional voice synthesis error:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setIsPlaying(false);
    }
  }, []);

  return {
    speakWithEmotion,
    isPlaying,
    isLoading,
    stop,
    audioRef,
  };
}