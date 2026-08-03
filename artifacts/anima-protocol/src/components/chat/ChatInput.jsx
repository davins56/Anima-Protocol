import { useState } from "react";
import { Send, Zap, Paperclip, Loader } from "lucide-react";
import { base44 } from "@/api/base44Client";

// Check if the entire text (or the segment around cursor) is italic (*...*) 
function isInItalicContext(text) {
  // Check if current typed word/phrase is wrapped in stars
  const starMatches = text.match(/\*[^*]*$/);
  return !!starMatches;
}

export default function ChatInput({ onSend, isLoading, disabled, allowEmpty = false }) {
  const [value, setValue] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [uploadingMedia, setUploadingMedia] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (isLoading || disabled) return;
    if (!value.trim() && !attachments.length && !allowEmpty) return;
    
    // Create message with attachments if present
    const message = {
      text: value.trim(),
      attachments: attachments.length > 0 ? attachments : undefined
    };
    
    onSend(message);
    setValue("");
    setAttachments([]);
  };

  const handleMediaUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    setUploadingMedia(true);
    try {
      for (const file of files) {
        const { file_url } = await base44.integrations.Core.UploadFile({ file });
        const isAudio = file.type.startsWith("audio/");
        setAttachments((prev) => [
          ...prev,
          { url: file_url, type: isAudio ? "audio" : "image", name: file.name }
        ]);
      }
    } catch (err) {
      console.error("Media upload error:", err);
    } finally {
      setUploadingMedia(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div className="border-t border-primary/20 bg-black/60 backdrop-blur-md p-3 sm:p-4 space-y-2">
      {isLoading && (
        <div className="flex items-center gap-2 mb-2 text-primary/50">
          <Zap className="w-2.5 h-2.5 animate-pulse" />
          <span className="font-mono text-[9px] tracking-[0.3em] uppercase animate-pulse">
            Processing...
          </span>
        </div>
      )}

      {/* Attachments preview */}
      {attachments.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {attachments.map((att, idx) => (
            <div key={idx} className="relative w-12 h-12 border border-primary/30 bg-black/60 hud-corner overflow-hidden">
              {att.type === "image" ? (
                <img src={att.url} alt="preview" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-[10px] text-primary/50">🔊</div>
              )}
              <button
                onClick={() => setAttachments((prev) => prev.filter((_, i) => i !== idx))}
                className="absolute -top-1 -right-1 w-4 h-4 bg-destructive text-white text-[8px] flex items-center justify-center rounded-full"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex gap-2 sm:gap-3 items-end min-w-0">
        {/* Media upload button */}
        <label className="flex-shrink-0 w-10 sm:w-12 h-10 sm:h-12 btn-sacred text-primary disabled:opacity-30 flex items-center justify-center hud-corner cursor-pointer">
          <input
            type="file"
            multiple
            accept="image/*,audio/*"
            onChange={handleMediaUpload}
            disabled={uploadingMedia || isLoading || disabled}
            className="hidden"
          />
          {uploadingMedia ? (
            <Loader className="w-3.5 sm:w-4 h-3.5 sm:h-4 animate-spin" />
          ) : (
            <Paperclip className="w-3.5 sm:w-4 h-3.5 sm:h-4" />
          )}
        </label>

        <div className="flex-1 min-w-0">
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={allowEmpty ? "Message... (or send empty to continue story)" : "Ask me anything (I'm an AI and can make mistakes)..."}
            disabled={disabled || isLoading}
            rows={1}
            className="w-full input-sacred text-primary/90 placeholder-primary/20 font-mono text-base sm:text-sm px-3 sm:px-4 py-2 sm:py-3 resize-none focus:outline-none transition-all hud-corner"
            style={{ minHeight: "40px", maxHeight: "120px", fontSize: "16px", fontStyle: isInItalicContext(value) ? "italic" : "normal" }}
            onInput={(e) => {
              e.target.style.height = "auto";
              e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
            }}
          />
        </div>
        <button
          type="submit"
          disabled={((!value.trim() && !attachments.length && !allowEmpty) || isLoading || disabled || uploadingMedia)}
          className="flex-shrink-0 w-10 sm:w-12 h-10 sm:h-12 btn-sacred text-primary disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center hud-corner"
        >
          <Send className="w-3.5 sm:w-4 h-3.5 sm:h-4" />
        </button>
      </form>
      <p className="mt-1.5 text-[8px] sm:text-[9px] font-mono text-primary/15 tracking-widest uppercase">
        <span className="hidden sm:inline">Enter to send · Shift+Enter for newline</span>
        <span className="sm:hidden">Enter to send</span>
      </p>
    </div>
  );
}