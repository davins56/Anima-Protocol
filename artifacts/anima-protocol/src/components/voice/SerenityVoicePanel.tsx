/** Docked full-duplex voice panel for solo chats (lazy-loaded). */
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Mic, MicOff, PhoneOff, Hand, Loader, X } from "lucide-react";
import { useSerenityVoice } from "@/hooks/useSerenityVoice";
import { VOICE_PHOTO_EVENT } from "@/lib/voice/tools";
import VoiceLatencyHud, { VOICE_HUD_ENABLED } from "./VoiceLatencyHud";

type Props = {
  character: { id: string; name?: string };
  sessionId?: string | null;
  onClose: () => void;
  onPhoto?: (p: { url: string; imageId: string; prompt: string; characterId: string }) => void;
};

const LABEL: Record<string, string> = {
  idle: "Tap to talk",
  connecting: "Connecting…",
  listening: "Listening",
  "user-speaking": "Hearing you",
  thinking: "Thinking…",
  speaking: "Speaking",
  reconnecting: "Reconnecting…",
  error: "Voice unavailable",
};

export default function SerenityVoicePanel({ character, sessionId, onClose, onPhoto }: Props) {
  const navigate = useNavigate();
  const v = useSerenityVoice({ characterId: character.id, characterName: character.name, sessionId, navigate });

  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d?.characterId === character.id) onPhoto?.({ url: d.url, imageId: d.imageId, prompt: d.prompt || "", characterId: d.characterId });
    };
    window.addEventListener(VOICE_PHOTO_EVENT, h);
    return () => window.removeEventListener(VOICE_PHOTO_EVENT, h);
  }, [character.id, onPhoto]);

  const live = v.status !== "idle" && v.status !== "error";
  return (
    <div className="mx-2 mb-2 border border-primary/30 bg-black/80 backdrop-blur-sm p-3 space-y-2" role="region" aria-label="Voice call">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[10px] tracking-[0.2em] uppercase text-primary truncate">
          Voice · {character.name || "Companion"} · {LABEL[v.status]}
          {v.toolActivity ? ` · ${v.toolActivity}` : ""}
        </span>
        <button type="button" onClick={() => { v.stop(); onClose(); }} className="ml-auto text-primary/40 hover:text-primary p-1" aria-label="Close voice">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="flex items-center gap-2">
        {!live ? (
          <button type="button" onClick={() => void v.start()} className="min-h-[48px] px-4 border border-primary bg-primary/15 text-primary font-mono text-xs uppercase tracking-widest flex items-center gap-2">
            {v.status === "connecting" ? <Loader className="w-4 h-4 animate-spin" /> : <Mic className="w-4 h-4" />} Start
          </button>
        ) : (
          <>
            <button type="button" onClick={() => v.setMuted(!v.muted)} className="min-h-[48px] min-w-[48px] border border-border flex items-center justify-center" aria-pressed={v.muted} aria-label={v.muted ? "Unmute" : "Mute"}>
              {v.muted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4 text-primary" />}
            </button>
            <button type="button" onClick={v.interrupt} disabled={v.status !== "speaking"} className="min-h-[48px] min-w-[48px] border border-border flex items-center justify-center disabled:opacity-40" aria-label="Interrupt">
              <Hand className="w-4 h-4" />
            </button>
            <button type="button" onClick={v.stop} className="min-h-[48px] px-4 border border-red-400/60 text-red-300 font-mono text-xs uppercase tracking-widest flex items-center gap-2">
              <PhoneOff className="w-4 h-4" /> End
            </button>
          </>
        )}
        {VOICE_HUD_ENABLED && <VoiceLatencyHud stats={v.latency} status={v.status} />}
      </div>
      {(v.captions.user || v.captions.assistant) && (
        <div className="font-mono text-[11px] space-y-1 max-h-24 overflow-y-auto">
          {v.captions.user && <p className="text-muted-foreground">you: {v.captions.user}</p>}
          {v.captions.assistant && <p className="text-foreground">{character.name || "them"}: {v.captions.assistant}</p>}
        </div>
      )}
      {v.error && <p className="font-mono text-[11px] text-red-300">{v.error}</p>}
    </div>
  );
}
