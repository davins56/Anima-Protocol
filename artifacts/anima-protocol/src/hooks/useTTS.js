import { useState, useEffect, useRef, useCallback } from "react";

export function useTTS() {
  const [isEnabled, setIsEnabled] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const [selectedVoice, setSelectedVoice] = useState(null);
  const [voices, setVoices] = useState([]);
  const utteranceRef = useRef(null);

  useEffect(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      setIsSupported(true);

      const loadVoices = () => {
        const available = window.speechSynthesis.getVoices();
        if (available.length > 0) {
          setVoices(available);
          // Prefer a female English voice for narrator feel
          const preferred =
            available.find((v) => v.name.toLowerCase().includes("samantha")) ||
            available.find((v) => v.lang.startsWith("en") && v.name.toLowerCase().includes("female")) ||
            available.find((v) => v.lang.startsWith("en") && v.default) ||
            available.find((v) => v.lang.startsWith("en")) ||
            available[0];
          setSelectedVoice(preferred || null);
        }
      };

      loadVoices();
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }
  }, []);

  const speak = useCallback(
    (text) => {
      if (!isEnabled || !isSupported || !text) return;

      // Cancel any ongoing speech
      window.speechSynthesis.cancel();

      // Strip markdown-style formatting
      const clean = text
        .replace(/\*\*(.*?)\*\*/g, "$1")
        .replace(/\*(.*?)\*/g, "$1")
        .replace(/\[(.*?)\]\(.*?\)/g, "$1")
        .replace(/#+\s/g, "")
        .replace(/`(.*?)`/g, "$1")
        .trim();

      const utterance = new SpeechSynthesisUtterance(clean);
      utterance.voice = selectedVoice;
      utterance.rate = 0.92;
      utterance.pitch = 1.0;
      utterance.volume = 1.0;

      utterance.onstart = () => setIsSpeaking(true);
      utterance.onend = () => setIsSpeaking(false);
      utterance.onerror = () => setIsSpeaking(false);

      utteranceRef.current = utterance;
      window.speechSynthesis.speak(utterance);
    },
    [isEnabled, isSupported, selectedVoice]
  );

  const stop = useCallback(() => {
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
  }, []);

  const toggle = useCallback(() => {
    setIsEnabled((prev) => {
      if (prev) window.speechSynthesis.cancel();
      return !prev;
    });
  }, []);

  return { isEnabled, isSpeaking, isSupported, voices, selectedVoice, setSelectedVoice, speak, stop, toggle };
}