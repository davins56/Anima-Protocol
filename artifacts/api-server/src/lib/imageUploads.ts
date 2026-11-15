/**
 * Postgres-backed image uploads for environments without the Replit
 * object-storage sidecar (notably Vercel production).
 *
 * Objects are addressed as `/objects/uploads/{uuid}` and served by
 * GET /api/storage/objects/uploads/:id.
 */

import { randomUUID } from "crypto";
import {
  ensureSchemaOnce,
  getPool,
  withTransientDbRetry,
} from "@workspace/db";

export const UPLOADS_PATH_PREFIX = "/objects/uploads/";
/** Hyperdrive + postgres.js drops large parameterized INSERTs; keep JPEGs small. */
export const MAX_UPLOAD_BYTES = 1 * 1024 * 1024;
export const MAX_UPLOAD_ERROR = "Image is too large (max 1 MB after compression)";
export const IMAGE_TYPE_ERROR = "Use a JPEG, PNG, WebP, or HEIC photo.";
export const IMAGE_MAGIC_ERROR =
  "That file doesn't look like a JPEG, PNG, WebP, or HEIC photo.";

const HEIC_BRANDS = new Set([
  "heic",
  "heix",
  "hevc",
  "hevx",
  "heim",
  "heis",
  "heif",
  "mif1",
  "msf1",
]);

/** jpeg/png/webp/heic only. image/jpg is stored as image/jpeg. */
export function canonicalImageType(contentType: string): string | null {
  const type = contentType.toLowerCase().split(";")[0].trim();
  if (type === "image/jpg" || type === "image/pjpeg" || type === "image/jpeg") {
    return "image/jpeg";
  }
  if (type === "image/png" || type === "image/webp") return type;
  if (type === "image/heic" || type === "image/heic-sequence") return "image/heic";
  if (type === "image/heif" || type === "image/heif-sequence") return "image/heif";
  return null;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

export function imageBytesMatchType(contentType: string, bytes: Uint8Array): boolean {
  if (contentType === "image/png") {
    return (
      bytes.length >= PNG_SIGNATURE.length &&
      PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)
    );
  }
  if (contentType === "image/jpeg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (contentType === "image/webp") {
    if (bytes.length < 12) return false;
    const head = Buffer.from(bytes.subarray(0, 12)).toString("ascii");
    return head.startsWith("RIFF") && head.slice(8, 12) === "WEBP";
  }
  if (contentType === "image/heic" || contentType === "image/heif") {
    if (bytes.length < 12) return false;
    const brandBox = Buffer.from(bytes.subarray(4, 12)).toString("ascii");
    if (!brandBox.startsWith("ftyp")) return false;
    return HEIC_BRANDS.has(brandBox.slice(4, 8).toLowerCase());
  }
  return false;
}

export type StoredImage = {
  id: string;
  userId: string;
  contentType: string;
  dataBase64: string;
  byteSize: number;
};

/** True when the path is a DB-backed upload object. */
export function isDbUploadObjectPath(objectPath: string): boolean {
  return objectPath.startsWith(UPLOADS_PATH_PREFIX);
}

export function objectPathForUploadId(id: string): string {
  return `${UPLOADS_PATH_PREFIX}${id}`;
}

export function uploadIdFromObjectPath(objectPath: string): string | null {
  if (!isDbUploadObjectPath(objectPath)) return null;
  const id = objectPath.slice(UPLOADS_PATH_PREFIX.length).split("/")[0];
  return id || null;
}

/**
 * Normalize a data URL or raw base64 string into { contentType, dataBase64 }.
 */
export function parseImagePayload(
  input: {
    contentType?: unknown;
    dataBase64?: unknown;
    dataUrl?: unknown;
  },
): { contentType: string; dataBase64: string; byteSize: number } {
  const dataUrl =
    typeof input.dataUrl === "string" ? input.dataUrl.trim() : "";
  if (dataUrl.startsWith("data:")) {
    const match = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl);
    if (!match) {
      throw new Error("Invalid data URL. Expected data:<type>;base64,...");
    }
    return finishImagePayload(match[1], match[2].replace(/\s+/g, ""));
  }

  return finishImagePayload(
    String(input.contentType || ""),
    String(input.dataBase64 || "").replace(/\s+/g, "").trim(),
  );
}

