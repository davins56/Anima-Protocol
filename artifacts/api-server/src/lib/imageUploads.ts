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
