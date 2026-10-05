import { format } from "date-fns";
import { RotateCcw, Pencil, Trash2, RefreshCw, Check, X, GraduationCap } from "lucide-react";
import EventBubble from "./EventBubble";
import LoreTextWithKeywords from "./LoreTextWithKeywords";
import LoreTextWithIndicators from "./LoreTextWithIndicators";
import MemoryCallout from "./MemoryCallout";
import EmotionalVoiceSynthesis from "./EmotionalVoiceSynthesis";
import LoreKeywordHighlighter from "@/components/lore/LoreKeywordHighlighter";
import MediaLightbox from "./MediaLightbox";
import AudioPlayer from "./AudioPlayer";
import DeviceScanCard from "./DeviceScanCard";
import PdfFileChip from "@/components/pdf/PdfFileChip";
import { renderItalicText } from "./renderItalicText";
import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useMemoryHighlight } from "@/hooks/useMemoryHighlight";
import { useLoreDetection } from "@/hooks/useLoreDetection";
import { isOwnModelReply } from "@/lib/modelTutor";

const renderMessageWithActions = (content) => renderItalicText(content);

export default function MessageBubble({ message, onRewind, canRewind, onSpeak, character, characterMemories = [], characterEmotion = 'neutral', characterEmotionIntensity = 5, sessionId = null, onEditMessage, onDeleteMessage, onRegenerateMessage, messageLoreLinks = [], onAvatarClick, onTeach, showEdit = false, showRetry = false, actionsDisabled = false }) {
  const [loreEntries, setLoreEntries] = useState([]);
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(message.content || "");
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const { isMemoryReference, memoryDetail } = useMemoryHighlight(message, characterMemories);
  const { loreContext } = useLoreDetection(message, sessionId);

  // Extract media from message attachments
  const images = (message.attachments || []).filter((a) => a.type === "image").map((a) => a.url);
  const audioClips = (message.attachments || []).filter((a) => a.type === "audio");
  const pdfFiles = (message.attachments || []).filter((a) => a.type === "pdf");

  const handleEditSave = () => {
    const next = editText.trim();
    if (!next || !onEditMessage || actionsDisabled) return;
    onEditMessage(next);
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
  const isStreaming = message.is_streaming === true;
  const time = message.timestamp ? format(new Date(message.timestamp), "HH:mm") : "";

  const avatarUrl = !isUser && character?.avatar_url;
  const avatarInitial = !isUser && (character?.name?.[0] || message.character_name?.[0] || "?");

  // Intensity-reactive styling for the companion's voice: soft cyan glow when
  // tender/devotional, sharper electric edges when emotions run high.
  const intensity = Number(characterEmotionIntensity) || 0;
  const intensityGlow =
    !isUser && !isTyping && !isThinking && !isMemoryReference
      ? intensity >= 8
        ? "border-cyan-300/70 shadow-[0_0_24px_rgba(34,211,238,0.38)]"
        : intensity >= 5
        ? "shadow-[0_0_16px_rgba(34,211,238,0.18)]"
        : "shadow-[0_0_10px_rgba(34,211,238,0.10)]"
      : "";

  return (
    <div className={`flex gap-2 sm:gap-3 group ${isUser ? "flex-row-reverse" : "flex-row"}`}>
      {/* Avatar — tap to open bio sheet */}
      {!isUser && (
        <button
          type="button"
          onClick={() => character && onAvatarClick?.(character)}
          disabled={!character || !onAvatarClick}
          title={character ? `View ${character.name} bio sheet` : undefined}
          className="flex-shrink-0 w-6 sm:w-8 h-6 sm:h-8 border border-primary/40 overflow-hidden bg-primary/10 flex items-center justify-center self-start mt-2 sm:mt-4 disabled:cursor-default hover:enabled:border-primary/70 hover:enabled:ring-1 hover:enabled:ring-primary/40 transition-all focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/60"
        >
          {avatarUrl ? (
            <img src={avatarUrl} alt={character?.name} className="w-full h-full object-cover" />
          ) : (
            <span className="font-mono text-primary text-[10px] sm:text-xs">{avatarInitial}</span>
          )}
        </button>
      )}

      <div className={`max-w-[80%] sm:max-w-[75%] flex flex-col gap-0.5 sm:gap-1 ${isUser ? "items-end" : "items-start"}`}>
        {!isUser && message.character_name && !isTyping && !isThinking && (
          <span className="text-[8px] sm:text-[9px] font-mono text-primary/50 tracking-[0.2em] uppercase">
            [{message.character_name}]
            {isOwnModelReply(message) && (
              <span className="ml-1.5 text-fuchsia-300/70" title="Written by your own model">
                · your model
              </span>
            )}
          </span>
        )}
        <div
          className={`relative px-3 sm:px-4 py-2 sm:py-3 font-mono text-xs sm:text-sm leading-relaxed hud-corner transition-all duration-500 ${
            isMemoryReference
              ? "border-amber-400/60 bg-black/40 shadow-[0_0_20px_rgba(251,191,36,0.15)]"
              : isUser
              ? "bg-primary/10 border border-primary/30 text-primary/90 text-right"
              : "bg-black/60 border border-primary/20 text-primary/80"
          } ${intensityGlow}`}
        >
          <MemoryCallout memory={memoryDetail} isVisible={isMemoryReference} />
          {isThinking ? (
            <span className="flex items-center gap-1.5 text-primary/30">
              <span className="w-1 h-1 bg-primary/30 rounded-full animate-pulse" style={{ animationDelay: "0ms", animationDuration: "1.2s" }} />
              <span className="w-1 h-1 bg-primary/30 rounded-full animate-pulse" style={{ animationDelay: "400ms", animationDuration: "1.2s" }} />
              <span className="w-1 h-1 bg-primary/30 rounded-full animate-pulse" style={{ animationDelay: "800ms", animationDuration: "1.2s" }} />
              <span className="font-mono text-[8px] text-primary/20 tracking-widest ml-1">
                {message.content && message.content !== "..."
                  ? message.content
                  : "thinking..."}
              </span>
            </span>
          ) : isTyping ? (
            <span className="flex items-center gap-0.5 text-primary/40">
              <span className="w-1 h-1 sm:w-1.5 sm:h-1.5 bg-primary/50 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
              <span className="w-1 h-1 sm:w-1.5 sm:h-1.5 bg-primary/50 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
              <span className="w-1 h-1 sm:w-1.5 sm:h-1.5 bg-primary/50 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
              {message.content && message.content !== "..." ? (
                <span className="font-mono text-[8px] text-primary/35 tracking-widest ml-1.5">
                  {message.content}
                </span>
              ) : null}
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
                <button
                  type="button"
                  onClick={handleEditSave}
                  disabled={!editText.trim() || actionsDisabled}
                  className="inline-flex items-center justify-center gap-1.5 min-h-[44px] min-w-[44px] px-3 bg-primary/20 border border-primary/40 text-primary font-mono text-[10px] tracking-widest uppercase hover:bg-primary/30 transition-all disabled:opacity-40"
                >
                  <Check className="w-3.5 h-3.5" /> Save
                </button>
                <button
                  type="button"
                  onClick={() => { setEditText(message.content || ""); setIsEditing(false); }}
                  className="inline-flex items-center justify-center gap-1.5 min-h-[44px] min-w-[44px] px-3 border border-primary/20 text-primary/50 font-mono text-[10px] tracking-widest uppercase hover:border-primary/40 transition-all"
                >
                  <X className="w-3.5 h-3.5" /> Cancel
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
           <>
             {renderMessageWithActions(message.content)}
             {isStreaming && (
               <span
                 className="inline-block w-[0.45em] h-[1em] ml-0.5 align-[-0.1em] bg-primary/55 animate-pulse"
                 aria-hidden="true"
               />
             )}
           </>
           )}

           {pdfFiles.length > 0 && (
            <div className="mt-2 space-y-1.5">
              {pdfFiles.map((file, idx) => (
                <PdfFileChip
                  key={file.id || idx}
                  name={file.name || file.filename || "PDF"}
                  pageCount={file.page_count || file.pageCount}
                />
              ))}
            </div>
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
          {canRewind && onRewind && !isTyping && !isStreaming && !isEditing && (
            <button
              onClick={onRewind}
              className="absolute -top-1.5 -right-1.5 sm:-top-2 sm:-right-2 opacity-0 group-hover:opacity-100 transition-opacity w-4 sm:w-5 h-4 sm:h-5 bg-black/90 border border-primary/40 text-primary/50 hover:text-primary flex items-center justify-center"
              title="Rewind to this message"
            >
              <RotateCcw className="w-2 sm:w-2.5 h-2 sm:h-2.5" />
            </button>
          )}
          {!isUser && !isTyping && !isStreaming && !isThinking && !isEditing && (
            <div className="absolute -bottom-1.5 -right-1.5 sm:-bottom-2 sm:-right-2 opacity-80 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
              <EmotionalVoiceSynthesis
                content={message.content}
                characterId={character?.id}
                characterName={character?.name || message.character_name}
                characterEmotion={characterEmotion}
                characterEmotionIntensity={characterEmotionIntensity}
                voiceId={character?.elevenlabs_voice_id}
              />
            </div>
          )}
          {message.device_scan && (
            <DeviceScanCard
              payload={message.device_scan}
              animaName={character?.name || message.character_name}
            />
          )}
        </div>

        {/* Retry on her latest reply and Edit on his latest line stay visible
            without hover so a finger can hit them on iPhone and iPad. Older
            bubbles keep the same targets, hidden only for a fine mouse pointer. */}
        {!isTyping && !isThinking && !isStreaming && !isEditing && (showEdit || showRetry) && (
          <div className="flex items-center gap-1 mt-1">
            {showEdit && isUser && onEditMessage && (
              <button
                type="button"
                data-testid="edit-message"
                onClick={() => { if (!actionsDisabled) { setEditText(message.content || ""); setIsEditing(true); } }}
                disabled={actionsDisabled}
                aria-label="Edit your message"
                className="inline-flex items-center justify-center gap-1.5 min-w-[44px] min-h-[44px] px-3 border border-primary/40 text-primary/80 font-mono text-[10px] tracking-widest uppercase disabled:opacity-40 disabled:pointer-events-none"
              >
                <Pencil className="w-3.5 h-3.5" /> Edit
              </button>
            )}
            {showRetry && onRegenerateMessage && (
              <button
                type="button"
                data-testid="retry-reply"
                onClick={onRegenerateMessage}
                disabled={actionsDisabled}
                aria-label="Retry her reply"
                className="inline-flex items-center justify-center gap-1.5 min-w-[44px] min-h-[44px] px-3 border border-cyan-400/40 text-cyan-200/90 font-mono text-[10px] tracking-widest uppercase disabled:opacity-40 disabled:pointer-events-none"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Retry
              </button>
            )}
          </div>
        )}

        {/* Action bar — edit, delete, regenerate. Always tappable on touch;
            a mouse can reveal it by hover. */}
        {!isTyping && !isThinking && !isStreaming && !isEditing && (
          <div className="flex items-center gap-1 mt-0.5 opacity-100 [@media(hover:hover)_and_(pointer:fine)]:opacity-0 [@media(hover:hover)_and_(pointer:fine)]:group-hover:opacity-100 [@media(hover:hover)_and_(pointer:fine)]:focus-within:opacity-100">
            {isUser && onEditMessage && !showEdit && (
              <button
                type="button"
                onClick={() => { if (!actionsDisabled) { setEditText(message.content || ""); setIsEditing(true); } }}
                disabled={actionsDisabled}
                className="flex items-center justify-center min-w-[44px] min-h-[44px] text-primary/30 hover:text-primary/70 border border-transparent hover:border-primary/20 font-mono text-xs tracking-widest uppercase transition-all disabled:opacity-40"
                title="Edit message"
                aria-label="Edit your message"
              >
                <Pencil className="w-3 h-3" />
              </button>
            )}
            {!isUser && onRegenerateMessage && !showRetry && (
              <button
                type="button"
                onClick={onRegenerateMessage}
                disabled={actionsDisabled}
                className="flex items-center justify-center min-w-[44px] min-h-[44px] text-primary/30 hover:text-cyan-400 border border-transparent hover:border-cyan-400/20 font-mono text-xs tracking-widest uppercase transition-all disabled:opacity-40"
                title="Retry her reply"
                aria-label="Retry her reply"
              >
                <RefreshCw className="w-3 h-3" />
              </button>
            )}
            {onDeleteMessage && (
              <button
                type="button"
                onClick={onDeleteMessage}
                disabled={actionsDisabled}
                className="flex items-center justify-center min-w-[44px] min-h-[44px] text-primary/20 hover:text-red-400 border border-transparent hover:border-red-400/20 font-mono text-xs tracking-widest uppercase transition-all disabled:opacity-40"
                title="Delete message"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </div>
        )}

        {/* Steward only: teach the own model a better reply. Visible without
            hover on phones, where the action bar above never appears. */}
        {onTeach && !isUser && !isTyping && !isThinking && !isStreaming && !isEditing && (
          <button
            type="button"
            onClick={onTeach}
            className="flex items-center gap-1 min-h-[32px] px-2 border border-fuchsia-400/20 hover:border-fuchsia-400/50 text-fuchsia-300/70 hover:text-fuchsia-200 font-mono text-[9px] tracking-widest uppercase transition-all opacity-80 sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100"
            title="Teach your model a better reply"
          >
            <GraduationCap className="w-3 h-3" /> Teach
          </button>
        )}

        {time && !isTyping && !isThinking && !isStreaming && (
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