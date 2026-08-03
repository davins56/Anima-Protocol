import ContinueButton from "./ContinueButton";
import SpeakToAnimaButton from "@/components/anima/SpeakToAnimaButton";

export default function ChatInputControls({ onVoiceClick, onContinue, isLoading, sessionMode, activeCharacter, onSend }) {
  return (
    <div className="flex gap-2 px-4 sm:px-6 pt-2 items-center">
      <button
        onClick={onVoiceClick}
        className="flex-shrink-0 px-3 py-2 border border-primary/20 text-primary/40 hover:text-primary/70 hover:border-primary/40 font-mono text-[9px] tracking-widest uppercase transition-all rounded"
        title="Voice input"
      >
        🎤 Speak
      </button>
      
      {activeCharacter && onSend && (
        <SpeakToAnimaButton
          activeCharacter={activeCharacter}
          onSend={onSend}
          disabled={isLoading}
        />
      )}

      <ContinueButton onClick={onContinue} disabled={isLoading} mode={sessionMode} />
    </div>
  );
}