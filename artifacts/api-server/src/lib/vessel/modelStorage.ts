/**
 * Supabase Storage access for private `character-models` objects.
 *
 * The Worker never accepts the model body. Clients upload with a short-lived
 * signed URL; the API only range-reads the GLB JSON header and signs downloads.
 */
import { randomUUID } from "crypto";
import { normalizeApiKey } from "../openaiClient";
import { MODEL_MAX_BYTES, type ModelExt } from "./modelInspect";

export const MODEL_BUCKET = () => process.env.SUPABASE_MODEL_BUCKET?.trim() || "character-models";
const SIGNED_UPLOAD_TTL_S = 10 * 60;
export const MODEL_SIGNED_DOWNLOAD_TTL_S = 60 * 60;

function supabaseUrl(): string | null {
  const raw = process.env.SUPABASE_URL?.trim();
  return raw ? raw.replace(/\/$/, "") : null;
}

function serviceKey(): string | null {
  return normalizeApiKey(process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export function hasModelStorage(): boolean {
  return Boolean(supabaseUrl() && serviceKey());
}

function authHeaders(): Record<string, string> {
  const key = serviceKey()!;
  return { Authorization: `Bearer ${key}`, apikey: key };
}

export function safeStorageSegment(v: string): string {
  return String(v).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80) || "x";
}

export function modelObjectPath(userId: string, characterId: string, ext: ModelExt, id = randomUUID()): string {
  return `${safeStorageSegment(userId)}/${safeStorageSegment(characterId)}/${id}.${ext}`;
}

/** Path must stay inside the caller's user + character prefix. */
export function assertOwnedModelPath(path: string, userId: string, characterId: string): { ext: ModelExt; path: string } {
  const expected = `${safeStorageSegment(userId)}/${safeStorageSegment(characterId)}/`;
  const normalized = String(path || "").replace(/^\/+/, "");
  if (normalized.includes("..") || normalized.includes("//") || normalized.includes("\\")) {
    throw Object.assign(new Error("Invalid model path."), { status: 400, code: "invalid_model_path" });
  }
  if (!normalized.startsWith(expected)) {
    throw Object.assign(new Error("Model path is outside this companion's folder."), { status: 403, code: "model_path_forbidden" });
  }
  const rest = normalized.slice(expected.length);
  const m = rest.match(/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(vrm|glb)$/i);
  if (!m) {
    throw Object.assign(new Error("Model path is not a signed object for this companion."), { status: 400, code: "invalid_model_path" });
  }
  return { path: normalized, ext: m[2].toLowerCase() as ModelExt };
}

function requireStorage(): { base: string; bucket: string } {
  const base = supabaseUrl();
  if (!base || !serviceKey()) {
    throw Object.assign(new Error("Model storage is not configured."), { status: 503, code: "model_storage_unconfigured" });
  }
  return { base, bucket: MODEL_BUCKET() };
}

async function storageError(res: Response, fallback: string, status = 502): Promise<never> {
  const text = await res.text().catch(() => "");
  throw Object.assign(new Error(`${fallback} (${res.status}): ${text.slice(0, 200)}`), {
    status,
    code: "storage_error",
  });
}

export type SignedUpload = {
  bucket: string;
  path: string;
  uploadUrl: string;
  token: string;
  expiresIn: number;
  maxBytes: number;
  contentType: string;
};

export function contentTypeForExt(ext: ModelExt): string {
  return ext === "vrm" ? "model/vrm" : "model/gltf-binary";
}

export async function createSignedUploadUrl(args: {
  userId: string;
  characterId: string;
  ext: ModelExt;
}): Promise<SignedUpload> {
  const { base, bucket } = requireStorage();
  const path = modelObjectPath(args.userId, args.characterId, args.ext);
  const res = await fetch(`${base}/storage/v1/object/upload/sign/${bucket}/${path}`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn: SIGNED_UPLOAD_TTL_S }),
  });
  if (!res.ok) await storageError(res, "Could not create a signed model upload URL");
  const body = (await res.json()) as { url?: string; signedUrl?: string; signedURL?: string; token?: string };
  const rel = body.url || body.signedUrl || body.signedURL || "";
  const uploadUrl = rel.startsWith("http") ? rel : `${base}/storage/v1${rel.startsWith("/") ? rel : `/${rel}`}`;
  if (!rel) {
    throw Object.assign(new Error("Storage did not return a signed upload URL."), { status: 502, code: "storage_error" });
  }
  return {
    bucket,
    path,
    uploadUrl,
    token: body.token || "",
    expiresIn: SIGNED_UPLOAD_TTL_S,
    maxBytes: MODEL_MAX_BYTES,
    contentType: contentTypeForExt(args.ext),
  };
}

export type ObjectMetadata = {
  byteSize: number;
  etag: string | null;
};

export async function getObjectMetadata(path: string): Promise<ObjectMetadata | null> {
  const { base, bucket } = requireStorage();
  const res = await fetch(`${base}/storage/v1/object/info/${bucket}/${path}`, {
    method: "GET",
    headers: authHeaders(),
  });
  if (res.status === 404) return null;
  // Some Storage versions only implement HEAD /object/{bucket}/{path}.
  if (!res.ok) {
    const head = await fetch(`${base}/storage/v1/object/${bucket}/${path}`, {
      method: "HEAD",
      headers: authHeaders(),
    });
    if (head.status === 404) return null;
    if (!head.ok) await storageError(head, "Could not read model metadata");
    const len = head.headers.get("content-length") || head.headers.get("Content-Length");
    return {
      byteSize: len ? Number(len) : 0,
      etag: head.headers.get("etag") || head.headers.get("ETag"),
    };
  }
  const body = (await res.json()) as { contentLength?: number; metadata?: { size?: number }; size?: number; eTag?: string; etag?: string };
  const byteSize = Number(body.contentLength ?? body.size ?? body.metadata?.size ?? 0);
  return { byteSize, etag: body.eTag || body.etag || null };
}

/** Inclusive byte range, same semantics as HTTP Range. */
export async function readObjectRange(path: string, start: number, end: number): Promise<Uint8Array> {
  const { base, bucket } = requireStorage();
  if (end < start || start < 0) throw Object.assign(new Error("Invalid byte range."), { status: 500, code: "storage_error" });
  const res = await fetch(`${base}/storage/v1/object/${bucket}/${path}`, {
    method: "GET",
    headers: { ...authHeaders(), Range: `bytes=${start}-${end}` },
  });
  if (!res.ok) await storageError(res, "Could not read model bytes");
  return new Uint8Array(await res.arrayBuffer());
}

export async function deleteObject(path: string): Promise<boolean> {
  const { base, bucket } = requireStorage();
  const res = await fetch(`${base}/storage/v1/object/${bucket}/${path}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  return res.ok || res.status === 404;
}

export async function signedDownloadUrl(path: string): Promise<string> {
  const { base, bucket } = requireStorage();
  const res = await fetch(`${base}/storage/v1/object/sign/${bucket}/${path}`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn: MODEL_SIGNED_DOWNLOAD_TTL_S }),
  });
  if (!res.ok) await storageError(res, "Could not sign model download URL");
  const body = (await res.json()) as { signedURL?: string; signedUrl?: string };
  const rel = body.signedURL || body.signedUrl || "";
  if (!rel) {
    throw Object.assign(new Error("Storage did not return a signed download URL."), { status: 502, code: "storage_error" });
  }
  return rel.startsWith("http") ? rel : `${base}/storage/v1${rel.startsWith("/") ? rel : `/${rel}`}`;
}
