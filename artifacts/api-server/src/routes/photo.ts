/**
 * Lifelike companion photo generator.
 *
 *   GET    /api/photo/identity/:characterId       locked visual identity
 *   PUT    /api/photo/identity/:characterId       update references / descriptor / lock
 *   POST   /api/photo/identity/:characterId/references   { dataUrl } → stored reference
 *   POST   /api/photo/generate                    SSE stream of PhotoEvent
 *   GET    /api/photo/images?characterId=&sessionId=     gallery
 *   GET    /api/photo/images/:id/file             302 → short-lived signed URL
 */
import { Router, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import { rateLimit } from "../lib/rateLimit";
import { generatePhoto, type GenerateRequest, type PhotoEvent } from "../lib/photo/generatePhoto";
import {
  getGeneration,
  getIdentity,
  isMissingPhotoSchema,
  listGenerations,
  upsertIdentity,
  type ReferenceImage,
} from "../lib/photo/photoStore";
import { signedUrlFor, storePhotoBytes } from "../lib/photo/photoStorage";
import { parseImagePayload } from "../lib/imageUploads";

const router = Router();
router.use("/photo", rateLimit);

function requireUser(req: Request, res: Response): string | null {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return userId;
}

function sendError(res: Response, err: unknown): void {
  if (isMissingPhotoSchema(err)) {
    res.status(503).json({ error: "Photo tables are not migrated yet.", code: "photo_schema_missing" });
    return;
  }
  const e = err as { status?: number; message?: string; code?: string };
  res.status(e?.status && e.status >= 400 && e.status < 600 ? e.status : 500).json({
    error: e?.message || "Photo request failed.",
    code: e?.code || "server_error",
  });
}

function requestOrigin(req: Request): string {
  const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol || "https";
  return `${proto.split(",")[0]}://${req.get("host")}`;
}

router.get("/photo/identity/:characterId", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  try {
    res.json({ identity: await getIdentity(userId, String(req.params.characterId)) });
  } catch (err) {
    sendError(res, err);
  }
});

router.put("/photo/identity/:characterId", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const body = (req.body || {}) as Record<string, unknown>;
  try {
    const identity = await upsertIdentity(userId, String(req.params.characterId), {
      character_name: typeof body.character_name === "string" ? body.character_name.slice(0, 120) : undefined,
      locked: typeof body.locked === "boolean" ? body.locked : undefined,
      reference_images: Array.isArray(body.reference_images)
        ? (body.reference_images as ReferenceImage[]).slice(0, 12)
        : undefined,
      descriptor: body.descriptor && typeof body.descriptor === "object" ? (body.descriptor as Record<string, unknown>) : undefined,
      negative_traits: typeof body.negative_traits === "string" ? body.negative_traits.slice(0, 600) : undefined,
      provider_config:
        body.provider_config && typeof body.provider_config === "object"
          ? (body.provider_config as Record<string, unknown>)
          : undefined,
    });
    res.json({ identity });
  } catch (err) {
    sendError(res, err);
  }
});

router.post("/photo/identity/:characterId/references", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  try {
    const characterId = String(req.params.characterId);
    const parsed = parseImagePayload(req.body || {});
    const stored = await storePhotoBytes({
      userId,
      characterId,
      kind: "references",
      bytes: new Uint8Array(Buffer.from(parsed.dataBase64, "base64")),
      contentType: parsed.contentType,
    });
    const ref: ReferenceImage = {
      url: stored.bucket ? await signedUrlFor(stored.bucket, stored.path) : `/api/storage${stored.path}`,
      storage_bucket: stored.bucket,
      storage_path: stored.path,
      kind: (["face", "half", "full"].includes(String(req.body?.kind)) ? req.body.kind : "face") as ReferenceImage["kind"],
      is_primary: Boolean(req.body?.is_primary),
      added_at: new Date().toISOString(),
    };
    res.status(201).json({ reference: ref });
  } catch (err) {
    sendError(res, err);
  }
});

router.post("/photo/generate", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const body = (req.body || {}) as Record<string, any>;
  const characterId = typeof body.characterId === "string" ? body.characterId.trim() : "";
  if (!characterId) {
    res.status(400).json({ error: "characterId is required", code: "invalid_request" });
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  if (typeof res.flushHeaders === "function") res.flushHeaders();
  const controller = new AbortController();
  req.on("close", () => controller.abort());
  const emit = (e: PhotoEvent) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(e)}\n\n`);
  };
  const keepAlive = setInterval(() => !res.writableEnded && res.write(`: ping\n\n`), 15_000);

  const request: GenerateRequest = {
    userId,
    characterId,
    characterName: typeof body.characterName === "string" ? body.characterName.slice(0, 120) : undefined,
    sessionId: typeof body.sessionId === "string" ? body.sessionId : null,
    messageId: typeof body.messageId === "string" ? body.messageId : null,
    prompt: typeof body.prompt === "string" ? body.prompt.slice(0, 1200) : "",
    scene: body.scene && typeof body.scene === "object" ? body.scene : {},
    refinement: body.refinement && typeof body.refinement === "object" ? body.refinement : undefined,
    imageSize: typeof body.imageSize === "string" ? (body.imageSize as GenerateRequest["imageSize"]) : undefined,
    extraReferenceUrl: typeof body.extraReferenceUrl === "string" ? body.extraReferenceUrl : undefined,
    useVesselReference: body.useVesselReference === true,
    extraDescriptor: Array.isArray(body.extraDescriptor) ? body.extraDescriptor.map(String).slice(0, 24) : undefined,
    origin: requestOrigin(req),
    cookie: req.headers.cookie,
    signal: controller.signal,
  };

  try {
    await generatePhoto(request, emit);
  } catch (err) {
    const e = err as { message?: string; code?: string };
    emit({
      type: "error",
      error: isMissingPhotoSchema(err) ? "Photo tables are not migrated yet." : e?.message || "Image generation failed.",
      code: isMissingPhotoSchema(err) ? "photo_schema_missing" : e?.code,
    });
  } finally {
    clearInterval(keepAlive);
    res.end();
  }
});

router.get("/photo/images", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  try {
    const rows = await listGenerations(userId, {
      characterId: typeof req.query.characterId === "string" ? req.query.characterId : undefined,
      sessionId: typeof req.query.sessionId === "string" ? req.query.sessionId : undefined,
      limit: Number(req.query.limit) || 24,
    });
    res.json({
      images: rows.map((r) => ({
        id: r.id,
        character_id: r.character_id,
        session_id: r.session_id,
        message_id: r.message_id,
        parent_image_id: r.parent_image_id,
        refinement: r.refinement,
        user_prompt: r.user_prompt,
        scene: r.scene,
        width: r.width,
        height: r.height,
        created_at: r.created_at,
        url: `/api/photo/images/${r.id}/file`,
      })),
    });
  } catch (err) {
    sendError(res, err);
  }
});

// Capability URL (unguessable uuid), like /api/storage/objects/uploads/:id —
// <img> tags cannot send the bearer token. A signed-in mismatch still 404s.
router.get("/photo/images/:id/file", async (req, res) => {
  const id = String(req.params.id || "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    res.status(404).end();
    return;
  }
  try {
    const { userId } = getAuth(req);
    const row = await getGeneration(null, id);
    if (!row || row.status !== "completed" || !row.storage_path || (userId && row.user_id !== userId)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const url = await signedUrlFor(row.storage_bucket, row.storage_path, "");
    res.setHeader("Cache-Control", "private, max-age=300");
    res.redirect(302, url);
  } catch (err) {
    sendError(res, err);
  }
});

export default router;