function finishImagePayload(
  rawType: string,
  dataBase64: string,
): { contentType: string; dataBase64: string; byteSize: number } {
  const declared = rawType.trim().toLowerCase();
  if (!declared.startsWith("image/")) {
    throw new Error("Only image uploads are supported");
  }
  if (!dataBase64) throw new Error("Missing image data");
  const contentType = canonicalImageType(declared);
  if (!contentType) throw new Error(IMAGE_TYPE_ERROR);
  // Reject on the encoded length first so an oversized body is not decoded
  // into a second buffer before the 1 MB cap.
  const maxBase64Chars = Math.ceil(MAX_UPLOAD_BYTES / 3) * 4;
  if (dataBase64.length > maxBase64Chars) throw new Error(MAX_UPLOAD_ERROR);
  const bytes = Buffer.from(dataBase64, "base64");
  const byteSize = bytes.byteLength;
  if (byteSize <= 0) throw new Error("Empty image payload");
  if (byteSize > MAX_UPLOAD_BYTES) throw new Error(MAX_UPLOAD_ERROR);
  if (!imageBytesMatchType(contentType, bytes)) throw new Error(IMAGE_MAGIC_ERROR);
  return { contentType, dataBase64, byteSize };
}

/** Map storeUploadedImage / parse failures onto HTTP status codes. */
export function httpStatusForUploadError(error: unknown): number {
  const message = error instanceof Error ? error.message : String(error || "");
  if (/too large/i.test(message)) return 413;
  if (
    message.includes("Only image") ||
    message.includes("Invalid") ||
    message.includes("Missing") ||
    message.includes("Empty") ||
    message.includes("JPEG") ||
    message.includes("doesn't look") ||
    message.includes("does not look")
  ) {
    return 400;
  }
  return 500;
}

function isMissingRelationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || "");
  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code || "")
      : "";
  return code === "42P01" || /relation .*uploaded_images.* does not exist/i.test(message);
}

async function insertUploadedImageRow(row: {
  id: string;
  userId: string;
  contentType: string;
  dataBase64: string;
  byteSize: number;
}): Promise<void> {
  // Same getPool().query path as /api/healthz/db. Drizzle + a large TEXT bind
  // through postgres.js/Hyperdrive is what surfaces as 503 "Database unavailable"
  // while SELECT 1 still succeeds.
  await getPool().query(
    `INSERT INTO uploaded_images (id, user_id, content_type, data_base64, byte_size)
     VALUES ($1, $2, $3, $4, $5)`,
    [row.id, row.userId, row.contentType, row.dataBase64, row.byteSize],
  );
}

/** Insert one row, creating the table on a fresh database. */
async function insertRowEnsuringSchema(row: {
  id: string;
  userId: string;
  contentType: string;
  dataBase64: string;
  byteSize: number;
}): Promise<void> {
  await withTransientDbRetry(async () => {
    try {
      await insertUploadedImageRow(row);
    } catch (err) {
      if (!isMissingRelationError(err)) throw err;
      await ensureSchemaOnce();
      await insertUploadedImageRow(row);
    }
  });
}

type UploadedImageRow = {
  id: string;
  user_id: string;
  content_type: string;
  data_base64: string;
  byte_size: number;
};

async function selectUploadedImageRow(id: string): Promise<UploadedImageRow | null> {
  const result = await getPool().query<UploadedImageRow>(
    `SELECT id, user_id, content_type, data_base64, byte_size
     FROM uploaded_images WHERE id = $1 LIMIT 1`,
    [id],
  );
  return result.rows[0] ?? null;
}

/*
 * Server-generated images (companion chat photos, photo-generator results)
 * are not browser uploads: the high-res chat photos (1024×1536 since #720)
 * are often 0.8–1.5 MB, over the 1 MB single-row cap that keeps each
 * Hyperdrive INSERT small. Those are stored as several part rows of at most
 * GENERATED_PART_BYTES each plus one manifest row under the public id, in the
 * same table (no schema change). The public URL and the GET route stay the
 * same; getUploadedImage reassembles the parts. Browser uploads keep the
 * 1 MB cap.
 */
export const MAX_GENERATED_BYTES = 8 * 1024 * 1024;
export const MAX_GENERATED_ERROR = "Generated image is too large (max 8 MB)";
/** A multiple of 3, so the parts' base64 strings concatenate without padding. */
export const GENERATED_PART_BYTES = 3 * 174_762; // 524,286 bytes (~683 KB as base64)
export const IMAGE_PART_CONTENT_TYPE = "application/x-anima-image-part";
const IMAGE_MANIFEST_CONTENT_TYPE = "application/x-anima-image-manifest";

type ImageManifest = { v: 1; type: string; size: number; parts: string[] };

function isManifestType(contentType: string): boolean {
  return contentType.split(";")[0].trim().toLowerCase() === IMAGE_MANIFEST_CONTENT_TYPE;
}

function isPartType(contentType: string): boolean {
  return contentType.split(";")[0].trim().toLowerCase() === IMAGE_PART_CONTENT_TYPE;
}

