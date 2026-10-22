import express, { Router, type IRouter, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import { classifyDbError } from "../lib/dbErrors";
import { isPdfUploadError } from "../lib/pdf/errors";
import { createRateLimit } from "../lib/rateLimit";
import { sanitizePdfFilename } from "../lib/pdf/context";
import { PDF_MAX_BYTES_DEFAULT } from "../lib/pdf/limits";
import {
  advancePdfDocument,
  createPdfDocument,
  deletePdfDocument,
  getPdfDocument,
  listPdfDocuments,
  readPdfFile,
  renamePdfDocument,
  retryPdfDocument,
  type PdfBackground,
} from "../lib/pdf/store";
import { scheduleWorkerBackground } from "../lib/workerBackground";

const router: IRouter = Router();
const uploadLimit = createRateLimit({ name: "pdf-upload", max: 20 });
const fileLimit = createRateLimit({ name: "pdf-file", max: 60 });
const statusLimit = createRateLimit({ name: "pdf-status", max: 240 });

/**
 * Raw binary upload body. A little over the 20 MB cap so the store can answer
 * with its own friendly 413 instead of the parser's. JSON bodies still go
 * through the app-level express.json parser.
 */
const rawPdfBody = express.raw({
  type: ["application/pdf", "application/x-pdf", "application/acrobat", "application/octet-stream"],
  limit: PDF_MAX_BYTES_DEFAULT + 1024 * 1024,
});

/** Keep pipeline work alive after the response (Worker ctx.waitUntil; Node just runs it). */
function backgroundFor(req: Request): PdfBackground {
  return (promise) => {
    const guarded = promise.catch((err) => console.warn("PDF background step failed:", err));
    scheduleWorkerBackground(guarded, req.header("x-anima-bg"));
  };
}

function firstString(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

function requireUser(req: Request, res: Response): string | null {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return userId;
}

function sendPdfError(res: Response, error: unknown): void {
  if (isPdfUploadError(error)) {
    res.status(error.status).json({ error: error.message, code: error.code });
    return;
  }
  const dbInfo = classifyDbError(error);
  if (dbInfo.isDbError) {
    console.error("PDF store error:", error);
    res.status(503).json({
      error: dbInfo.safeMessage,
      reason: dbInfo.reason,
      code: dbInfo.code ?? "database_unavailable",
    });
    return;
  }
  console.error("PDF request failed:", error);
  res.status(500).json({ error: "Could not finish that PDF request." });
}

/**
 * POST /api/pdfs
 *
 * Preferred: raw bytes, `Content-Type: application/pdf`, metadata in the query:
 *   /api/pdfs?scope=chat&session_id=…  |  ?scope=lore&character_id=…  (&filename=…)
 *   Up to 20 MB (ANIMA_PDF_MAX_BYTES lowers it).
 * Legacy: JSON { filename, dataBase64, scope, session_id?, character_id? }, up to 4 MB.
 *
 * Validates MIME + %PDF- magic + size, stores the original, extracts and chunks
 * inline (so a bad file is reported right away), then embeds in the background.
 * 201 with the document; poll GET /api/pdfs/:id until status is ready | failed.
 */
router.post("/pdfs", uploadLimit, rawPdfBody, async (req: Request, res: Response) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const isRaw = Buffer.isBuffer(req.body);
  const contentType = String(req.header("content-type") || "").toLowerCase();
  if (!isRaw && contentType && !contentType.includes("application/json")) {
    res.status(415).json({ error: "That file isn't a PDF. Choose a .pdf file.", code: "pdf_not_pdf" });
    return;
  }
  const body = (isRaw ? {} : req.body ?? {}) as {
    filename?: unknown;
    dataBase64?: unknown;
    dataUrl?: unknown;
    scope?: unknown;
    session_id?: unknown;
    character_id?: unknown;
  };
  const query = req.query as Record<string, unknown>;
  const pick = (key: "filename" | "scope" | "session_id" | "character_id") =>
    body[key] ?? firstString(query[key]);
  try {
    const doc = await createPdfDocument({
      userId,
      scope: pick("scope"),
      sessionId: pick("session_id"),
      characterId: pick("character_id"),
      filename: pick("filename") ?? req.header("x-filename"),
      ...(isRaw
        ? { bytes: new Uint8Array(req.body as Buffer), contentType: req.header("content-type") }
        : { dataBase64: body.dataBase64 || body.dataUrl }),
      background: backgroundFor(req),
    });
    res.status(201).json({ file: doc });
  } catch (error) {
    sendPdfError(res, error);
  }
});

/** GET /api/pdfs?scope=chat&session_id= | scope=lore&character_id= */
router.get("/pdfs", async (req: Request, res: Response) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  try {
    const files = await listPdfDocuments({
      userId,
      scope: req.query.scope,
      sessionId: req.query.session_id,
      characterId: req.query.character_id,
    });
    res.json({ files });
  } catch (error) {
    sendPdfError(res, error);
  }
});

