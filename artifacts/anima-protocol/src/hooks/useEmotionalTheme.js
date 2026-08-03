import { useEffect, useState } from "react";

const EMOTION_THEMES = {
  joyful: {
    primary: "185 100% 60%",
    secondary: "185 100% 45%",
    accent: "60 100% 50%",
    background: "220 20% 8%",
    foreground: "60 100% 90%",
    animationSpeed: "2s",
    animationIntensity: "high",
    bgPattern: "radial",
  },
  calm: {
    primary: "200 100% 50%",
    secondary: "200 100% 35%",
    accent: "150 60% 40%",
    background: "220 20% 6%",
    foreground: "200 30% 85%",
    animationSpeed: "4s",
    animationIntensity: "low",
    bgPattern: "grid",
  },
  sad: {
    primary: "240 60% 45%",
    secondary: "240 60% 35%",
    accent: "250 40% 50%",
    background: "240 20% 5%",
    foreground: "240 30% 75%",
    animationSpeed: "3s",
    animationIntensity: "minimal",
    bgPattern: "fade",
  },
  angry: {
    primary: "0 100% 55%",
    secondary: "0 100% 40%",
    accent: "30 100% 50%",
    background: "0 20% 8%",
    foreground: "0 100% 90%",
    animationSpeed: "1.5s",
    animationIntensity: "very-high",
    bgPattern: "pulse",
  },
  anxious: {
    primary: "280 80% 50%",
    secondary: "280 80% 35%",
    accent: "0 80% 50%",
    background: "280 20% 6%",
    foreground: "280 50% 85%",
    animationSpeed: "1s",
    animationIntensity: "very-high",
    bgPattern: "strobe",
  },
  peaceful: {
    primary: "150 70% 50%",
    secondary: "150 70% 35%",
    accent: "180 60% 45%",
    background: "150 20% 7%",
    foreground: "150 40% 88%",
    animationSpeed: "5s",
    animationIntensity: "very-low",
    bgPattern: "drift",
  },
  hopeful: {
    primary: "60 100% 50%",
    secondary: "60 100% 35%",
    accent: "45 100% 50%",
    background: "60 30% 8%",
    foreground: "60 100% 90%",
    animationSpeed: "2.5s",
    animationIntensity: "medium",
    bgPattern: "glow",
  },
  conflicted: {
    primary: "270 80% 50%",
    secondary: "30 100% 50%",
    accent: "0 80% 50%",
    background: "270 20% 6%",
    foreground: "270 50% 85%",
    animationSpeed: "2s",
    animationIntensity: "high",
    bgPattern: "flicker",
  },
  neutral: {
    primary: "185 100% 50%",
    secondary: "220 20% 10%",
    accent: "185 80% 15%",
    background: "220 20% 4%",
    foreground: "185 100% 80%",
    animationSpeed: "3s",
    animationIntensity: "medium",
    bgPattern: "default",
  },
};

export default function useEmotionalTheme(emotion, intensity = 50) {
  const [theme, setTheme] = useState(null);

  useEffect(() => {
    const selectedTheme = EMOTION_THEMES[emotion] || EMOTION_THEMES.neutral;
    const intensityFactor = Math.max(0.3, Math.min(1, intensity / 100));
    
    // Apply CSS variables to root element
    const root = document.documentElement;
    
    root.style.setProperty("--primary", selectedTheme.primary);
    root.style.setProperty("--secondary", selectedTheme.secondary);
    root.style.setProperty("--accent", selectedTheme.accent);
    root.style.setProperty("--background", selectedTheme.background);
    root.style.setProperty("--foreground", selectedTheme.foreground);
    root.style.setProperty("--emotion-animation-speed", selectedTheme.animationSpeed);
    root.style.setProperty("--emotion-animation-intensity", intensityFactor);
    root.style.setProperty("--emotion-pattern", selectedTheme.bgPattern);

    // Apply animation class to body
    document.body.classList.remove(
      "emotion-joyful",
      "emotion-calm",
      "emotion-sad",
      "emotion-angry",
      "emotion-anxious",
      "emotion-peaceful",
      "emotion-hopeful",
      "emotion-conflicted"
    );
    if (emotion && emotion !== "neutral") {
      document.body.classList.add(`emotion-${emotion}`);
    }

    setTheme(selectedTheme);
  }, [emotion, intensity]);

  return theme;
}