function parseManifest(dataBase64: string): ImageManifest | null {
  try {
    const raw = JSON.parse(Buffer.from(dataBase64, "base64").toString("utf8")) as Partial<ImageManifest>;
    if (
      raw?.v !== 1 ||
      typeof raw.type !== "string" ||
      !canonicalImageType(raw.type) ||
      !Array.isArray(raw.parts) ||
      raw.parts.length === 0 ||
      raw.parts.length > Math.ceil(MAX_GENERATED_BYTES / GENERATED_PART_BYTES) ||
      !raw.parts.every((p) => typeof p === "string" && p.length > 0)
    ) {
      return null;
    }
    return { v: 1, type: raw.type, size: Number(raw.size) || 0, parts: raw.parts };
  } catch {
    return null;
  }
}

/** Split into GENERATED_PART_BYTES pieces (exported for tests). */
export function splitImageBytes(bytes: Uint8Array, partBytes = GENERATED_PART_BYTES): Uint8Array[] {
  const parts: Uint8Array[] = [];
  for (let at = 0; at < bytes.byteLength; at += partBytes) {
    parts.push(bytes.subarray(at, Math.min(at + partBytes, bytes.byteLength)));
  }
  return parts;
}

export async function storeUploadedImage(
  userId: string,
  payload: { contentType?: unknown; dataBase64?: unknown; dataUrl?: unknown },
): Promise<{ id: string; objectPath: string; contentType: string; byteSize: number }> {
  const parsed = parseImagePayload(payload);
  const id = randomUUID();
  await insertRowEnsuringSchema({
    id,
    userId,
    contentType: parsed.contentType,
    dataBase64: parsed.dataBase64,
    byteSize: parsed.byteSize,
  });
  return {
    id,
    objectPath: objectPathForUploadId(id),
    contentType: parsed.contentType,
    byteSize: parsed.byteSize,
  };
}

/**
 * Store an image the server produced (companion photo, photo generator).
 * Up to 1 MB: one row, exactly like an upload. Larger (up to 8 MB): part rows
 * plus a manifest row, served from the same /api/storage/objects/uploads/:id.
 */
export async function storeGeneratedImage(
  userId: string,
  payload: { contentType?: unknown; dataBase64?: unknown },
): Promise<{ id: string; objectPath: string; contentType: string; byteSize: number }> {
  const dataBase64 = String(payload.dataBase64 || "").replace(/\s+/g, "");
  const contentType = canonicalImageType(String(payload.contentType || ""));
  if (!contentType) throw new Error(IMAGE_TYPE_ERROR);
  if (!dataBase64) throw new Error("Missing image data");
  if (dataBase64.length <= Math.ceil(MAX_UPLOAD_BYTES / 3) * 4) {
    // Small enough for the normal single-row path (same checks as uploads).
    const bytes = Buffer.from(dataBase64, "base64");
    if (bytes.byteLength <= MAX_UPLOAD_BYTES) {
      return storeUploadedImage(userId, { contentType, dataBase64 });
    }
  }
  if (dataBase64.length > Math.ceil(MAX_GENERATED_BYTES / 3) * 4) throw new Error(MAX_GENERATED_ERROR);
  const bytes = new Uint8Array(Buffer.from(dataBase64, "base64"));
  if (bytes.byteLength <= 0) throw new Error("Empty image payload");
  if (bytes.byteLength > MAX_GENERATED_BYTES) throw new Error(MAX_GENERATED_ERROR);
  if (!imageBytesMatchType(contentType, bytes)) throw new Error(IMAGE_MAGIC_ERROR);

  const id = randomUUID();
  const partIds: string[] = [];
  try {
    for (const part of splitImageBytes(bytes)) {
      const partId = randomUUID();
      await insertRowEnsuringSchema({
        id: partId,
        userId,
        contentType: IMAGE_PART_CONTENT_TYPE,
        dataBase64: Buffer.from(part).toString("base64"),
        byteSize: part.byteLength,
      });
      partIds.push(partId);
    }
    const manifest: ImageManifest = { v: 1, type: contentType, size: bytes.byteLength, parts: partIds };
    // The manifest goes in last, so its id never resolves to a partial image.
    await insertRowEnsuringSchema({
      id,
      userId,
      contentType: IMAGE_MANIFEST_CONTENT_TYPE,
      dataBase64: Buffer.from(JSON.stringify(manifest), "utf8").toString("base64"),
      byteSize: bytes.byteLength,
    });
  } catch (err) {
    await deletePartRows(userId, partIds).catch(() => undefined);
    throw err;
  }
  return { id, objectPath: objectPathForUploadId(id), contentType, byteSize: bytes.byteLength };
}

async function deletePartRows(userId: string, ids: string[]): Promise<void> {
  if (!ids.length) return;
  const placeholders = ids.map((_, i) => `$${i + 2}`).join(", ");
  await getPool().query(
    `DELETE FROM uploaded_images WHERE user_id = $1 AND content_type = '${IMAGE_PART_CONTENT_TYPE}' AND id IN (${placeholders})`,
    [userId, ...ids],
  );
}

