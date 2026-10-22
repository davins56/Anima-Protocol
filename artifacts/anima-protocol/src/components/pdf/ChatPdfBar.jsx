import { useState } from "react";
import { toast } from "sonner";
import { deletePdfDocument, openPdfDocument } from "@/api/pdfDocuments";
import { pdfStatusLabel } from "@/api/pdfPipeline";
import { usePdfDocuments } from "@/hooks/usePdfDocuments";
import PdfFileChip from "./PdfFileChip";

/**
 * PDFs already shared in this conversation. Deleting one removes its stored
 * text so later replies stop using it. The composer can still attach a new file.
 * Each chip shows the upload pipeline status until the file is ready.
 */
export default function ChatPdfBar({ sessionId, revision = 0 }) {
  const { files, reload: load, retry } = usePdfDocuments({ scope: "chat", sessionId, revision });
  const [confirmId, setConfirmId] = useState(null);

  if (!files.length) return null;

  return (
    <div className="px-3 sm:px-4 pb-1 space-y-1.5" data-testid="chat-pdf-bar">
      <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-primary/40">
        PDFs in this chat
      </p>
      {files.map((file) => (
        <div key={file.id} className="space-y-1">
          <PdfFileChip
            name={file.filename}
            pageCount={file.pageCount}
            statusLabel={pdfStatusLabel(file)}
            onOpen={
              file.hasFile
                ? () =>
                    openPdfDocument(file.id).catch((err) => {
                      toast.error(err?.message || "Could not open that PDF.");
                    })
                : undefined
            }
          />
          {confirmId === file.id ? (
            <div className="flex gap-2">
              <button
                type="button"
                className="min-h-11 px-3 border border-red-400/40 text-red-300 font-mono text-[11px] tracking-widest uppercase"
                onClick={async () => {
                  try {
                    await deletePdfDocument(file.id);
                    setConfirmId(null);
                    await load();
                  } catch (err) {
                    toast.error(err?.message || "Couldn't remove that PDF.");
                  }
                }}
              >
                Remove from chat
              </button>
              <button
                type="button"
                className="min-h-11 px-3 border border-primary/20 text-primary/50 font-mono text-[11px] tracking-widest uppercase"
                onClick={() => setConfirmId(null)}
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              {file.status === "failed" ? (
                <button
                  type="button"
                  className="min-h-11 px-3 border border-primary/40 text-primary font-mono text-[11px] tracking-widest uppercase"
                  onClick={() =>
                    retry(file.id).catch((err) => toast.error(err?.message || "Couldn't retry that PDF."))
                  }
                >
                  Retry
                </button>
              ) : null}
              <button
                type="button"
                className="min-h-11 px-3 border border-primary/20 text-primary/55 font-mono text-[11px] tracking-widest uppercase"
                onClick={() => setConfirmId(file.id)}
              >
                Remove
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
