/**
 *   GET  /api/vessel/:characterId            current vessel (or null)
 *   PUT  /api/vessel/:characterId            { name, config, change_note?, snapshot_path? } → new version
 *   POST /api/vessel/:characterId/snapshot   { dataUrl } → stored render (photo reference)
 *   GET  /api/vessel/:characterId/snapshot   302 → signed URL of the latest snapshot
 *   POST /api/vessel/:characterId/model/sign     { byteSize, filename|ext } → signed upload URL
 *   POST /api/vessel/:characterId/model/complete { path } → inspect + new vessel version
 *   GET  /api/vessel/:characterId/model      302 → signed download of the current model
 *        ?as=json                            200 { url, expiresIn } instead of the 302
 */
import { Router, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import { rateLimit } from "../lib/rateLimit";
import {
  configWithModel,
  currentVessel,
  requireOwnedCharacter,
  saveVessel,
  vesselModelPublicUrl,
} from "../lib/vessel/vesselStore";
import { signedUrlFor, storePhotoBytes } from "../lib/photo/photoStorage";
import { httpStatusForUploadError, parseImagePayload } from "../lib/imageUploads";
import {
  GLB_CHUNK_HEADER_BYTES,
  GLB_HEADER_BYTES,
  MODEL_MAX_BYTES,
  ModelInspectError,
  extFromFilename,
  extractModelMetadata,
  locateGlbJsonChunk,
  modelKindFor,
  parseGlbJsonChunk,
  type ModelExt,
} from "../lib/vessel/modelInspect";
import {
  MODEL_BUCKET,
  assertOwnedModelPath,
  createSignedUploadUrl,
  deleteObject,
  getObjectMetadata,
  hasModelStorage,
  MODEL_SIGNED_DOWNLOAD_TTL_S,
  readObjectRange,
  signedDownloadUrl,
} from "../lib/vessel/modelStorage";

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
  res.status(e?.status && e.status < 600 ? e.status : 500).json({ error: e?.message || "Vessel request failed.", code: e?.code });
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

function parseDeclaredExt(body: Record<string, unknown>): ModelExt | null {
  const fromName = extFromFilename(body.filename) || extFromFilename(body.ext);
  if (fromName) return fromName;
  if (typeof body.ext === "string") return extFromFilename(`.${body.ext.replace(/^\./, "")}`);
  return null;
}

router.post("/:characterId/model/sign", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const characterId = String(req.params.characterId);
  const b = (req.body || {}) as Record<string, unknown>;
  try {
    if (!hasModelStorage()) {
      res.status(503).json({ error: "Model storage is not configured.", code: "model_storage_unconfigured" });
      return;
    }
    await requireOwnedCharacter(userId, characterId);
    const byteSize = typeof b.byteSize === "number" ? b.byteSize : Number(b.byteSize);
    if (!Number.isFinite(byteSize) || byteSize <= 0) {
      res.status(400).json({ error: "byteSize is required.", code: "invalid_model_size" });
      return;
    }
    if (byteSize > MODEL_MAX_BYTES) {
      res.status(413).json({ error: `Model is too large (max ${MODEL_MAX_BYTES} bytes).`, code: "model_too_large" });
      return;
    }
    const ext = parseDeclaredExt(b);
    if (!ext) {
      const raw = typeof b.filename === "string" ? b.filename : typeof b.ext === "string" ? b.ext : "";
      const reason = /\.gltf$/i.test(raw)
        ? "Multi-file .gltf is not supported; upload a single .vrm or .glb file."
        : "Only .vrm and .glb uploads are accepted.";
      res.status(400).json({ error: reason, code: "invalid_model_ext" });
      return;
    }
    const signed = await createSignedUploadUrl({ userId, characterId, ext });
    res.status(201).json(signed);
  } catch (err) {
    fail(res, err);
  }
});

