import { Router, type IRouter, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import { classifyDbError } from "../lib/dbErrors";
import { isPdfUploadError } from "../lib/pdf/errors";
import { createRateLimit } from "../lib/rateLimit";
import {
  createPdfDocument,
  deletePdfDocument,
  listPdfDocuments,
  renamePdfDocument,
} from "../lib/pdf/store";

const router: IRouter = Router();
const uploadLimit = createRateLimit({ name: "pdf-upload", max: 20 });

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
 * Body: { filename, dataBase64, scope: "chat" | "lore", session_id?, character_id? }
 * Extracts text on the server, stores chunks, returns metadata only.
 */
router.post("/pdfs", uploadLimit, async (req: Request, res: Response) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const body = (req.body ?? {}) as {
    filename?: unknown;
    dataBase64?: unknown;
    dataUrl?: unknown;
    scope?: unknown;
    session_id?: unknown;
    character_id?: unknown;
  };
  try {
    const doc = await createPdfDocument({
      userId,
      scope: body.scope,
      sessionId: body.session_id,
      characterId: body.character_id,
      filename: body.filename,
      dataBase64: body.dataBase64 || body.dataUrl,
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
