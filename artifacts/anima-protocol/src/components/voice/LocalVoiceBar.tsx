/**
 * V6 (VITE_ANIMA_LOCAL_VOICE): the home-box voice strip above the composer.
 * - Status: her voice is home / offline / waking / switched off / busy. Offline
 *   is a clear text-only state with a "Check again"; nothing switches to a
 *   cloud voice.
 * - Hold to talk (push-to-talk v1): pointer down records, release sends.
 *   Keyboard: Space/Enter toggles. Esc cancels.
 * - Stop while she is speaking.
 */
import { Mic, Square, RefreshCw, VolumeX, Volume2 } from "lucide-react";
import type { useLocalVoice } from "@/hooks/useLocalVoice";

type Voice = ReturnType<typeof useLocalVoice>;

export default function LocalVoiceBar({
  voice,
  characterId,
  companionName,
  onTranscript,
  disabled = false,
}: {
  voice: Voice;
  characterId: string | null | undefined;
  companionName?: string;
  onTranscript: (text: string) => void;
  disabled?: boolean;
}) {
  const online = voice.uiState === "online";
  const who = companionName || "her";

  const release = async () => {
    const text = await voice.finishTalking(characterId);
    if (text) onTranscript(text);
  };

  return (
    <div
      className="flex flex-wrap items-center gap-2 px-3 py-1.5 border-t border-primary/10 text-[11px]"
      data-testid="local-voice-bar"
      data-state={voice.uiState}
    >
      {online ? (
        <span className="inline-flex items-center gap-1 text-emerald-200/80" data-testid="local-voice-online">
          <Volume2 className="w-3.5 h-3.5" aria-hidden="true" /> {who}&apos;s voice is home
        </span>
      ) : voice.uiState === "checking" ? (
        <span className="text-primary/40">Checking voice…</span>
      ) : (
        <span className="inline-flex items-center gap-1 text-amber-200/90" role="status" data-testid="local-voice-offline">
          <VolumeX className="w-3.5 h-3.5" aria-hidden="true" /> {voice.offlineText} Text only. No cloud voice is used.
          <button
            type="button"
            onClick={() => void voice.refresh(true)}
            className="ml-1 inline-flex items-center gap-1 underline"
            aria-label="Check the voice server again"
          >
            <RefreshCw className="w-3 h-3" /> Check again
          </button>
        </span>
      )}

      <span className="ml-auto flex items-center gap-2">
        {voice.speaking && (
          <button
            type="button"
            onClick={() => voice.stop("user_stop")}
            className="inline-flex items-center gap-1 min-h-[40px] px-3 border border-red-400/40 text-red-200/90 font-mono text-[10px] tracking-widest uppercase"
            data-testid="local-voice-stop"
          >
            <Square className="w-3 h-3" /> Stop
          </button>
        )}
        <button
          type="button"
          disabled={disabled || !online || !characterId || voice.transcribing}
          onPointerDown={(e) => {
            e.preventDefault();
            void voice.startTalking();
          }}
          onPointerUp={() => void release()}
          onPointerLeave={() => {
            if (voice.recording) void release();
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") void voice.cancelTalking();
            if (e.key !== " " && e.key !== "Enter") return;
            e.preventDefault();
            if (voice.recording) void release();
            else void voice.startTalking();
          }}
          aria-pressed={voice.recording}
          aria-label={voice.recording ? "Release to send" : `Hold to talk to ${who}`}
          className={`inline-flex items-center gap-1 min-h-[40px] px-3 border font-mono text-[10px] tracking-widest uppercase select-none touch-none disabled:opacity-40 ${
            voice.recording ? "border-rose-400/70 text-rose-200 bg-rose-500/10" : "border-cyan-400/40 text-cyan-200/90"
          }`}
          data-testid="local-voice-ptt"
        >
          <Mic className="w-3.5 h-3.5" />
          {voice.transcribing ? "Listening…" : voice.recording ? "Release to send" : "Hold to talk"}
        </button>
      </span>
      {voice.notice && (
        <p className="basis-full text-amber-200/80" data-testid="local-voice-notice">
          {voice.notice}
        </p>
      )}
    </div>
  );
}
