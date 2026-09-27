import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, Loader } from "lucide-react";
import { toast } from "sonner";
import {
  deletePdfDocument,
  listPdfDocuments,
  pdfProgressLabel,
  renamePdfDocument,
  uploadPdfDocument,
} from "@/api/pdfDocuments";
import PdfFileChip from "./PdfFileChip";

/**
 * Lore PDFs for one companion. Shown on the edit form and the bio sheet.
 * Upload, rename, and delete stay on this account — the list never includes
 * another user's files.
 */
export default function CompanionLoreFiles({ characterId, characterName }) {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busyName, setBusyName] = useState("");
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState("");
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const inputRef = useRef(null);

  const load = useCallback(async () => {
    if (!characterId) {
      setFiles([]);
      return;
    }
    setLoading(true);
    try {
      const rows = await listPdfDocuments({ scope: "lore", characterId });
      setFiles(rows);
      setError("");
    } catch (err) {
      setError(err?.message || "Couldn't load lore files.");
    } finally {
      setLoading(false);
    }
  }, [characterId]);

  useEffect(() => {
    load();
  }, [load]);

  const onPick = async (event) => {
    const picked = Array.from(event.target.files || []);
    event.target.value = "";
    if (!picked.length || !characterId) return;
    setError("");
    for (const file of picked) {
      setBusyName(file.name);
      setProgress({ phase: "reading_file", ratio: 0 });
      try {
        await uploadPdfDocument({
          file,
          scope: "lore",
          characterId,
          onProgress: setProgress,
        });
        await load();
      } catch (err) {
        const message = err?.message || "Couldn't add that PDF.";
        setError(message);
        toast.error(message);
      } finally {
        setBusyName("");
        setProgress(null);
      }
    }
  };

  const saveRename = async (file) => {
    const next = renameValue.trim();
    if (!next) return;
    try {
      await renamePdfDocument(file.id, next);
      setRenamingId(null);
      await load();
    } catch (err) {
      toast.error(err?.message || "Couldn't rename that file.");
    }
  };

  const remove = async (file) => {
    try {
      await deletePdfDocument(file.id);
      setConfirmDeleteId(null);
      await load();
    } catch (err) {
      toast.error(err?.message || "Couldn't delete that file.");
    }
  };

  return (
    <section className="space-y-2" data-testid="lore-pdf-list">
      <div className="flex items-center gap-1.5">
        <FileText className="w-3 h-3 text-primary/50" aria-hidden="true" />
        <h3 className="font-mono text-[10px] tracking-[0.25em] uppercase text-primary/50">
          Lore PDFs
        </h3>
      </div>
      <p className="text-[11px] font-mono text-primary/45 leading-relaxed">
        {characterName ? `${characterName} can draw on these in every chat.` : "This companion can draw on these in every chat."}{" "}
        Backstory, world notes, character sheets, or a novel. Scanned image PDFs have no text to read.
      </p>
      {!characterId ? (
        <p className="text-[11px] font-mono text-primary/55">
          Save this companion first, then you can add lore PDFs.
        </p>
      ) : (
        <>
          {loading && files.length === 0 ? (
            <p className="text-[11px] font-mono text-primary/40">Loading lore files…</p>
          ) : null}
          {files.length === 0 && !loading && !busyName ? (
            <p className="text-[11px] font-mono text-primary/40">No lore files yet.</p>
          ) : null}
          <ul className="space-y-2">
            {files.map((file) => (
              <li key={file.id} className="space-y-1">
                <PdfFileChip
                  name={file.filename}
                  pageCount={file.pageCount}
                />
                {renamingId === file.id ? (
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      value={renameValue}
                      onChange={(event) => setRenameValue(event.target.value)}
                      aria-label={`New name for ${file.filename}`}
                      className="flex-1 min-h-11 bg-black/60 border border-primary/30 text-primary font-mono text-sm px-3"
                    />
                    <button
                      type="button"
                      onClick={() => saveRename(file)}
                      className="min-h-11 px-3 border border-primary/40 text-primary font-mono text-[11px] tracking-widest uppercase"
                    >
                      Save name
                    </button>
                    <button
                      type="button"
                      onClick={() => setRenamingId(null)}
                      className="min-h-11 px-3 border border-primary/20 text-primary/50 font-mono text-[11px] tracking-widest uppercase"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setRenamingId(file.id);
                        setRenameValue(file.filename);
                        setConfirmDeleteId(null);
                      }}
                      className="min-h-11 px-3 border border-primary/25 text-primary/70 font-mono text-[11px] tracking-widest uppercase"
                    >
                      Rename
                    </button>
                    {confirmDeleteId === file.id ? (
                      <>
                        <button
                          type="button"
                          onClick={() => remove(file)}
                          className="min-h-11 px-3 border border-red-400/40 text-red-300 font-mono text-[11px] tracking-widest uppercase"
                        >
                          Delete file
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          className="min-h-11 px-3 border border-primary/20 text-primary/50 font-mono text-[11px] tracking-widest uppercase"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmDeleteId(file.id);
                          setRenamingId(null);
                        }}
                        className="min-h-11 px-3 border border-red-900/40 text-red-300/80 font-mono text-[11px] tracking-widest uppercase"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
          {busyName ? (
            <PdfFileChip
              name={busyName}
              statusLabel={pdfProgressLabel(progress)}
            />
          ) : null}
          {error ? (
            <p className="text-[11px] font-mono text-red-300/90" role="alert">
              {error}
            </p>
          ) : null}
          <label className="flex items-center justify-center gap-2 min-h-11 w-full border border-primary/40 bg-primary/10 text-primary font-mono text-[11px] tracking-widest uppercase cursor-pointer">
            <input
              ref={inputRef}
              data-testid="lore-pdf-upload"
              type="file"
              accept=".pdf,application/pdf"
              multiple
              className="hidden"
              disabled={Boolean(busyName)}
              onChange={onPick}
            />
            {busyName ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
            {busyName ? "Reading PDF…" : "Add a lore PDF"}
          </label>
        </>
      )}
    </section>
  );
}
