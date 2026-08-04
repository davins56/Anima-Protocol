import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import { getAuth } from "@clerk/express";
import { rateLimit } from "../lib/rateLimit";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import {
  getUploadedImage,
  isDbUploadObjectPath,
  storeUploadedImage,
} from "../lib/imageUploads";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

// Limit the presigned-URL endpoint
router.use("/storage/uploads/request-url", rateLimit);

// POST /storage/uploads/request-url
router.use("/storage/uploads", rateLimit);

/**
 * Direct image upload (Vercel-safe). Accepts a data URL or raw base64 and
 * stores the bytes in Postgres — no Replit object-storage sidecar required.
 *
 * POST /storage/uploads
 * body: { dataUrl } | { contentType, dataBase64 }
 * → { objectPath, uploadURL? }
 */
router.post("/storage/uploads", async (req: Request, res: Response) => {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const stored = await storeUploadedImage(userId, req.body ?? {});
    res.status(201).json({
      objectPath: stored.objectPath,
      contentType: stored.contentType,
      byteSize: stored.byteSize,
      // Same-origin path the client persists as avatar_url.
      file_url: `/api/storage${stored.objectPath}`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed";
    const status =
      message.includes("Only image") ||
      message.includes("Invalid") ||
      message.includes("Missing") ||
      message.includes("Empty") ||
      message.includes("too large")
        ? 400
        : 500;
    if (status >= 500) {
      console.error("Error storing uploaded image:", error);
    }
    res.status(status).json({ error: message });
  }
});

// Legacy Replit/GCS presigned URL flow — kept for environments that still have
// the sidecar. On Vercel this usually 500s; clients should prefer POST /uploads.
router.post(
  "/storage/uploads/request-url",
  async (req: Request, res: Response) => {
    const { userId } = getAuth(req);
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const body = (req.body ?? {}) as {
      name?: unknown;
      size?: unknown;
      contentType?: unknown;
    };
    const contentType = String(body.contentType || "");
    if (!contentType.startsWith("image/")) {
      res.status(400).json({ error: "Only image uploads are supported" });
      return;
    }

    try {
      const uploadURL = await objectStorageService.getObjectEntityUploadURL();
      const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);
      res.json({ uploadURL, objectPath });
    } catch (error) {
      console.error("Error generating upload URL:", error);   // ← Fixed
      res.status(500).json({ error: "Failed to generate upload URL" });
      console.error("Error generating upload URL:", error);
      res.status(500).json({
        error:
          "Object storage is unavailable. Use the direct /api/storage/uploads endpoint (Postgres-backed) instead.",
        code: "object_storage_unavailable",
      });
    }
  },
);

function pipeDownload(
  res: Response,
  response: Awaited<ReturnType<ObjectStorageService["downloadObject"]>>,
) {
  res.status(response.status);
  response.headers.forEach((value, key) => res.setHeader(key, value));
  if (response.body) {
    const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
    const nodeStream = Readable.fromWeb(
      response.body as ReadableStream<Uint8Array>,
    );
    nodeStream.pipe(res);
  } else {
    res.end();
  }
}

// GET /storage/objects/*path
router.get("/storage/objects/*path", async (req: Request, res: Response) => {
  try {
    const raw = (req.params as Record<string, string | string[]>).path;
    const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
    const objectPath = `/objects/${wildcardPath}`;

    // Prefer Postgres-backed uploads (Vercel path).
    if (isDbUploadObjectPath(objectPath)) {
      const image = await getUploadedImage(objectPath);
      if (!image) {
        res.status(404).json({ error: "Object not found" });
        return;
      }
      const buffer = Buffer.from(image.dataBase64, "base64");
      res.setHeader("Content-Type", image.contentType);
      res.setHeader("Content-Length", String(buffer.byteLength));
      res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
      res.status(200).end(buffer);
      return;
    }

    const objectFile = await objectStorageService.getObjectEntityFile(objectPath);
    const response = await objectStorageService.downloadObject(objectFile);
    pipeDownload(res, response);
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Object not found" });
      return;
    }
    console.error("Error serving object:", error);   // ← Fixed
    console.error("Error serving object:", error);
    res.status(500).json({ error: "Failed to serve object" });
  }
});

// GET /storage/public-objects/*filePath
router.get(
  "/storage/public-objects/*filePath",
  async (req: Request, res: Response) => {
    try {
      const raw = (req.params as Record<string, string | string[]>).filePath;
      const filePath = Array.isArray(raw) ? raw.join("/") : raw;
      const file = await objectStorageService.searchPublicObject(filePath);
      if (!file) {
        res.status(404).json({ error: "File not found" });
        return;
      }
      const response = await objectStorageService.downloadObject(file);
      pipeDownload(res, response);
    } catch (error) {
      console.error("Error serving public object:", error);   // ← Fixed
      console.error("Error serving public object:", error);
      res.status(500).json({ error: "Failed to serve public object" });
    }
  },
);

export default router;
export default router;
