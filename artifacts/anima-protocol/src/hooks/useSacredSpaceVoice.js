import { useCallback, useEffect, useRef, useState } from "react";
import { speakToAnima } from "@/components/voice/speakToAnima";
import { apiUrl } from "@/lib/apiOrigin";
import { authHeaders } from "@/api/authBridge";
import { speakNaturally } from "@/lib/naturalSpeech";

let cachedCloudTts = null;
let cloudTtsInflight = null;

/**
 * Probe the existing /api/tts status endpoint once. ElevenLabs stays optional
 * and is only used when the server already has a key configured.
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<boolean>}
 */
export async function isCloudTtsConfigured(fetchImpl = fetch) {
  if (cachedCloudTts !== null) return cachedCloudTts;
  if (cloudTtsInflight) return cloudTtsInflight;
  cloudTtsInflight = (async () => {
    try {
      const res = await fetchImpl(apiUrl("/tts/status"), {
        headers: await authHeaders(),
      });
      if (!res.ok) {
        cachedCloudTts = false;
        return false;
      }
      const data = await res.json();
      cachedCloudTts = Boolean(data?.configured);
      return cachedCloudTts;
    } catch {
      cachedCloudTts = false;
      return false;
    } finally {
      cloudTtsInflight = null;
    }
  })();
  return cloudTtsInflight;
}

/** @internal test helper */
export function resetCloudTtsProbe() {
  cachedCloudTts = null;
  cloudTtsInflight = null;
}

/**
 * Sacred Space voice: try optional ElevenLabs (tender / calm) when the
 * existing TTS secret is configured, otherwise speak with natural Web Speech.
 */
export function useSacredSpaceVoice({ companion = null, enabledByDefault = true } = {}) {
  const [isEnabled, setIsEnabled] = useState(enabledByDefault);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const [voices, setVoices] = useState([]);
  const controllerRef = useRef(null);
  const audioRef = useRef(null);
  const companionRef = useRef(companion);
  companionRef.current = companion;

  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      setIsSupported(false);
      return undefined;
    }
    setIsSupported(true);
    const loadVoices = () => {
      const available = window.speechSynthesis.getVoices() || [];
      if (available.length) setVoices(available);
    };
    loadVoices();
    window.speechSynthesis.addEventListener?.("voiceschanged", loadVoices);
    window.speechSynthesis.onvoiceschanged = loadVoices;
    return () => {
      window.speechSynthesis.removeEventListener?.("voiceschanged", loadVoices);
    };
  }, []);

  const stop = useCallback(() => {
    controllerRef.current?.cancel();
    controllerRef.current = null;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }
    try {
      window.speechSynthesis?.cancel();
    } catch {
      /* ignore */
    }
    setIsSpeaking(false);
  }, []);

  const speakWeb = useCallback((text) => {
    controllerRef.current = speakNaturally(text, {
      voices: voices.length ? voices : undefined,
      companion: companionRef.current,
      onStart: () => setIsSpeaking(true),
      onEnd: () => {
        controllerRef.current = null;
        setIsSpeaking(false);
      },
    });
  }, [voices]);

  const speak = useCallback(async (text) => {
    if (!isEnabled || !text) return;
    stop();

    const character = companionRef.current;
    const canTryCloud = await isCloudTtsConfigured();
    if (canTryCloud) {
      try {
        const { audioUrl } = await speakToAnima({
          text,
          characterId: character?.id || null,
          voiceId: character?.elevenlabs_voice_id || null,
          emotion: "tender",
          intensity: 3,
        });
        if (audioUrl) {
          const audio = new Audio(audioUrl);
          audioRef.current = audio;
          setIsSpeaking(true);
          audio.onended = () => {
            URL.revokeObjectURL(audioUrl);
            audioRef.current = null;
            setIsSpeaking(false);
          };
          audio.onerror = () => {
            URL.revokeObjectURL(audioUrl);
            audioRef.current = null;
            speakWeb(text);
          };
          await audio.play();
          return;
        }
      } catch {
        // Fall through to Web Speech — cloud TTS is optional.
      }
    }

    speakWeb(text);
  }, [isEnabled, speakWeb, stop]);

  const toggle = useCallback(() => {
    setIsEnabled((prev) => {
      if (prev) stop();
      return !prev;
    });
  }, [stop]);

  useEffect(() => () => stop(), [stop]);

  return {
    isEnabled,
    isSpeaking,
    isSupported,
    voices,
    speak,
    stop,
    toggle,
  };
}
