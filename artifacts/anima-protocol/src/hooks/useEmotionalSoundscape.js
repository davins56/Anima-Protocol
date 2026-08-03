import { useState, useEffect, useRef } from "react";

const SOUNDSCAPE_MAP = {
  // Emotion + Location combinations
  "peaceful-default": "https://cdn.pixabay.com/download/audio/2022/03/15/audio_1664cdc5d3.mp3",
  "peaceful-forest": "https://cdn.pixabay.com/download/audio/2021/08/16/audio_487db01b52.mp3",
  "peaceful-temple": "https://cdn.pixabay.com/download/audio/2022/01/17/audio_00043eb4cd.mp3",
  
  "tense-dungeon": "https://cdn.pixabay.com/download/audio/2021/10/02/audio_e42cc0ac61.mp3",
  "tense-combat": "https://cdn.pixabay.com/download/audio/2021/08/03/audio_8468d87e85.mp3",
  "tense-default": "https://cdn.pixabay.com/download/audio/2021/09/14/audio_eb38a1e77e.mp3",
  
  "joyful-celebration": "https://cdn.pixabay.com/download/audio/2022/02/15/audio_5180b39305.mp3",
  "joyful-tavern": "https://cdn.pixabay.com/download/audio/2021/07/19/audio_e7aef32159.mp3",
  "joyful-default": "https://cdn.pixabay.com/download/audio/2021/08/02/audio_e5b4f4629a.mp3",
  
  "anxious-forest": "https://cdn.pixabay.com/download/audio/2021/08/16/audio_487db01b52.mp3",
  "anxious-default": "https://cdn.pixabay.com/download/audio/2021/09/21/audio_5f9f8e8e76.mp3",
  
  "angry-combat": "https://cdn.pixabay.com/download/audio/2021/08/03/audio_8468d87e85.mp3",
  "angry-default": "https://cdn.pixabay.com/download/audio/2021/09/14/audio_eb38a1e77e.mp3",
  
  "melancholic-default": "https://cdn.pixabay.com/download/audio/2022/01/26/audio_88f47e0e38.mp3",
  "melancholic-rain": "https://cdn.pixabay.com/download/audio/2021/12/06/audio_d3ac8c5e64.mp3",
};

const EMOTION_INTENSITY = {
  joyful: 3,
  calm: 1,
  peaceful: 1,
  hopeful: 2,
  conflicted: 2,
  anxious: 3,
  afraid: 4,
  angry: 4,
  sad: 2,
  neutral: 1,
};

const LOCATION_KEYWORDS = {
  forest: ["forest", "woods", "tree", "wild"],
  dungeon: ["dungeon", "cave", "underground", "dark"],
  combat: ["fight", "battle", "combat", "attack"],
  temple: ["temple", "shrine", "sacred", "holy"],
  tavern: ["tavern", "inn", "bar", "ale"],
  celebration: ["party", "feast", "celebration", "cheer"],
  rain: ["rain", "storm", "wet", "water"],
};

export function useEmotionalSoundscape(characterEmotions, recentMessages) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentSoundscape, setCurrentSoundscape] = useState(null);
  const [intensity, setIntensity] = useState(0);
  const audioRef = useRef(null);
  const [volume, setVolume] = useState(0.3);

  // Detect location from recent messages
  const detectLocation = () => {
    if (!recentMessages || recentMessages.length === 0) return "default";

    const recentText = recentMessages
      .slice(-5)
      .map(m => m.content.toLowerCase())
      .join(" ");

    for (const [location, keywords] of Object.entries(LOCATION_KEYWORDS)) {
      if (keywords.some(kw => recentText.includes(kw))) {
        return location;
      }
    }
    return "default";
  };

  // Get primary character emotion
  const getPrimaryEmotion = () => {
    if (!characterEmotions || Object.keys(characterEmotions).length === 0) {
      return "calm";
    }

    // Get emotion with highest intensity
    let dominantEmotion = "calm";
    let maxIntensity = 0;

    for (const [charId, emotionData] of Object.entries(characterEmotions)) {
      const emotion = emotionData.emotion || "neutral";
      const emotionIntensity = EMOTION_INTENSITY[emotion] || 1;

      if (emotionIntensity > maxIntensity) {
        maxIntensity = emotionIntensity;
        dominantEmotion = emotion;
      }
    }

    return dominantEmotion;
  };

  // Select soundscape based on emotion + location
  useEffect(() => {
    const emotion = getPrimaryEmotion();
    const location = detectLocation();
    const key = `${emotion}-${location}`;

    // Try emotion+location combo, fall back to emotion+default
    let selectedUrl = SOUNDSCAPE_MAP[key] || SOUNDSCAPE_MAP[`${emotion}-default`] || SOUNDSCAPE_MAP["peaceful-default"];

    setCurrentSoundscape(selectedUrl);
    setIntensity(EMOTION_INTENSITY[emotion] || 1);

    // Auto-play if intensity is high (anxious, afraid, angry, combat)
    if (["anxious", "afraid", "angry"].includes(emotion)) {
      setIsPlaying(true);
    }
  }, [characterEmotions, recentMessages]);

  // Handle audio playback
  useEffect(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.loop = true;
    }

    if (isPlaying && currentSoundscape) {
      audioRef.current.src = currentSoundscape;
      audioRef.current.volume = volume;
      audioRef.current.play().catch(() => {
        // Browser autoplay restrictions, silently fail
      });
    } else {
      audioRef.current.pause();
    }
  }, [isPlaying, currentSoundscape, volume]);

  return {
    isPlaying,
    setIsPlaying,
    volume,
    setVolume,
    intensity,
    currentSoundscape,
  };
}