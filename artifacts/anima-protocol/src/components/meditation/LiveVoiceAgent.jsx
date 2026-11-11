import { useCallback, useRef, useState } from "react";
import {
  ConversationProvider,
  useConversationControls,
  useConversationMode,
  useConversationStatus,
} from "@elevenlabs/react";
import { Mic, MicOff, Loader2 } from "lucide-react";
import { track } from "@/lib/analytics";
import { buildVoiceAgentVariables, fetchVoiceAgentSignedUrl } from "@/lib/voiceAgentSession";

/**
 * Live, two-way voice conversation with the companion in Sacred Space,
 * powered by the private ElevenLabs agent. Transcripts are handed back
 * through `onTranscript` so they join the written session.
 */
function LiveVoiceButton({ character, ritualFocus, accentColor, onStart, onError }) {
  const { startSession, endSession } = useConversationControls();
  const { status } = useConversationStatus();
  const { isSpeaking } = useConversationMode();
  const [starting, setStarting] = useState(false);

  const live = status === "connected";
  const busy = starting || status === "connecting";

  const toggle = useCallback(async () => {
    if (live || status === "connecting") {
      endSession();
      return;
    }
    setStarting(true);
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      const signedUrl = await fetchVoiceAgentSignedUrl();
      onStart?.();
      startSession({
        signedUrl,
        connectionType: "websocket",
        dynamicVariables: buildVoiceAgentVariables(character, ritualFocus),
      });
    } catch (err) {
      const denied = err?.name === "NotAllowedError" || err?.name === "SecurityError";
      onError?.(denied
        ? "Microphone access is needed to talk out loud."
        : "The live voice could not start. Please try again.");
    } finally {
      setStarting(false);
    }
  }, [live, status, endSession, startSession, character, ritualFocus, onStart, onError]);

  const label = live ? "End live voice" : "Talk out loud";
  return (
    <button
      type="button"
      onClick={toggle}
      disabled={starting}
      aria-label={label}
      aria-pressed={live}
      title={live ? (isSpeaking ? `${character?.name || "Companion"} is speaking` : "Listening…") : label}
      className="px-3 py-2 border transition-all disabled:opacity-50 flex items-center gap-1.5"
      style={{
        borderColor: live ? accentColor : `${accentColor}40`,
        color: accentColor,
        background: live ? `${accentColor}30` : `${accentColor}10`,
      }}
    >
      {busy ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
      ) : live ? (
        <MicOff className="w-3.5 h-3.5" />
      ) : (
        <Mic className="w-3.5 h-3.5" />
      )}
      {live && (
        <span className="font-mono text-[9px] tracking-widest uppercase">
          {isSpeaking ? "Speaking" : "Listening"}
        </span>
      )}
    </button>
  );
}

export default function LiveVoiceAgent({ character, ritualFocus, accentColor, onTranscript, onLiveChange, onError }) {
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  return (
    <ConversationProvider
      onConnect={() => {
        onLiveChange?.(true);
        track("voice_agent_session_started", { ritual_focus: ritualFocus || null });
      }}
      onDisconnect={() => onLiveChange?.(false)}
      onError={() => onError?.("The live voice was interrupted.")}
      onMessage={({ message, source }) => {
        const text = String(message || "").trim();
        if (text) onTranscriptRef.current?.({ role: source === "user" ? "user" : "assistant", content: text });
      }}
    >
      <LiveVoiceButton
        character={character}
        ritualFocus={ritualFocus}
        accentColor={accentColor}
        onStart={() => onError?.("")}
        onError={onError}
      />
    </ConversationProvider>
  );
}
