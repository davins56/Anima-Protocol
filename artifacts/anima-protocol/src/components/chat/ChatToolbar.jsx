import { Package, Brain, History, Sliders, GitBranch, Download, Upload, Menu, BookOpen, ChevronDown, X, Zap, Settings, MessageSquare } from "lucide-react";
import { Link } from "react-router-dom";
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import CharacterQuickChat from "./CharacterQuickChat";
import SessionToolsDropdown from "./SessionToolsDropdown";
import TTSControls from "./TTSControls";
import EmotionalSoundscapeControl from "@/components/audio/EmotionalSoundscapeControl";
import ChatHeader from "./ChatHeader";
import VoiceInteractionPanel from "@/components/voice/VoiceInteractionPanel";
import StoryDocumentUpload from "./StoryDocumentUpload";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export default function ChatToolbar({
  activeSession,
  characters,
  currentMood,
  characterEmotions,
  inventoryItems,
  serenity,
  showMentalLine,
  isReadingStory,
  isPlaying, setIsPlaying,
  volume, setVolume,
  intensity, currentSoundscape,
  tts, elTTS, emotionalTTS,
  onShowInventory,
  onToggleMentalLine,
  onReadStory,
  onStopReadingStory,
  onShowImageGen,
  onShowEditModal,
  onToggleDeepMode,
  onOpenRecap,
  onSelectBranch,
  onCreateBranch,
  onShowExport,
}) {
  const [showActionsPanel, setShowActionsPanel] = useState(false);
  const [showDocUpload, setShowDocUpload] = useState(false);

  return (
    <div className="hidden sm:flex flex-col border-b border-primary/20 bg-black/60 backdrop-blur-md flex-shrink-0 relative">
      {/* Single row: session info + Online button */}
      <div className="flex items-center min-w-0 h-12">
        <div className="flex-shrink-0 min-w-[200px] max-w-[60%]">
          <ChatHeader
            session={activeSession}
            characters={characters}
            mood={currentMood}
            characterEmotions={characterEmotions}
            onToggleDeepMode={onToggleDeepMode}
          />
        </div>

        <div className="ml-auto flex items-center gap-2 px-3 flex-shrink-0">
          {/* Online / Actions button */}
          <button
            onClick={() => setShowActionsPanel(!showActionsPanel)}
            className={`flex items-center gap-1.5 px-3 py-1.5 border font-mono text-[9px] tracking-widest uppercase transition-all ${
              showActionsPanel
                ? "border-primary/60 text-primary bg-primary/10"
                : "border-primary/30 text-primary/50 hover:text-primary hover:border-primary/50"
            }`}
          >
            <Zap className={`w-3 h-3 ${showActionsPanel ? "text-primary" : "text-primary/50"}`} />
            Online
            <ChevronDown className={`w-3 h-3 transition-transform ${showActionsPanel ? "rotate-180" : ""}`} />
          </button>
        </div>
      </div>

      {/* Overlay actions panel */}
      <AnimatePresence>
        {showActionsPanel && (
          <>
            {/* Backdrop to close */}
            <div
              className="fixed inset-0 z-40"
              onClick={() => setShowActionsPanel(false)}
            />
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.15 }}
              className="absolute top-full right-0 z-50 w-64 border border-primary/20 bg-black/95 backdrop-blur-md shadow-2xl shadow-black/80 overflow-y-auto"
              style={{ maxHeight: "70vh" }}
            >
              <div className="flex flex-col">

                {/* Navigation */}
                <div className="px-3 py-2 border-b border-primary/10">
                  <p className="font-mono text-[8px] text-primary/30 tracking-widest uppercase mb-1.5">Navigate</p>
                  <div className="flex flex-col gap-0.5">
                    <Link
                      to={`/orchestrate/${activeSession.id}`}
                      onClick={() => setShowActionsPanel(false)}
                      className="flex items-center gap-3 px-2 py-2 text-primary/50 hover:text-primary hover:bg-primary/5 transition-all rounded"
                    >
                      <Sliders className="w-3.5 h-3.5 flex-shrink-0" />
                      <span className="font-mono text-[10px] tracking-widest uppercase">Orchestrate</span>
                    </Link>
                    <Link
                      to="/what-if"
                      onClick={() => setShowActionsPanel(false)}
                      className="flex items-center gap-3 px-2 py-2 text-primary/50 hover:text-primary hover:bg-primary/5 transition-all rounded"
                    >
                      <GitBranch className="w-3.5 h-3.5 flex-shrink-0" />
                      <span className="font-mono text-[10px] tracking-widest uppercase">What If</span>
                    </Link>
                    <Link
                      to={`/story-reader/${activeSession.id}`}
                      onClick={() => setShowActionsPanel(false)}
                      className="flex items-center gap-3 px-2 py-2 text-primary/50 hover:text-primary hover:bg-primary/5 transition-all rounded"
                    >
                      <BookOpen className="w-3.5 h-3.5 flex-shrink-0" />
                      <span className="font-mono text-[10px] tracking-widest uppercase">Story Reader</span>
                    </Link>
                  </div>
                </div>

                {/* Actions */}
                <div className="px-3 py-2 border-b border-primary/10">
                  <p className="font-mono text-[8px] text-primary/30 tracking-widest uppercase mb-1.5">Actions</p>
                  <div className="flex flex-col gap-0.5">
                    {activeSession.mode === "solo" && activeSession.character_id && (
                      <button
                        onClick={() => { onShowInventory(); setShowActionsPanel(false); }}
                        className="flex items-center gap-3 px-2 py-2 text-primary/50 hover:text-primary hover:bg-primary/5 transition-all rounded text-left"
                      >
                        <Package className="w-3.5 h-3.5 flex-shrink-0" />
                        <span className="font-mono text-[10px] tracking-widest uppercase">Inventory</span>
                        {inventoryItems.length > 0 && (
                          <span className="ml-auto font-mono text-[9px] text-primary/40">{inventoryItems.length}</span>
                        )}
                      </button>
                    )}
                    {serenity && (
                      <button
                        onClick={() => { onToggleMentalLine(); setShowActionsPanel(false); }}
                        className={`flex items-center gap-3 px-2 py-2 transition-all rounded text-left ${
                          showMentalLine ? "text-purple-400 bg-purple-600/10" : "text-primary/50 hover:text-primary hover:bg-primary/5"
                        }`}
                      >
                        <Brain className="w-3.5 h-3.5 flex-shrink-0" />
                        <span className="font-mono text-[10px] tracking-widest uppercase">Mental Line</span>
                      </button>
                    )}
                    <button
                      onClick={() => { isReadingStory ? onStopReadingStory() : onReadStory(); setShowActionsPanel(false); }}
                      disabled={!activeSession?.messages?.length}
                      className="flex items-center gap-3 px-2 py-2 text-primary/50 hover:text-primary hover:bg-primary/5 transition-all rounded text-left disabled:opacity-30"
                    >
                      <span className="text-sm leading-none">{isReadingStory ? "🔇" : "🔊"}</span>
                      <span className="font-mono text-[10px] tracking-widest uppercase">{isReadingStory ? "Stop Reading" : "Read Aloud"}</span>
                    </button>
                    <button
                      onClick={() => { onShowImageGen(); setShowActionsPanel(false); }}
                      className="flex items-center gap-3 px-2 py-2 text-primary/50 hover:text-primary hover:bg-primary/5 transition-all rounded text-left"
                    >
                      <span className="text-sm leading-none">🎨</span>
                      <span className="font-mono text-[10px] tracking-widest uppercase">Generate Image</span>
                    </button>
                    <button
                      onClick={() => { setShowDocUpload(!showDocUpload); setShowActionsPanel(false); }}
                      className="flex items-center gap-3 px-2 py-2 text-primary/50 hover:text-primary hover:bg-primary/5 transition-all rounded text-left"
                    >
                      <Upload className="w-3.5 h-3.5 flex-shrink-0" />
                      <span className="font-mono text-[10px] tracking-widest uppercase">Upload Docs</span>
                    </button>
                  </div>
                </div>

                {/* Session */}
                <div className="px-3 py-2 border-b border-primary/10">
                  <p className="font-mono text-[8px] text-primary/30 tracking-widest uppercase mb-1.5">Session</p>
                  <div className="flex flex-col gap-0.5">
                    <button
                      onClick={() => { onShowEditModal(); setShowActionsPanel(false); }}
                      className="flex items-center gap-3 px-2 py-2 text-primary/50 hover:text-primary hover:bg-primary/5 transition-all rounded text-left"
                    >
                      <Settings className="w-3.5 h-3.5 flex-shrink-0" />
                      <span className="font-mono text-[10px] tracking-widest uppercase">Settings</span>
                    </button>
                    <button
                      onClick={() => { onOpenRecap(); setShowActionsPanel(false); }}
                      className="flex items-center gap-3 px-2 py-2 text-primary/50 hover:text-primary hover:bg-primary/5 transition-all rounded text-left"
                    >
                      <span className="text-sm leading-none">📖</span>
                      <span className="font-mono text-[10px] tracking-widest uppercase">Session Recap</span>
                    </button>
                    <button
                      onClick={() => { onShowExport(); setShowActionsPanel(false); }}
                      className="flex items-center gap-3 px-2 py-2 text-primary/50 hover:text-primary hover:bg-primary/5 transition-all rounded text-left"
                    >
                      <Download className="w-3.5 h-3.5 flex-shrink-0" />
                      <span className="font-mono text-[10px] tracking-widest uppercase">Export</span>
                    </button>
                    <div className="px-2 py-1">
                      <SessionToolsDropdown
                        sessionId={activeSession.id}
                        characterId={activeSession.character_id}
                        onSelectBranch={onSelectBranch}
                        onCreateBranch={onCreateBranch}
                      />
                    </div>
                    <div className="px-2 py-1">
                      <CharacterQuickChat
                        characters={characters}
                        sessionId={activeSession.id}
                        mode={activeSession.mode}
                        groupCharacterIds={activeSession.group_character_ids}
                      />
                    </div>
                  </div>
                </div>

                {/* Audio */}
                <div className="px-3 py-3">
                  <p className="font-mono text-[8px] text-primary/30 tracking-widest uppercase mb-2">Audio</p>
                  <div className="space-y-3">
                    <EmotionalSoundscapeControl
                      isPlaying={isPlaying}
                      setIsPlaying={setIsPlaying}
                      volume={volume}
                      setVolume={setVolume}
                      intensity={intensity}
                      currentSoundscape={currentSoundscape}
                    />
                    <VoiceInteractionPanel
                      characterName={activeSession?.mode === 'solo' ? characters.find(c => c.id === activeSession.character_id)?.name : 'Voice'}
                      characterEmotion={activeSession?.mode === 'solo' ? characterEmotions[activeSession.character_id]?.emotion : 'neutral'}
                      isEnabled={elTTS.isEnabled}
                      onToggle={elTTS.toggle}
                      messageContent={activeSession?.messages?.[activeSession.messages.length - 1]?.content}
                      isMessagePlaying={elTTS.isSpeaking}
                    />
                    <TTSControls
                      isEnabled={tts.isEnabled}
                      isSpeaking={tts.isSpeaking || elTTS.isSpeaking || emotionalTTS.isSpeaking}
                      isSupported={tts.isSupported}
                      voices={tts.voices}
                      selectedVoice={tts.selectedVoice}
                      onSetVoice={tts.setSelectedVoice}
                      onToggle={tts.toggle}
                      onStop={() => { tts.stop(); elTTS.stop(); emotionalTTS.stop(); }}
                      elEnabled={elTTS.isEnabled}
                      onElToggle={elTTS.toggle}
                    />
                  </div>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Document upload panel */}
      {showDocUpload && (
        <div className="border-t border-primary/10 p-3 bg-black/40 backdrop-blur-md">
          <StoryDocumentUpload
            sessionId={activeSession?.id}
            onDocumentProcessed={() => setShowDocUpload(false)}
          />
        </div>
      )}
    </div>
  );
}