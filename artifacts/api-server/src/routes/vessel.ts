/**
 *   GET  /api/vessel/:characterId            current vessel (or null)
 *   PUT  /api/vessel/:characterId            { name, config, change_note?, snapshot_path? } → new version
 *   POST /api/vessel/:characterId/snapshot   { dataUrl } → stored render (photo reference)
 *   GET  /api/vessel/:characterId/snapshot   302 → signed URL of the latest snapshot
 */
import { Router, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import { rateLimit } from "../lib/rateLimit";
import { currentVessel, saveVessel } from "../lib/vessel/vesselStore";
import { signedUrlFor, storePhotoBytes } from "../lib/photo/photoStorage";
import { httpStatusForUploadError, parseImagePayload } from "../lib/imageUploads";

const router = Router();
router.use(rateLimit);

function requireUser(req: Request, res: Response): string | null {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return userId;
}

function fail(res: Response, err: unknown) {
  const e = err as { status?: number; code?: string; message?: string };
  if (e?.code === "42P01" || e?.code === "42883") {
    res.status(503).json({ error: "Vessel tables are not migrated yet.", code: "vessel_schema_missing" });
    return;
  }
  res.status(e?.status && e.status < 600 ? e.status : 500).json({ error: e?.message || "Vessel request failed." });
}

router.get("/:characterId", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  try {
    res.setHeader("Cache-Control", "private, max-age=30");
    res.json({ vessel: await currentVessel(userId, String(req.params.characterId)) });
  } catch (err) {
    fail(res, err);
  }
});

router.put("/:characterId", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const b = (req.body || {}) as Record<string, any>;
  try {
    const result = await saveVessel({
      userId,
      characterId: String(req.params.characterId),
      name: typeof b.name === "string" ? b.name.slice(0, 120) : "",
      config: b.config,
      changeNote: typeof b.change_note === "string" ? b.change_note : "",
      snapshotBucket: typeof b.snapshot_bucket === "string" ? b.snapshot_bucket : null,
      snapshotPath: typeof b.snapshot_path === "string" ? b.snapshot_path : null,
    });
    res.status(201).json(result);
  } catch (err) {
    fail(res, err);
  }
});

router.post("/:characterId/snapshot", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  try {
    let parsed: ReturnType<typeof parseImagePayload>;
    try {
      parsed = parseImagePayload(req.body || {});
    } catch (err) {
      res.status(httpStatusForUploadError(err)).json({ error: (err as Error).message });
      return;
    }
    const stored = await storePhotoBytes({
      userId,
      characterId: String(req.params.characterId),
      kind: "vessel",
      bytes: new Uint8Array(Buffer.from(parsed.dataBase64, "base64")),
      contentType: parsed.contentType,
    });
    res.status(201).json({
      snapshot_bucket: stored.bucket,
      snapshot_path: stored.path,
      url: stored.bucket ? await signedUrlFor(stored.bucket, stored.path) : `/api/storage${stored.path}`,
    });
  } catch (err) {
    fail(res, err);
  }
});

router.get("/:characterId/snapshot", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  try {
    const v = await currentVessel(userId, String(req.params.characterId));
    if (!v?.snapshot_path) {
      res.status(404).json({ error: "No snapshot" });
      return;
    }
    res.redirect(302, await signedUrlFor(v.snapshot_bucket, v.snapshot_path, ""));
  } catch (err) {
    fail(res, err);
  }
});

export default router;
