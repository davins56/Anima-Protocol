import { useFocusMode } from "@/hooks/useFocusMode";
import FocusModeToggle from "./FocusModeToggle";
import CinematicMessageList from "./CinematicMessageList";

export default function ChatUIContainer({
  activeSession,
  characters,
  onSpeak,
  normalModeContent,
}) {
  const { isFocusMode, toggleFocusMode } = useFocusMode();

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Focus Mode Toggle */}
      {activeSession && (
        <div className="flex items-center justify-end px-3 sm:px-4 py-2 border-b border-primary/10 bg-black/40 flex-shrink-0">
          <FocusModeToggle isFocusMode={isFocusMode} onToggle={toggleFocusMode} />
        </div>
      )}

      {/* Content */}
      <div className={`flex-1 overflow-hidden min-h-0 ${isFocusMode ? "bg-black/80" : ""}`}>
        {isFocusMode ? (
          <div className="h-full overflow-y-auto overscroll-contain p-4 sm:p-8 md:p-12">
            <CinematicMessageList
              messages={activeSession?.messages}
              session={activeSession}
              characters={characters}
              isFocusMode={true}
              onSpeak={onSpeak}
            />
          </div>
        ) : (
          normalModeContent
        )}
      </div>
    </div>
  );
}