import { Volume2, VolumeX, Square, Mic } from "lucide-react";

export default function TTSControls({
  isEnabled, isSpeaking, isSupported, voices, selectedVoice, onSetVoice, onToggle, onStop,
  elEnabled, onElToggle,
}) {
  return (
    <div className="flex items-center gap-2">
      {/* Voice selector — only shown when system TTS enabled */}
      {isSupported && isEnabled && voices.length > 1 && (
        <select
          value={selectedVoice?.name || ""}
          onChange={(e) => {
            const v = voices.find((v) => v.name === e.target.value);
            if (v) onSetVoice(v);
          }}
          className="bg-black/60 border border-primary/20 text-primary/60 font-mono text-[9px] px-2 py-1 focus:outline-none focus:border-primary/40 max-w-[120px] truncate"
        >
          {voices
            .filter((v) => v.lang.startsWith("en"))
            .map((v) => (
              <option key={v.name} value={v.name}>
                {v.name.split(" ").slice(0, 2).join(" ")}
              </option>
            ))}
        </select>
      )}

      {/* Stop button when speaking */}
      {isSpeaking && (
        <button
          onClick={onStop}
          title="Stop narration"
          className="flex items-center gap-1.5 px-2 py-1 border border-primary/30 text-primary/60 hover:text-primary hover:border-primary/50 transition-all font-mono text-[9px] tracking-widest uppercase"
        >
          <Square className="w-2.5 h-2.5 fill-current" />
          <span className="hidden sm:inline">Stop</span>
        </button>
      )}

      {/* ElevenLabs AI voice toggle */}
      {onElToggle && (
        <button
          onClick={onElToggle}
          title={elEnabled ? "Disable AI voice (ElevenLabs)" : "Enable AI voice (ElevenLabs)"}
          className={`flex items-center gap-1.5 px-3 py-1.5 border font-mono text-[9px] tracking-widest uppercase transition-all ${
            elEnabled
              ? "border-cyan-400/60 bg-cyan-400/10 text-cyan-400"
              : "border-primary/20 text-primary/30 hover:text-primary/60 hover:border-primary/40"
          }`}
        >
          <Mic className={`w-3 h-3 ${elEnabled && isSpeaking ? "animate-pulse" : ""}`} />
          <span className="hidden sm:inline">{elEnabled ? "AI Voice On" : "AI Voice"}</span>
        </button>
      )}

      {/* System TTS narration toggle */}
      {isSupported && (
        <button
          onClick={onToggle}
          title={isEnabled ? "Disable system TTS" : "Enable system TTS"}
          className={`flex items-center gap-1.5 px-3 py-1.5 border font-mono text-[9px] tracking-widest uppercase transition-all ${
            isEnabled
              ? "border-primary/60 bg-primary/10 text-primary glow-border"
              : "border-primary/20 text-primary/30 hover:text-primary/60 hover:border-primary/40"
          }`}
        >
          {isEnabled ? (
            <>
              <Volume2 className={`w-3 h-3 ${isSpeaking ? "animate-pulse" : ""}`} />
              <span className="hidden sm:inline">TTS On</span>
            </>
          ) : (
            <>
              <VolumeX className="w-3 h-3" />
              <span className="hidden sm:inline">TTS</span>
            </>
          )}
        </button>
      )}
    </div>
  );
}