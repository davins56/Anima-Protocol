/**
 * Storage for generated + reference photos.
 *
 * Primary: Supabase Storage private bucket `character-images` via REST with the
 * service-role key (server only — never VITE_*). Clients only ever receive
 * short-lived signed URLs from GET /api/photo/images/:id/file.
 *
 * Fallback (SUPABASE_URL unset, e.g. local dev): the existing Postgres-backed
 * uploaded_images table (1 MB cap), served at /api/storage/objects/uploads/:id.
 */
import { randomUUID } from "crypto";
import { normalizeApiKey } from "../openaiClient";
import { storeUploadedImage } from "../imageUploads";

export const PHOTO_BUCKET = () => process.env.SUPABASE_PHOTO_BUCKET?.trim() || "character-images";
const SIGNED_URL_TTL_S = 60 * 60;

function supabaseUrl(): string | null {
  const raw = process.env.SUPABASE_URL?.trim();
  return raw ? raw.replace(/\/$/, "") : null;
}

function serviceKey(): string | null {
  return normalizeApiKey(process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export function hasSupabaseStorage(): boolean {
  return Boolean(supabaseUrl() && serviceKey());
}

function authHeaders(): Record<string, string> {
  const key = serviceKey()!;
  return { Authorization: `Bearer ${key}`, apikey: key };
}

function safeSegment(v: string): string {
  return String(v).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80) || "x";
}

export type StoredPhoto = {
  bucket: string | null;
  path: string;
  contentType: string;
  byteSize: number;
};

function extFor(contentType: string): string {
  if (contentType.includes("png")) return "png";
  if (contentType.includes("webp")) return "webp";
  return "jpg";
}

export async function storePhotoBytes(args: {
  userId: string;
  characterId: string;
  kind: "generated" | "references" | "vessel";
  bytes: Uint8Array;
  contentType: string;
}): Promise<StoredPhoto> {
  const contentType = args.contentType || "image/jpeg";
  if (hasSupabaseStorage()) {
    const bucket = PHOTO_BUCKET();
    const path = `${safeSegment(args.userId)}/${safeSegment(args.characterId)}/${args.kind}/${randomUUID()}.${extFor(contentType)}`;
    const res = await fetch(`${supabaseUrl()}/storage/v1/object/${bucket}/${path}`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": contentType, "x-upsert": "false", "cache-control": "31536000" },
      body: args.bytes as unknown as BodyInit,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw Object.assign(new Error(`Supabase storage upload failed (${res.status}): ${text.slice(0, 200)}`), {
        status: 502,
        code: "storage_error",
      });
    }
    return { bucket, path, contentType, byteSize: args.bytes.byteLength };
  }
  const stored = await storeUploadedImage(args.userId, {
    contentType,
    dataBase64: Buffer.from(args.bytes).toString("base64"),
  });
  return { bucket: null, path: stored.objectPath, contentType: stored.contentType, byteSize: stored.byteSize };
}

/** Download a provider result URL and persist it. */
export async function persistRemoteImage(args: {
  userId: string;
  characterId: string;
  url: string;
  kind?: "generated" | "references" | "vessel";
}): Promise<StoredPhoto> {
  const res = await fetch(args.url);
  if (!res.ok) throw Object.assign(new Error(`Could not fetch generated image (${res.status})`), { status: 502 });
  const contentType = res.headers.get("content-type")?.split(";")[0] || "image/jpeg";
  const bytes = new Uint8Array(await res.arrayBuffer());
  return storePhotoBytes({ userId: args.userId, characterId: args.characterId, kind: args.kind || "generated", bytes, contentType });
}

/** Short-lived URL a browser <img> or the provider can fetch. */
export async function signedUrlFor(bucket: string | null, path: string, origin?: string): Promise<string> {
  if (!bucket) {
    // DB-backed fallback path (`/objects/uploads/{id}`).
    return `${origin || ""}/api/storage${path}`;
  }
  const res = await fetch(`${supabaseUrl()}/storage/v1/object/sign/${bucket}/${path}`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn: SIGNED_URL_TTL_S }),
  });
  if (!res.ok) throw Object.assign(new Error(`Could not sign image URL (${res.status})`), { status: 502 });
  const body = (await res.json()) as { signedURL?: string; signedUrl?: string };
  const rel = body.signedURL || body.signedUrl || "";
  return rel.startsWith("http") ? rel : `${supabaseUrl()}/storage/v1${rel}`;
}

/** Inline a same-origin/DB image as a data URI so fal / Gemini can read it. */
export async function toProviderImageUrl(url: string, origin: string, cookie?: string): Promise<string> {
  if (/^https:\/\//i.test(url) || url.startsWith("data:")) return url;
  const abs = url.startsWith("/") ? `${origin}${url}` : url;
  const res = await fetch(abs, cookie ? { headers: { cookie } } : undefined);
  if (!res.ok) throw Object.assign(new Error(`Reference image unavailable (${res.status})`), { status: 400, code: "invalid_request" });
  const type = res.headers.get("content-type")?.split(";")[0] || "image/jpeg";
  const b64 = Buffer.from(new Uint8Array(await res.arrayBuffer())).toString("base64");
  return `data:${type};base64,${b64}`;
}
