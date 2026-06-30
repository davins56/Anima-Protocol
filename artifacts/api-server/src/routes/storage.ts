import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import { getAuth } from "@clerk/express";
import { rateLimit } from "../lib/rateLimit";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

// Limit the presigned-URL endpoint
router.use("/storage/uploads/request-url", rateLimit);

// POST /storage/uploads/request-url
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
    const objectFile = await objectStorageService.getObjectEntityFile(objectPath);
    const response = await objectStorageService.downloadObject(objectFile);
    pipeDownload(res, response);
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Object not found" });
      return;
    }
    console.error("Error serving object:", error);   // ← Fixed
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
      res.status(500).json({ error: "Failed to serve public object" });
    }
  },
);

export default router;