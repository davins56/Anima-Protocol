import { format } from "date-fns";
import { RotateCcw, Pencil, Trash2, RefreshCw, Check, X } from "lucide-react";
import EventBubble from "./EventBubble";
import LoreTextWithKeywords from "./LoreTextWithKeywords";
import LoreTextWithIndicators from "./LoreTextWithIndicators";
import MemoryCallout from "./MemoryCallout";
import EmotionalVoiceSynthesis from "./EmotionalVoiceSynthesis";
import LoreKeywordHighlighter from "@/components/lore/LoreKeywordHighlighter";
import MediaLightbox from "./MediaLightbox";
import AudioPlayer from "./AudioPlayer";
import { renderItalicText } from "./renderItalicText";
import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useMemoryHighlight } from "@/hooks/useMemoryHighlight";
import { useLoreDetection } from "@/hooks/useLoreDetection";

const renderMessageWithActions = (content) => renderItalicText(content);

export default function MessageBubble({ message, onRewind, canRewind, onSpeak, character, characterMemories = [], characterEmotion = 'neutral', characterEmotionIntensity = 5, sessionId = null, onEditMessage, onDeleteMessage, onRegenerateMessage, messageLoreLinks = [] }) {
  const [loreEntries, setLoreEntries] = useState([]);
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(message.content || "");
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const { isMemoryReference, memoryDetail } = useMemoryHighlight(message, characterMemories);
  const { loreContext } = useLoreDetection(message.content, sessionId);

  // Extract media from message attachments
  const images = (message.attachments || []).filter((a) => a.type === "image").map((a) => a.url);
  const audioClips = (message.attachments || []).filter((a) => a.type === "audio");

  const handleEditSave = () => {
    if (editText.trim() && onEditMessage) {
      onEditMessage(editText.trim());
    }
    setIsEditing(false);
  };

  useEffect(() => {
    // Load lore entries on mount
    base44.entities.WorldState.list("-created_date", 100)
      .then(entries => setLoreEntries(entries || []))
      .catch(() => {});
  }, []);
  // Delegate event messages to EventBubble
  if (message.type === "event") {
    return <EventBubble message={message} />;
  }

  const isUser = message.role === "user";
  const isTyping = message.character_name === "__typing__";
  const isThinking = message.character_name === "__thinking__";
  const time = message.timestamp ? format(new Date(message.timestamp), "HH:mm") : "";

  const avatarUrl = !isUser && character?.avatar_url;
  const avatarInitial = !isUser && (character?.name?.[0] || message.character_name?.[0] || "?");

  return (
    <div className={`flex gap-2 sm:gap-3 group ${isUser ? "flex-row-reverse" : "flex-row"}`}>
      {/* Avatar */}
      {!isUser && (
        <div className="flex-shrink-0 w-6 sm:w-8 h-6 sm:h-8 border border-primary/40 overflow-hidden bg-primary/10 flex items-center justify-center self-start mt-2 sm:mt-4">
          {avatarUrl ? (
            <img src={avatarUrl} alt={character?.name} className="w-full h-full object-cover" />
          ) : (
            <span className="font-mono text-primary text-[10px] sm:text-xs">{avatarInitial}</span>
          )}
        </div>
      )}

      <div className={`max-w-[80%] sm:max-w-[75%] flex flex-col gap-0.5 sm:gap-1 ${isUser ? "items-end" : "items-start"}`}>
        {!isUser && message.character_name && !isTyping && !isThinking && (
          <span className="text-[8px] sm:text-[9px] font-mono text-primary/50 tracking-[0.2em] uppercase">
            [{message.character_name}]
          </span>
        )}
        <div
          className={`relative px-3 sm:px-4 py-2 sm:py-3 font-mono text-xs sm:text-sm leading-relaxed hud-corner transition-all ${
            isMemoryReference
              ? "border-amber-400/60 bg-black/40 shadow-[0_0_20px_rgba(251,191,36,0.15)]"
              : isUser
              ? "bg-primary/10 border border-primary/30 text-primary/90 text-right"
              : "bg-black/60 border border-primary/20 text-primary/80"
          }`}
        >
          <MemoryCallout memory={memoryDetail} isVisible={isMemoryReference} />
          {isThinking ? (
            <span className="flex items-center gap-1.5 text-primary/30">
              <span className="w-1 h-1 bg-primary/30 rounded-full animate-pulse" style={{ animationDelay: "0ms", animationDuration: "1.2s" }} />
              <span className="w-1 h-1 bg-primary/30 rounded-full animate-pulse" style={{ animationDelay: "400ms", animationDuration: "1.2s" }} />
              <span className="w-1 h-1 bg-primary/30 rounded-full animate-pulse" style={{ animationDelay: "800ms", animationDuration: "1.2s" }} />
              <span className="font-mono text-[8px] text-primary/20 tracking-widest ml-1">thinking...</span>
            </span>
          ) : isTyping ? (
            <span className="flex items-center gap-0.5 text-primary/40">
              <span className="w-1 h-1 sm:w-1.5 sm:h-1.5 bg-primary/50 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
              <span className="w-1 h-1 sm:w-1.5 sm:h-1.5 bg-primary/50 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
              <span className="w-1 h-1 sm:w-1.5 sm:h-1.5 bg-primary/50 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
            </span>
          ) : isEditing ? (
            <div className="space-y-2 min-w-[180px]">
              <textarea
                value={editText}
                onChange={e => setEditText(e.target.value)}
                className="w-full bg-black/60 border border-primary/40 text-primary/90 font-mono text-xs p-2 focus:outline-none resize-none"
                rows={3}
                autoFocus
              />
              <div className="flex gap-2">
                <button onClick={handleEditSave} className="flex items-center gap-1 px-2 py-1 bg-primary/20 border border-primary/40 text-primary font-mono text-[8px] tracking-widest uppercase hover:bg-primary/30 transition-all">
                  <Check className="w-2.5 h-2.5" /> Save
                </button>
                <button onClick={() => setIsEditing(false)} className="flex items-center gap-1 px-2 py-1 border border-primary/20 text-primary/50 font-mono text-[8px] tracking-widest uppercase hover:border-primary/40 transition-all">
                  <X className="w-2.5 h-2.5" /> Cancel
                </button>
              </div>
            </div>
          ) : !isUser && messageLoreLinks && messageLoreLinks.length > 0 ? (
           <LoreKeywordHighlighter content={message.content} loreLinks={messageLoreLinks} />
          ) : !isUser && loreContext.length > 0 ? (
           <LoreTextWithIndicators content={message.content} loreContext={loreContext} />
          ) : !isUser && loreEntries.length > 0 ? (
           <LoreTextWithKeywords content={message.content} loreEntries={loreEntries} />
          ) : (
           renderMessageWithActions(message.content)
           )}

           {/* Media attachments */}
           {audioClips.length > 0 && (
            <div className="mt-2 space-y-1">
              {audioClips.map((clip, idx) => (
                <AudioPlayer key={idx} src={clip.url} label={clip.name || "Voice Message"} />
              ))}
            </div>
           )}

           {images.length > 0 && (
            <div className="mt-2 grid grid-cols-2 gap-1 sm:grid-cols-3">
              {images.map((img, idx) => (
                <button
                  key={idx}
                  onClick={() => {
                    setLightboxIndex(idx);
                    setLightboxOpen(true);
                  }}
                  className="relative overflow-hidden border border-primary/20 hud-corner hover:border-primary/50 transition-all group"
                >
                  <img src={img} alt={`Memory ${idx}`} className="w-full aspect-square object-cover group-hover:scale-105 transition-transform" />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                    <span className="text-white/60 text-xs font-mono opacity-0 group-hover:opacity-100 transition-opacity">👁️</span>
                  </div>
                </button>
              ))}
            </div>
           )}

           {/* Rewind button */}
          {canRewind && onRewind && !isTyping && !isEditing && (
            <button
              onClick={onRewind}
              className="absolute -top-1.5 -right-1.5 sm:-top-2 sm:-right-2 opacity-0 group-hover:opacity-100 transition-opacity w-4 sm:w-5 h-4 sm:h-5 bg-black/90 border border-primary/40 text-primary/50 hover:text-primary flex items-center justify-center"
              title="Rewind to this message"
            >
              <RotateCcw className="w-2 sm:w-2.5 h-2 sm:h-2.5" />
            </button>
          )}
          {!isUser && !isTyping && character?.id && !isEditing && (
            <div className="absolute -bottom-1.5 -right-1.5 sm:-bottom-2 sm:-right-2 opacity-0 group-hover:opacity-100 transition-opacity">
              <EmotionalVoiceSynthesis
                content={message.content}
                characterId={character.id}
                characterName={character.name}
                characterEmotion={characterEmotion}
                characterEmotionIntensity={characterEmotionIntensity}
              />
            </div>
          )}
        </div>

        {/* Action bar — edit, delete, regenerate */}
        {!isTyping && !isThinking && !isEditing && (
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity mt-0.5">
            {isUser && onEditMessage && (
              <button
                onClick={() => { setEditText(message.content); setIsEditing(true); }}
                className="flex items-center justify-center min-w-[44px] min-h-[44px] text-primary/30 hover:text-primary/70 border border-transparent hover:border-primary/20 font-mono text-xs tracking-widest uppercase transition-all"
                title="Edit message"
              >
                <Pencil className="w-3 h-3" />
              </button>
            )}
            {!isUser && onRegenerateMessage && (
              <button
                onClick={onRegenerateMessage}
                className="flex items-center justify-center min-w-[44px] min-h-[44px] text-primary/30 hover:text-cyan-400 border border-transparent hover:border-cyan-400/20 font-mono text-xs tracking-widest uppercase transition-all"
                title="Regenerate response"
              >
                <RefreshCw className="w-3 h-3" />
              </button>
            )}
            {onDeleteMessage && (
              <button
                onClick={onDeleteMessage}
                className="flex items-center justify-center min-w-[44px] min-h-[44px] text-primary/20 hover:text-red-400 border border-transparent hover:border-red-400/20 font-mono text-xs tracking-widest uppercase transition-all"
                title="Delete message"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </div>
        )}

        {time && !isTyping && !isThinking && (
          <span className="text-[7px] sm:text-[9px] font-mono text-primary/20 tracking-widest">{time}</span>
        )}
      </div>

      {/* Lightbox */}
      <MediaLightbox
        isOpen={lightboxOpen}
        images={images}
        initialIndex={lightboxIndex}
        onClose={() => setLightboxOpen(false)}
      />

      {isUser && (
        <div className="flex-shrink-0 w-6 sm:w-8 h-6 sm:h-8 border border-primary/30 bg-black/40 flex items-center justify-center self-start mt-2 sm:mt-4">
          <div className="w-1.5 sm:w-2 h-1.5 sm:h-2 bg-primary/50 rounded-full" />
        </div>
      )}
    </div>
  );
}