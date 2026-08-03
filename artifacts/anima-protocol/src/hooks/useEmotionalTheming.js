// @ts-check
import { useEffect } from "react";

const EMOTION_THEMES = {
  joyful: {
    primary: "185 100% 50%",
    secondary: "60 100% 55%",
    accent: "60 100% 40%",
    background: "220 20% 8%",
    typography: "font-sans tracking-wider",
    animation: "pulse-glow 3s ease-in-out infinite",
  },
  calm: {
    primary: "185 100% 50%",
    secondary: "220 20% 15%",
    accent: "185 80% 35%",
    background: "220 20% 4%",
    typography: "font-sans tracking-normal",
    animation: "none",
  },
  sad: {
    primary: "220 60% 45%",
    secondary: "220 40% 20%",
    accent: "240 50% 35%",
    background: "220 20% 2%",
    typography: "font-sans tracking-tight",
    animation: "flicker 8s infinite opacity-75",
  },
  anxious: {
    primary: "45 100% 50%",
    secondary: "220 20% 10%",
    accent: "45 100% 35%",
    background: "220 20% 3%",
    typography: "font-mono tracking-widest",
    animation: "pulse 2s ease-in-out infinite",
  },
  angry: {
    primary: "0 84% 60%",
    secondary: "220 20% 12%",
    accent: "0 70% 50%",
    background: "220 20% 3%",
    typography: "font-mono tracking-widest font-bold",
    animation: "flicker 4s infinite",
  },
  peaceful: {
    primary: "160 100% 50%",
    secondary: "220 20% 10%",
    accent: "160 80% 40%",
    background: "220 20% 5%",
    typography: "font-sans tracking-normal",
    animation: "none",
  },
  hopeful: {
    primary: "120 100% 50%",
    secondary: "220 20% 12%",
    accent: "120 80% 40%",
    background: "220 20% 6%",
    typography: "font-sans tracking-wider",
    animation: "pulse-glow 4s ease-in-out infinite opacity-80",
  },
  conflicted: {
    primary: "270 100% 50%",
    secondary: "220 20% 10%",
    accent: "270 70% 40%",
    background: "220 20% 3%",
    typography: "font-mono tracking-normal",
    animation: "flicker 6s infinite opacity-60",
  },
  neutral: {
    primary: "185 100% 50%",
    secondary: "220 20% 10%",
    accent: "185 50% 35%",
    background: "220 20% 4%",
    typography: "font-sans tracking-normal",
    animation: "none",
  },
};

export function useEmotionalTheming(emotion = "neutral") {
  useEffect(() => {
    const theme =
      EMOTION_THEMES[/** @type {keyof typeof EMOTION_THEMES} */ (emotion)] ||
      EMOTION_THEMES.neutral;
    const root = document.documentElement;

    // Apply color variables
    root.style.setProperty("--primary", theme.primary);
    root.style.setProperty("--secondary", theme.secondary);
    root.style.setProperty("--accent", theme.accent);
    root.style.setProperty("--background", theme.background);

    // Apply animation to body
    if (theme.animation && theme.animation !== "none") {
      document.body.style.animation = theme.animation;
    } else {
      document.body.style.animation = "none";
    }

    return () => {
      // Reset to default on unmount
      root.style.setProperty("--primary", "185 100% 50%");
      root.style.setProperty("--secondary", "220 20% 10%");
      root.style.setProperty("--accent", "185 80% 15%");
      root.style.setProperty("--background", "220 20% 4%");
      document.body.style.animation = "none";
    };
  }, [emotion]);
}