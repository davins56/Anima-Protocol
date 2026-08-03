import ChatHeader from "./ChatHeader";
import SessionToolsDropdown from "./SessionToolsDropdown";
import TTSControls from "./TTSControls";

export default function ChatTopBar({
  session,
  characters,
  mood,
  characterEmotions,
  onEditSession,
  onOpenRecap,
  onSelectBranch,
  onCreateBranch,
  tts,
  elTTS,
  emotionalTTS,
}) {
  return (
    <div className="border-b border-primary/20 bg-black/60 backdrop-blur-md flex-shrink-0">
      {/* Single compact row */}
      <div className="flex items-center justify-between px-2 sm:px-4 py-1 sm:py-2 gap-1 sm:gap-2 min-w-0">
        {/* Header (left) */}
        <div className="flex-1 min-w-0">
          <ChatHeader
            session={session}
            characters={characters}
            mood={mood}
            characterEmotions={characterEmotions}
          />
        </div>

        {/* Tools (right) - hide on mobile, show on sm+ */}
        <div className="hidden sm:flex items-center gap-1 flex-shrink-0">
          <SessionToolsDropdown
            sessionId={session.id}
            characterId={session.character_id}
            onSelectBranch={onSelectBranch}
            onCreateBranch={onCreateBranch}
          />
          <button
            onClick={onEditSession}
            title="Edit session settings"
            className="px-1.5 py-1 border border-primary/20 text-primary/30 hover:text-primary/70 hover:border-primary/40 font-mono text-[8px] tracking-widest uppercase transition-all"
          >
            ⚙️
          </button>
          <button
            onClick={onOpenRecap}
            title="View session recap"
            className="px-1.5 py-1 border border-primary/20 text-primary/30 hover:text-primary/70 hover:border-primary/40 font-mono text-[8px] tracking-widest uppercase transition-all"
          >
            📖
          </button>
          <TTSControls
            isEnabled={tts.isEnabled}
            isSpeaking={tts.isSpeaking || elTTS.isSpeaking || emotionalTTS.isSpeaking}
            isSupported={tts.isSupported}
            voices={tts.voices}
            selectedVoice={tts.selectedVoice}
            onSetVoice={tts.setSelectedVoice}
            onToggle={tts.toggle}
            onStop={() => {
              tts.stop();
              elTTS.stop();
              emotionalTTS.stop();
            }}
            elEnabled={elTTS.isEnabled}
            onElToggle={elTTS.toggle}
          />
        </div>

        {/* Mobile-only: compact settings only */}
        <button
          onClick={onEditSession}
          title="Settings"
          className="sm:hidden flex-shrink-0 w-6 h-6 flex items-center justify-center text-primary/40 hover:text-primary transition-colors text-xs"
        >
          ⚙️
        </button>
      </div>
    </div>
  );
}