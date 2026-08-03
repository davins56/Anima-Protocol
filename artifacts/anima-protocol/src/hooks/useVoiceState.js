import { useState, useCallback, useEffect } from 'react';
import { useElevenLabsTTS } from './useElevenLabsTTS';

export function useVoiceState(characterId, characterName) {
  const [emotion, setEmotion] = useState('neutral');
  const [intensity, setIntensity] = useState(5);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const elTTS = useElevenLabsTTS();

  // Detect emotion from message content
  const detectEmotionFromContent = useCallback((content) => {
    if (!content) return 'neutral';

    content = content.toLowerCase();
    
    if (/!\s*$|excited|amazing|wonderful|fantastic|great|love|yes yes|absolutely/.test(content)) {
      return 'joyful';
    } else if (/\?/.test(content) && /think|wonder|curious|what|why|how/.test(content)) {
      return 'surprised';
    } else if (/sad|hurt|pain|sorry|regret|lose|lost|tears|cry|grief/.test(content)) {
      return 'sad';
    } else if (/angry|furious|hate|never|absolutely not|rage/.test(content)) {
      return 'angry';
    } else if (/afraid|scared|fear|horror|terror|danger|help/.test(content)) {
      return 'afraid';
    } else if (/hope|believe|trust|will try|can do|possible|together/.test(content)) {
      return 'hopeful';
    } else if (/\.\.\.|hesitate|unsure|maybe|perhaps|unclear|confused/.test(content)) {
      return 'conflicted';
    } else if (/calm|peace|understand|breathe|relax|gentle|kind/.test(content)) {
      return 'calm';
    }
    
    return 'neutral';
  }, []);

  // Calculate intensity from punctuation/urgency
  const calculateIntensity = useCallback((content) => {
    if (!content) return 5;

    const exclamations = (content.match(/!/g) || []).length;
    const questions = (content.match(/\?/g) || []).length;
    const ellipsis = (content.match(/\.\.\./g) || []).length;
    const caps = (content.match(/[A-Z]/g) || []).length;

    let baseIntensity = 5;
    baseIntensity += exclamations * 2;
    baseIntensity += questions * 0.5;
    baseIntensity += ellipsis * 0.5;
    baseIntensity += (caps / content.length) * 5;

    return Math.min(Math.round(baseIntensity), 10);
  }, []);

  // Handle voice playback with emotion
  const speakWithEmotion = useCallback((content, voiceId) => {
    if (!elTTS.isEnabled || !voiceId) return;

    const detectedEmotion = detectEmotionFromContent(content);
    const detectedIntensity = calculateIntensity(content);

    setEmotion(detectedEmotion);
    setIntensity(detectedIntensity);
    setIsSpeaking(true);
    setIsPaused(false);

    // Speak the content
    elTTS.speak(content, voiceId);

    // Stop speaking indicator after speech completes (estimate based on content length)
    const estimatedDuration = (content.length / 50) * 1000; // ~50 chars per second
    setTimeout(() => {
      setIsSpeaking(false);
    }, estimatedDuration);
  }, [elTTS, detectEmotionFromContent, calculateIntensity]);

  return {
    emotion,
    intensity,
    isSpeaking,
    isPaused,
    setIsSpeaking,
    setIsPaused,
    speakWithEmotion,
    detectEmotionFromContent,
  };
}