/**
 * GET /api/pdfs/:id — one document with pipeline status (owner only).
 * A poll also nudges a stalled document forward (resume embedding, reclaim
 * an abandoned run) without waiting for the hourly cron.
 */
router.get("/pdfs/:id", statusLimit, async (req: Request, res: Response) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  try {
    const file = await getPdfDocument({ userId, documentId: req.params.id });
    if (!file) {
      res.status(404).json({ error: "That file wasn't found.", code: "pdf_not_found" });
      return;
    }
    advancePdfDocument(file, userId, backgroundFor(req));
    res.setHeader("Cache-Control", "private, no-store");
    res.json({ file });
  } catch (error) {
    sendPdfError(res, error);
  }
});

/** POST /api/pdfs/:id/retry — re-run a failed document from its stored original. */
router.post("/pdfs/:id/retry", uploadLimit, async (req: Request, res: Response) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  try {
    const file = await retryPdfDocument({
      userId,
      documentId: req.params.id,
      background: backgroundFor(req),
    });
    if (!file) {
      res.status(404).json({ error: "That file wasn't found.", code: "pdf_not_found" });
      return;
    }
    res.json({ file });
  } catch (error) {
    sendPdfError(res, error);
  }
});

/** GET /api/pdfs/:id/file — original PDF for the owner. Auth required. */
router.get("/pdfs/:id/file", fileLimit, async (req: Request, res: Response) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  try {
    const file = await readPdfFile(userId, req.params.id);
    if (!file) {
      res.status(404).json({
        error: "That file wasn't found.",
        code: "pdf_not_found",
      });
      return;
    }
    if (!file.bytes || file.bytes.byteLength === 0) {
      res.status(404).json({
        error: "The original file isn't stored for this PDF.",
        code: "pdf_file_missing",
      });
      return;
    }
    const filename = sanitizePdfFilename(file.filename).replace(/["\r\n]/g, "");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", String(file.bytes.byteLength));
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, no-store");
    res.status(200);
    res.end(file.bytes);
  } catch (error) {
    sendPdfError(res, error);
  }
});

router.patch("/pdfs/:id", async (req: Request, res: Response) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const filename = (req.body ?? {}).filename;
  try {
    const file = await renamePdfDocument({
      userId,
      documentId: req.params.id,
      filename,
    });
    if (!file) {
      res.status(404).json({
        error: "That file wasn't found.",
        code: "pdf_not_found",
      });
      return;
    }
    res.json({ file });
  } catch (error) {
    sendPdfError(res, error);
  }
});

router.delete("/pdfs/:id", async (req: Request, res: Response) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  try {
    const removed = await deletePdfDocument({
      userId,
      documentId: req.params.id,
    });
    if (!removed) {
      res.status(404).json({
        error: "That file wasn't found.",
        code: "pdf_not_found",
      });
      return;
    }
    res.status(204).send();
  } catch (error) {
    sendPdfError(res, error);
  }
});

export default router;