async function assembleManifest(row: UploadedImageRow): Promise<StoredImage | null> {
  const manifest = parseManifest(row.data_base64);
  if (!manifest) return null;
  const placeholders = manifest.parts.map((_, i) => `$${i + 2}`).join(", ");
  const result = await getPool().query<{ id: string; data_base64: string }>(
    `SELECT id, data_base64 FROM uploaded_images
      WHERE user_id = $1 AND content_type = '${IMAGE_PART_CONTENT_TYPE}' AND id IN (${placeholders})`,
    [row.user_id, ...manifest.parts],
  );
  const byId = new Map(result.rows.map((r) => [r.id, r.data_base64]));
  const pieces: string[] = [];
  for (const partId of manifest.parts) {
    const piece = byId.get(partId);
    if (!piece) return null;
    pieces.push(piece);
  }
  return {
    id: row.id,
    userId: row.user_id,
    contentType: canonicalImageType(manifest.type) || manifest.type,
    dataBase64: pieces.join(""),
    byteSize: manifest.size || Number(row.byte_size) || 0,
  };
}

async function readStoredImage(id: string): Promise<StoredImage | null> {
  const row = await selectUploadedImageRow(id);
  if (!row) return null;
  // Part rows are internal; only the manifest id is a public URL.
  if (isPartType(row.content_type)) return null;
  if (isManifestType(row.content_type)) return assembleManifest(row);
  return {
    id: row.id,
    userId: row.user_id,
    contentType: row.content_type,
    dataBase64: row.data_base64,
    byteSize: Number(row.byte_size) || 0,
  };
}

export const AUDIO_TYPES = new Set(["audio/mpeg", "audio/wav"]);

/** MP3 (ID3 tag or MPEG frame sync) or WAV (RIFF…WAVE). */
export function audioBytesMatchType(contentType: string, bytes: Uint8Array): boolean {
  if (contentType === "audio/mpeg") {
    const id3 = bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33;
    const sync = bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;
    return id3 || sync;
  }
  if (contentType === "audio/wav") {
    return (
      String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" &&
      String.fromCharCode(...bytes.subarray(8, 12)) === "WAVE"
    );
  }
  return false;
}

/**
 * Server-produced audio (an Anima's voice note) in the same blob table as
 * uploads, served by the same GET /api/storage/objects/uploads/:id route with
 * its own content type. Not reachable from the browser upload endpoint, which
 * stays image-only.
 */
export async function storeUploadedAudio(
  userId: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<{ id: string; objectPath: string; contentType: string; byteSize: number }> {
  const type = contentType.split(";")[0].trim().toLowerCase();
  if (!AUDIO_TYPES.has(type)) throw new Error("Only MP3 or WAV audio is supported");
  if (bytes.byteLength <= 0) throw new Error("Empty audio payload");
  if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new Error("Audio is too large (max 1 MB)");
  if (!audioBytesMatchType(type, bytes)) throw new Error("That file doesn't look like MP3 or WAV audio.");
  const id = randomUUID();
  const row = {
    id,
    userId,
    contentType: type,
    dataBase64: Buffer.from(bytes).toString("base64"),
    byteSize: bytes.byteLength,
  };
  await insertRowEnsuringSchema(row);
  return { id, objectPath: objectPathForUploadId(id), contentType: type, byteSize: bytes.byteLength };
}

/** Owner-only. False when the row is missing or belongs to someone else. */
export async function deleteUploadedImage(userId: string, id: string): Promise<boolean> {
  const owner = String(userId || "").trim();
  const imageId = String(id || "").trim();
  if (!owner || !imageId) return false;
  const result = await getPool().query<{ id: string; content_type: string; data_base64: string }>(
    `DELETE FROM uploaded_images WHERE id = $1 AND user_id = $2 AND content_type <> '${IMAGE_PART_CONTENT_TYPE}'
     RETURNING id, content_type, data_base64`,
    [imageId, owner],
  );
  const removed = result.rows[0];
  if (!removed) return false;
  if (isManifestType(String(removed.content_type || ""))) {
    const manifest = parseManifest(String(removed.data_base64 || ""));
    if (manifest) await deletePartRows(owner, manifest.parts).catch(() => undefined);
  }
  return true;
}

export async function getUploadedImage(
  objectPath: string,
): Promise<StoredImage | null> {
  const id = uploadIdFromObjectPath(objectPath);
  if (!id) return null;
  return withTransientDbRetry(async () => {
    try {
      return await readStoredImage(id);
    } catch (err) {
      if (!isMissingRelationError(err)) throw err;
      await ensureSchemaOnce();
      return readStoredImage(id);
    }
  });
}
