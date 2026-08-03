import { useEffect, useRef } from 'react';

interface VoiceModeProps {
  isActive: boolean;
  onTranscript: (text: string) => void;
  onSpeak: (text: string) => void;
  isMax: boolean;
}

export default function VoiceMode({ isActive, onTranscript, onSpeak, isMax }: VoiceModeProps) {
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    if (!isActive) {
      if (recognitionRef.current) recognitionRef.current.stop();
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Voice input not supported in this browser");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onresult = (event: any) => {
      const transcript = event.results[event.results.length - 1][0].transcript;
      onTranscript(transcript);
    };

    recognition.onerror = (event: any) => console.error('Speech recognition error', event);
    recognition.start();

    recognitionRef.current = recognition;

    return () => recognition.stop();
  }, [isActive, onTranscript]);

  // Example speak function (upgrade to ElevenLabs later)
  const speak = (text: string) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = isMax ? 0.95 : 1.0;
    utterance.pitch = 1.05;
    speechSynthesis.speak(utterance);
    onSpeak(text);
  };

  return null; // Toggle UI handled in Protocol page
}