async function inspectUploadedModel(path: string, ext: ModelExt, declaredSize?: number) {
  const meta = await getObjectMetadata(path);
  if (!meta || !meta.byteSize) {
    throw Object.assign(new Error("Uploaded model was not found in storage."), { status: 404, code: "model_not_found" });
  }
  if (meta.byteSize > MODEL_MAX_BYTES || (declaredSize && declaredSize > MODEL_MAX_BYTES)) {
    throw Object.assign(new Error(`Model is too large (max ${MODEL_MAX_BYTES} bytes).`), { status: 413, code: "model_too_large" });
  }
  const prefixLen = GLB_HEADER_BYTES + GLB_CHUNK_HEADER_BYTES;
  const prefix = await readObjectRange(path, 0, prefixLen - 1);
  const loc = locateGlbJsonChunk(prefix);
  if (loc.totalLength !== meta.byteSize && loc.totalLength > 0 && meta.byteSize < loc.jsonChunkStart) {
    // Prefer the storage size for the record; header mismatch is still invalid if we can't read the JSON.
  }
  const jsonEnd = loc.jsonChunkStart + loc.jsonChunkLength - 1;
  const jsonBytes = await readObjectRange(path, loc.jsonChunkStart, jsonEnd);
  if (jsonBytes.byteLength < loc.jsonChunkLength) {
    throw new ModelInspectError("Could not read the full glTF JSON chunk.");
  }
  const gltf = parseGlbJsonChunk(jsonBytes);
  return extractModelMetadata(gltf, {
    byteSize: meta.byteSize,
    ext,
    requireVrm: ext === "vrm",
  });
}

router.post("/:characterId/model/complete", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const characterId = String(req.params.characterId);
  const b = (req.body || {}) as Record<string, unknown>;
  let ownedPath: string | null = null;
  try {
    if (!hasModelStorage()) {
      res.status(503).json({ error: "Model storage is not configured.", code: "model_storage_unconfigured" });
      return;
    }
    const owned = await requireOwnedCharacter(userId, characterId);
    const checked = assertOwnedModelPath(String(b.path || ""), userId, characterId);
    ownedPath = checked.path;
    const metadata = await inspectUploadedModel(checked.path, checked.ext);
    const current = await currentVessel(userId, characterId);
    const model = {
      kind: modelKindFor(metadata),
      url: vesselModelPublicUrl(characterId),
      bucket: MODEL_BUCKET(),
      path: checked.path,
      format: metadata.format,
      byteSize: metadata.byteSize,
      expressions: metadata.expressions,
      visemes: metadata.visemes,
      humanoid: metadata.humanoid,
      animationCount: metadata.animationCount,
    };
    const result = await saveVessel({
      userId,
      characterId,
      name: owned.name,
      config: configWithModel(current?.config, characterId, model),
      changeNote: `uploaded ${metadata.format} model`,
      snapshotBucket: current?.snapshot_bucket ?? null,
      snapshotPath: current?.snapshot_path ?? null,
    });
    res.status(201).json({ ...result, model });
  } catch (err) {
    const e = err as { status?: number; code?: string };
    const inspectFailed =
      err instanceof ModelInspectError || e?.code === "model_too_large" || e?.status === 413;
    // Only remove the object when the bytes themselves are invalid. A later
    // database error should leave the upload in place so complete can be retried.
    if (ownedPath && inspectFailed) {
      await deleteObject(ownedPath).catch(() => false);
    }
    if (err instanceof ModelInspectError) {
      res.status(err.status).json({ error: err.message, code: err.code });
      return;
    }
    fail(res, err);
  }
});

async function ownedModelStoragePath(userId: string, characterId: string): Promise<string> {
  await requireOwnedCharacter(userId, characterId);
  const v = await currentVessel(userId, characterId);
  const model = (v?.config?.model && typeof v.config.model === "object" ? v.config.model : {}) as Record<string, unknown>;
  const path = typeof model.path === "string" ? model.path : "";
  if (!path) {
    throw Object.assign(new Error("No model"), { status: 404, code: "model_not_found" });
  }
  // Sign only a path that still belongs to this user and character.
  return assertOwnedModelPath(path, userId, characterId).path;
}

router.get("/:characterId/model", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const characterId = String(req.params.characterId);
  const asJson = String(req.query.as || "") === "json";
  try {
    const path = await ownedModelStoragePath(userId, characterId);
    const url = await signedDownloadUrl(path);
    if (asJson) {
      res.setHeader("Cache-Control", "no-store");
      res.status(200).json({ url, expiresIn: MODEL_SIGNED_DOWNLOAD_TTL_S });
      return;
    }
    res.setHeader("Cache-Control", "private, no-store");
    res.redirect(302, url);
  } catch (err) {
    fail(res, err);
  }
});

export default router;
