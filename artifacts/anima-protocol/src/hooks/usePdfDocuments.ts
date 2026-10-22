/**
 * PDFs for one chat or one companion, with live pipeline status.
 * Lists once per (scope, owner, revision); while any file is still being
 * processed it polls GET /api/pdfs/:id for those files only (which also nudges
 * a stalled pipeline on the server) and stops when everything is ready/failed
 * or after POLL_MAX_MS.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { listPdfDocuments } from "@/api/pdfDocuments";
import { getPdfDocument, isPdfActive, retryPdfDocument } from "@/api/pdfPipeline";

export type PdfDocument = {
  id: string;
  filename: string;
  pageCount?: number;
  hasFile?: boolean;
  status?: "uploaded" | "extracting" | "chunking" | "embedding" | "ready" | "failed";
  error?: string | null;
  errorCode?: string | null;
  chunkCount?: number;
  embeddedChunkCount?: number;
  vectorsPending?: boolean;
};

const POLL_MS = 3000;
const POLL_MAX_MS = 3 * 60 * 1000;

export function usePdfDocuments(args: {
  scope: "chat" | "lore";
  sessionId?: string | null;
  characterId?: string | null;
  revision?: unknown;
}) {
  const { scope, sessionId, characterId, revision } = args;
  const ownerId = scope === "chat" ? sessionId : characterId;
  const [files, setFiles] = useState<PdfDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const pollStarted = useRef(0);

  const reload = useCallback(async () => {
    if (!ownerId) {
      setFiles([]);
      return;
    }
    setLoading(true);
    try {
      const rows = (await listPdfDocuments({
        scope,
        sessionId: scope === "chat" ? ownerId : undefined,
        characterId: scope === "lore" ? ownerId : undefined,
      })) as PdfDocument[];
      setFiles(rows || []);
      setError("");
      pollStarted.current = Date.now();
    } catch (err) {
      setError((err as Error)?.message || "Couldn't load PDFs.");
    } finally {
      setLoading(false);
    }
  }, [scope, ownerId]);

  useEffect(() => {
    reload();
  }, [reload, revision]);

  const activeIds = files.filter(isPdfActive).map((file) => file.id).join(",");
  useEffect(() => {
    if (!activeIds) return;
    let alive = true;
    const timer = window.setTimeout(async () => {
      if (Date.now() - pollStarted.current > POLL_MAX_MS) return;
      const ids = activeIds.split(",");
      const updates = await Promise.all(ids.map((id) => getPdfDocument(id).catch(() => null)));
      if (!alive) return;
      setFiles((prev) =>
        prev.map((file) => updates.find((next) => next && next.id === file.id) || file),
      );
    }, POLL_MS);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [activeIds, files]);

  const retry = useCallback(async (id: string) => {
    const next = (await retryPdfDocument(id)) as PdfDocument | null;
    pollStarted.current = Date.now();
    if (next) setFiles((prev) => prev.map((file) => (file.id === id ? next : file)));
    return next;
  }, []);

  return { files, loading, error, reload, retry };
}
