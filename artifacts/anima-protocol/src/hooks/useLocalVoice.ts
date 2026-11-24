/**
 * V6: home-box voice in chat. Status (online / offline / disabled / busy),
 * speak a reply, stop it, and push-to-talk. Fail closed everywhere: when the
 * box can't be used, the state says so and the chat stays text only.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchLocalVoiceStatus, isUnavailable, offlineMessage, transcribe, type LocalVoiceStatus } from "@/lib/voice/localVoiceApi";
import { LocalSpeaker } from "@/lib/voice/localSpeaker";
import { PushToTalk } from "@/lib/voice/pushToTalk";

const OFFLINE_RECHECK_MS = 30_000;

export type LocalVoiceUiState = "checking" | "online" | "offline" | "disabled" | "busy";

export function useLocalVoice(enabled: boolean) {
  const [status, setStatus] = useState<LocalVoiceStatus | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const speakerRef = useRef<LocalSpeaker | null>(null);
  const pttRef = useRef<PushToTalk | null>(null);

  const refresh = useCallback(
    async (fresh = false) => {
      if (!enabled) return null;
      const s = await fetchLocalVoiceStatus({}, fresh);
      setStatus(s);
      return s;
    },
    [enabled],
  );

  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const t = setInterval(() => {
      void refresh();
    }, OFFLINE_RECHECK_MS);
    return () => clearInterval(t);
  }, [enabled, refresh]);

  useEffect(
    () => () => {
      void speakerRef.current?.dispose();
      speakerRef.current = null;
      void pttRef.current?.cancel();
      pttRef.current = null;
    },
    [],
  );

  const markOffline = useCallback((reason: string | null, message: string) => {
    setStatus({ state: reason === "disabled_by_user" ? "disabled" : reason === "busy" ? "busy" : "offline", reason: reason ?? "box_unreachable" });
    setNotice(message);
  }, []);

  const speak = useCallback(
    async (characterId: string | null | undefined, text: string) => {
      if (!enabled || !characterId) return false;
      if (!speakerRef.current) speakerRef.current = new LocalSpeaker();
      setNotice(null);
      setSpeaking(true);
      try {
        const out = await speakerRef.current.speak(characterId, text);
        if (out.kind === "offline") markOffline(out.unavailable.reason, out.unavailable.message);
        else if (out.kind === "error") setNotice("Her voice stumbled. The reply is still here as text.");
        return out.kind === "completed";
      } finally {
        setSpeaking(Boolean(speakerRef.current?.speaking));
      }
    },
    [enabled, markOffline],
  );

  const stop = useCallback((reason: "barge_in" | "user_stop" | "navigation" = "user_stop") => {
    speakerRef.current?.stop(reason);
    setSpeaking(false);
  }, []);

  const startTalking = useCallback(async () => {
    if (!enabled || recording) return;
    // Talking over her is a barge-in.
    if (speakerRef.current?.speaking) stop("barge_in");
    setNotice(null);
    const ptt = new PushToTalk();
    pttRef.current = ptt;
    try {
      await ptt.start();
      setRecording(true);
    } catch {
      pttRef.current = null;
      setNotice("The microphone isn't available. Check the browser's permission.");
    }
  }, [enabled, recording, stop]);

  /** Stop recording and transcribe on the home box. Returns the text or null. */
  const finishTalking = useCallback(
    async (characterId: string | null | undefined): Promise<string | null> => {
      const ptt = pttRef.current;
      pttRef.current = null;
      setRecording(false);
      if (!ptt) return null;
      const pcm = await ptt.stop();
      if (!characterId || pcm.length < 1600) return null; // under 0.1 s: a tap, not speech
      setTranscribing(true);
      try {
        const res = await transcribe(characterId, pcm);
        if (isUnavailable(res)) {
          if (res.status === 503) markOffline(res.reason, res.message);
          else setNotice(res.message);
          return null;
        }
        return (res as { text: string }).text || null;
      } finally {
        setTranscribing(false);
      }
    },
    [markOffline],
  );

  const cancelTalking = useCallback(async () => {
    const ptt = pttRef.current;
    pttRef.current = null;
    setRecording(false);
    await ptt?.cancel();
  }, []);

  const uiState: LocalVoiceUiState = !status ? "checking" : (status.state as LocalVoiceUiState);
  const offlineText = status && status.state !== "online" ? offlineMessage(String(status.reason || "")) : null;

  return {
    uiState,
    status,
    offlineText,
    notice,
    speaking,
    recording,
    transcribing,
    refresh,
    speak,
    stop,
    startTalking,
    finishTalking,
    cancelTalking,
  };
}
