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

async function selectUploadedImageRow(
  id: string,
): Promise<StoredImage | null> {
  const result = await getPool().query<{
    id: string;
    user_id: string;
    content_type: string;
    data_base64: string;
    byte_size: number;
  }>(
    `SELECT id, user_id, content_type, data_base64, byte_size
     FROM uploaded_images WHERE id = $1 LIMIT 1`,
    [id],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    contentType: row.content_type,
    dataBase64: row.data_base64,
    byteSize: Number(row.byte_size) || 0,
  };
}

export async function storeUploadedImage(
  userId: string,
  payload: { contentType?: unknown; dataBase64?: unknown; dataUrl?: unknown },
): Promise<{ id: string; objectPath: string; contentType: string; byteSize: number }> {
  const parsed = parseImagePayload(payload);
  const id = randomUUID();
  await withTransientDbRetry(async () => {
    try {
      await insertUploadedImageRow({
        id,
        userId,
        contentType: parsed.contentType,
        dataBase64: parsed.dataBase64,
        byteSize: parsed.byteSize,
      });
    } catch (err) {
      if (!isMissingRelationError(err)) throw err;
      await ensureSchemaOnce();
      await insertUploadedImageRow({
        id,
        userId,
        contentType: parsed.contentType,
        dataBase64: parsed.dataBase64,
        byteSize: parsed.byteSize,
      });
    }
  });
  return {
    id,
    objectPath: objectPathForUploadId(id),
    contentType: parsed.contentType,
    byteSize: parsed.byteSize,
  };
}

/** Owner-only. False when the row is missing or belongs to someone else. */
export async function deleteUploadedImage(userId: string, id: string): Promise<boolean> {
  const owner = String(userId || "").trim();
  const imageId = String(id || "").trim();
  if (!owner || !imageId) return false;
  const result = await getPool().query(
    `DELETE FROM uploaded_images WHERE id = $1 AND user_id = $2 RETURNING id`,
    [imageId, owner],
  );
  return result.rows.length > 0;
}

export async function getUploadedImage(
  objectPath: string,
): Promise<StoredImage | null> {
  const id = uploadIdFromObjectPath(objectPath);
  if (!id) return null;
  return withTransientDbRetry(async () => {
    try {
      return await selectUploadedImageRow(id);
    } catch (err) {
      if (!isMissingRelationError(err)) throw err;
      await ensureSchemaOnce();
      return selectUploadedImageRow(id);
    }
  });
}
