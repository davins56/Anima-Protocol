import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { deletePdfDocument, listPdfDocuments } from "@/api/pdfDocuments";
import PdfFileChip from "./PdfFileChip";

/**
 * PDFs already shared in this conversation. Deleting one removes its stored
 * text so later replies stop using it. The composer can still attach a new file.
 */
export default function ChatPdfBar({ sessionId, revision = 0 }) {
  const [files, setFiles] = useState([]);
  const [confirmId, setConfirmId] = useState(null);

  const load = useCallback(async () => {
    if (!sessionId) {
      setFiles([]);
      return;
    }
    try {
      const rows = await listPdfDocuments({ scope: "chat", sessionId });
      setFiles(rows);
    } catch {
      setFiles([]);
    }
  }, [sessionId]);

  useEffect(() => {
    load();
  }, [load, revision]);

  if (!files.length) return null;

  return (
    <div className="px-3 sm:px-4 pb-1 space-y-1.5" data-testid="chat-pdf-bar">
      <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-primary/40">
        PDFs in this chat
      </p>
      {files.map((file) => (
        <div key={file.id} className="space-y-1">
          <PdfFileChip name={file.filename} pageCount={file.pageCount} />
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
            <button
              type="button"
              className="min-h-11 px-3 border border-primary/20 text-primary/55 font-mono text-[11px] tracking-widest uppercase"
              onClick={() => setConfirmId(file.id)}
            >
              Remove
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
