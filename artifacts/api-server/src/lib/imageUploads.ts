/**
 * Postgres-backed image uploads for environments without the Replit
 * object-storage sidecar (notably Vercel production).
 *
 * Objects are addressed as `/objects/uploads/{uuid}` and served by
 * GET /api/storage/objects/uploads/:id.
 */

import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db, uploadedImages, ensureSchemaOnce } from "@workspace/db";

export const UPLOADS_PATH_PREFIX = "/objects/uploads/";
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // 4 MiB decoded
export const MAX_UPLOAD_ERROR = "Image is too large (max 4 MB after compression)";

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
    const contentType = match[1].toLowerCase();
    const dataBase64 = match[2].replace(/\s+/g, "");
    if (!contentType.startsWith("image/")) {
      throw new Error("Only image uploads are supported");
    }
    const byteSize = Buffer.byteLength(dataBase64, "base64");
    if (byteSize <= 0) throw new Error("Empty image payload");
    if (byteSize > MAX_UPLOAD_BYTES) {
      throw new Error(MAX_UPLOAD_ERROR);
    }
    return { contentType, dataBase64, byteSize };
  }

  const contentType = String(input.contentType || "")
    .trim()
    .toLowerCase();
  const dataBase64 = String(input.dataBase64 || "")
    .replace(/\s+/g, "")
    .trim();
  if (!contentType.startsWith("image/")) {
    throw new Error("Only image uploads are supported");
  }
  if (!dataBase64) throw new Error("Missing image data");
  const byteSize = Buffer.byteLength(dataBase64, "base64");
  if (byteSize <= 0) throw new Error("Empty image payload");
  if (byteSize > MAX_UPLOAD_BYTES) {
    throw new Error(MAX_UPLOAD_ERROR);
  }
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
    message.includes("Empty")
  ) {
    return 400;
  }
  return 500;
}

export async function storeUploadedImage(
  userId: string,
  payload: { contentType?: unknown; dataBase64?: unknown; dataUrl?: unknown },
): Promise<{ id: string; objectPath: string; contentType: string; byteSize: number }> {
  await ensureSchemaOnce();
  const parsed = parseImagePayload(payload);
  const id = randomUUID();
  await db.insert(uploadedImages).values({
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

export async function getUploadedImage(
  objectPath: string,
): Promise<StoredImage | null> {
  const id = uploadIdFromObjectPath(objectPath);
  if (!id) return null;
  await ensureSchemaOnce();
  const rows = await db
    .select()
    .from(uploadedImages)
    .where(eq(uploadedImages.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    userId: row.userId,
    contentType: row.contentType,
    dataBase64: row.dataBase64,
    byteSize: row.byteSize,
  };
}
