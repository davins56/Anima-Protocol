import { useState, useRef, useLayoutEffect, useEffect } from "react";
import { mergeDraftIntoComposer } from "@/lib/heldChatSend";
import { Send, Zap, Paperclip, Loader, FileText } from "lucide-react";
import { toast } from "sonner";
import { base44 } from "@/api/base44Client";
import { pdfProgressLabel, uploadPdfDocument, deletePdfDocument } from "@/api/pdfDocuments";
import PdfFileChip from "@/components/pdf/PdfFileChip";

// Max height the input grows to before it starts scrolling internally (px).
const MAX_INPUT_HEIGHT = 200;

// Check if the entire text (or the segment around cursor) is italic (*...*) 
function isInItalicContext(text) {
  // Check if current typed word/phrase is wrapped in stars
  const starMatches = text.match(/\*[^*]*$/);
  return !!starMatches;
}

export default function ChatInput({
  onSend,
  isLoading,
  disabled,
  allowEmpty = false,
  sessionId = null,
  onPdfStored,
  composeWhileBusy = false,
  restoreDraft = null,
  onRestoreDraftApplied,
  onRestoredDraftSettled,
}) {
  // A reply can still be in flight. The follow-up is held by the page
  // instead of locking the box, so typing and Send stay available.
  const blockComposer = disabled || (isLoading && !composeWhileBusy);
  const [value, setValue] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [pdfs, setPdfs] = useState([]);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [restoreNote, setRestoreNote] = useState("");
  const textareaRef = useRef(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;
  const appliedRestoreRef = useRef(null);
  const restoredDraftRef = useRef(null);
  const onRestoreDraftAppliedRef = useRef(onRestoreDraftApplied);
  onRestoreDraftAppliedRef.current = onRestoreDraftApplied;
  const onRestoredDraftSettledRef = useRef(onRestoredDraftSettled);
  onRestoredDraftSettledRef.current = onRestoredDraftSettled;
  const pdfsRef = useRef(pdfs);
  pdfsRef.current = pdfs;

  const settleRestoredDraft = () => {
    const draft = restoredDraftRef.current;
    if (!draft) return;
    restoredDraftRef.current = null;
    onRestoredDraftSettledRef.current?.(draft);
  };

  const settleIfComposerEmpty = (text, nextAttachments, nextPdfs) => {
    if (!restoredDraftRef.current) return;
    const attachmentsLeft = Array.isArray(nextAttachments) ? nextAttachments.length : 0;
    const pdfsLeft = Array.isArray(nextPdfs) ? nextPdfs.length : 0;
    if (String(text || "").trim() || attachmentsLeft || pdfsLeft) return;
    settleRestoredDraft();
  };

  // A reload puts a held follow-up back in this box. It is not sent.
  // Text already in the box is kept; the saved line is appended when it
  // is not already there. The saved copy stays until this box sends or
  // is cleared.
  useEffect(() => {
    if (!restoreDraft?.token) return;
    if (appliedRestoreRef.current === restoreDraft.token) return;
    appliedRestoreRef.current = restoreDraft.token;
    restoredDraftRef.current = restoreDraft;
    const merged = mergeDraftIntoComposer(
      { text: valueRef.current, attachments: attachmentsRef.current },
      restoreDraft,
    );
    if (merged.placedText) setValue(merged.text);
    if (merged.placedAttachment) setAttachments(merged.attachments);
    if (merged.note) setRestoreNote(merged.note);
    onRestoreDraftAppliedRef.current?.(restoreDraft);
    const nextText = merged.placedText ? merged.text : valueRef.current;
    const nextAttachments = merged.placedAttachment ? merged.attachments : attachmentsRef.current;
    settleIfComposerEmpty(nextText, nextAttachments, pdfsRef.current);
  }, [restoreDraft]);

  // Grow the textarea to fit its content (up to MAX_INPUT_HEIGHT, then it
  // scrolls internally). Runs on every value change — including the reset to ""
  // after sending — so the box shrinks back down once a message is sent.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_INPUT_HEIGHT)}px`;
  }, [value]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (blockComposer) return;
    const readyPdfs = pdfs.filter((pdf) => pdf.status === "ready");
    if (!value.trim() && !attachments.length && !readyPdfs.length && !allowEmpty) return;
    if (pdfBusy) return;
    
    // Create message with attachments if present
    const message = {
      text: value.trim(),
      attachments: [
        ...attachments,
        ...readyPdfs.map((pdf) => ({
          type: "pdf",
          id: pdf.id,
          name: pdf.name,
          page_count: pdf.pageCount,
        })),
      ].filter(Boolean),
    };
    if (!message.attachments.length) message.attachments = undefined;
    
    onSend(message);
    setValue("");
    setAttachments([]);
    setPdfs([]);
    setRestoreNote("");
    settleRestoredDraft();
  };

  const handlePdfUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length || !sessionId) return;
    const file = files[0];
    const localId = `${Date.now()}_${file.name}`;
    setPdfBusy(true);
    setPdfs((prev) => [
      ...prev,
      { localId, name: file.name, status: "reading", progress: { phase: "reading_file", ratio: 0 } },
    ]);
    try {
      const stored = await uploadPdfDocument({
        file,
        scope: "chat",
        sessionId,
        onProgress: (progress) => {
          setPdfs((prev) =>
            prev.map((pdf) => (pdf.localId === localId ? { ...pdf, progress, status: "reading" } : pdf)),
          );
        },
      });
      setPdfs((prev) =>
        prev.map((pdf) =>
          pdf.localId === localId
            ? {
                ...pdf,
                status: "ready",
                id: stored.id,
                name: stored.filename || file.name,
                pageCount: stored.pageCount,
                progress: null,
              }
            : pdf,
        ),
      );
      onPdfStored?.();
    } catch (err) {
      const message = err?.message || "Couldn't read that PDF.";
      toast.error(message);
      setPdfs((prev) => prev.filter((pdf) => pdf.localId !== localId));
    } finally {
      setPdfBusy(false);
    }
  };

  const removePdf = async (pdf) => {
    setPdfs((prev) => {
      const next = prev.filter((item) => item.localId !== pdf.localId);
      settleIfComposerEmpty(valueRef.current, attachmentsRef.current, next);
      return next;
    });
    if (pdf.id) {
      try {
        await deletePdfDocument(pdf.id);
        onPdfStored?.();
      } catch (err) {
        toast.error(err?.message || "Couldn't remove that PDF.");
      }
    }
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
    // In-flow composer. Parent Chat column is already sized to the visual
    // viewport (`--app-height`); iOS keyboard avoidance lives in
    // visualViewportInsets.js — do not add 100vh, keyboard padding, or extra
    // safe-area-inset-bottom here.
    <div
      data-testid="chat-input"
      className="border-t border-primary/20 bg-black/60 backdrop-blur-md p-3 sm:p-4 space-y-2"
    >
      {isLoading && (
        <div className="flex items-center gap-2 mb-2 text-primary/50">
          <Zap className="w-2.5 h-2.5 animate-pulse" />
          <span className="font-mono text-[9px] tracking-[0.3em] uppercase animate-pulse">
            Processing...
          </span>
        </div>
      )}

      {/* Attachments preview */}
      {pdfs.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {pdfs.map((pdf) => (
            <PdfFileChip
              key={pdf.localId}
              name={pdf.name}
              pageCount={pdf.pageCount}
              statusLabel={pdf.status === "ready" ? null : pdfProgressLabel(pdf.progress)}
              onRemove={() => removePdf(pdf)}
            />
          ))}
        </div>
      )}

      {restoreNote ? (
        <p
          data-testid="held-draft-restored"
          role="status"
          className="font-mono text-[10px] leading-snug text-primary/60"
        >
          {restoreNote}
        </p>
      ) : null}

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
                type="button"
                onClick={() => {
                  setAttachments((prev) => {
                    const next = prev.filter((_, i) => i !== idx);
                    settleIfComposerEmpty(valueRef.current, next, pdfsRef.current);
                    return next;
                  });
                }}
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
        <label
          className="flex-shrink-0 w-11 sm:w-12 h-11 sm:h-12 btn-sacred text-primary disabled:opacity-30 flex items-center justify-center hud-corner cursor-pointer"
          title={sessionId ? "Attach a PDF" : "Open a conversation before attaching a PDF"}
        >
          <input
            data-testid="chat-pdf-upload"
            type="file"
            accept=".pdf,application/pdf"
            onChange={handlePdfUpload}
            disabled={pdfBusy || blockComposer || !sessionId}
            className="hidden"
            aria-label="Attach a PDF"
          />
          {pdfBusy ? (
            <Loader className="w-3.5 sm:w-4 h-3.5 sm:h-4 animate-spin" />
          ) : (
            <FileText className="w-3.5 sm:w-4 h-3.5 sm:h-4" />
          )}
        </label>
        <label className="flex-shrink-0 w-10 sm:w-12 h-10 sm:h-12 btn-sacred text-primary disabled:opacity-30 flex items-center justify-center hud-corner cursor-pointer">
          <input
            type="file"
            multiple
            accept="image/*,audio/*"
            onChange={handleMediaUpload}
            disabled={uploadingMedia || blockComposer}
            className="hidden"
            aria-label="Attach an image or audio clip"
          />
          {uploadingMedia ? (
            <Loader className="w-3.5 sm:w-4 h-3.5 sm:h-4 animate-spin" />
          ) : (
            <Paperclip className="w-3.5 sm:w-4 h-3.5 sm:h-4" />
          )}
        </label>

        <div className="flex-1 min-w-0">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => {
              const next = e.target.value;
              setValue(next);
              settleIfComposerEmpty(next, attachmentsRef.current, pdfsRef.current);
            }}
            onKeyDown={handleKeyDown}
            placeholder={allowEmpty ? "Message... (or send empty to continue story)" : "Ask me anything (I'm an AI and can make mistakes)..."}
            disabled={blockComposer}
            rows={1}
            className="w-full input-sacred text-primary/90 placeholder-primary/20 font-mono text-base sm:text-sm px-3 sm:px-4 py-2 sm:py-3 resize-none focus:outline-none transition-all hud-corner overflow-y-auto"
            style={{ minHeight: "40px", maxHeight: `${MAX_INPUT_HEIGHT}px`, fontSize: "16px", fontStyle: isInItalicContext(value) ? "italic" : "normal" }}
          />
        </div>
        <button
          type="submit"
          disabled={((!value.trim() && !attachments.length && !pdfs.some((pdf) => pdf.status === "ready") && !allowEmpty) || blockComposer || uploadingMedia || pdfBusy)}
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