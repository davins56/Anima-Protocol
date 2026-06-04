import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import { getAuth } from "@clerk/express";
import { rateLimit } from "../lib/rateLimit";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

// Limit the presigned-URL endpoint (the only abusable write path here). Scoped
// to its own path so it never drains the shared IP budget for other /api routes.
router.use("/storage/uploads/request-url", rateLimit);

// POST /storage/uploads/request-url
// Returns a presigned PUT URL plus the canonical object path to store. The
// client uploads the file bytes DIRECTLY to the presigned URL (not here) and
// then persists objectPath. Requires a signed-in user to prevent anonymous
// abuse of the upload pipeline.
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
      req.log.error({ err: error }, "Error generating upload URL");
      res.status(500).json({ error: "Failed to generate upload URL" });
    }
  },
);

// Stream a fetch Response (from GCS) back through Express.
function pipeDownload(
  res: Response,
  response: Awaited<ReturnType<ObjectStorageService["downloadObject"]>>,
) {
  res.status(response.status);
  response.headers.forEach((value, key) => res.setHeader(key, value));
  if (response.body) {
    const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
    nodeStream.pipe(res);
  } else {
    res.end();
  }
}

// GET /storage/objects/*path
// Serves user-uploaded object entities. Avatars are referenced from plain <img>
// tags (which cannot send auth headers), so these are served publicly — there
// is no sensitive content here, only character portraits the user chose.
router.get("/storage/objects/*path", async (req: Request, res: Response) => {
  try {
    const raw = (req.params as Record<string, string | string[]>).path;
    const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
    const objectPath = `/objects/${wildcardPath}`;
    const objectFile = await objectStorageService.getObjectEntityFile(objectPath);
    const response = await objectStorageService.downloadObject(objectFile);
    pipeDownload(res, response);
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Object not found" });
      return;
    }
    req.log.error({ err: error }, "Error serving object");
    res.status(500).json({ error: "Failed to serve object" });
  }
});

// GET /storage/public-objects/*filePath
// Serves app/website assets from PUBLIC_OBJECT_SEARCH_PATHS (uploaded via the
// Object Storage tool pane). Unconditionally public.
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
      req.log.error({ err: error }, "Error serving public object");
      res.status(500).json({ error: "Failed to serve public object" });
    }
  },
);

export default router;
