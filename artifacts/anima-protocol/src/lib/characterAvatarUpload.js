/**
 * Shared helpers for the New Character / customiser image upload path.
 *
 * MEMORY.md still describes UploadFile as a stub that returns `{ url: null }`.
 * The live client posts to POST /api/storage/uploads and returns
 * `{ file_url, url }`. If that call returns null, or a /api/storage path the
 * Worker cannot serve as an image, persist a downscaled data: URL on the
 * Character / Anima so the portrait still renders in a plain <img>.
 *
 * UserContext vision reads `image_data_url` for the same reason — the server
 * cannot fetch a null file_url.
 */

import { downscaleDataUrl } from "@/lib/downscaleImage";

export function avatarUrlFromUploadResult(result) {
  if (!result || typeof result !== "object") return null;
  for (const key of ["file_url", "url"]) {
    const value = result[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export async function uploadCharacterAvatar(
  file,
  uploadFile,
) {
  if (!file) {
    throw new Error("No image selected.");
  }
  const type = String(file.type || "");
  if (type && !type.startsWith("image/") && type !== "application/octet-stream") {
    throw new Error("That file is not an image. Choose a JPEG, PNG, or WebP photo.");
  }
  const result = await uploadFile({ file });
  const url = avatarUrlFromUploadResult(result);
  if (!url) {
    throw new Error("Upload failed — no file URL returned. Try another image.");
  }
  return url;
}

/** Payload written to Character.create / Character.update. */
export function characterCreatePayload(form) {
  const avatar_url =
    typeof form?.avatar_url === "string" ? form.avatar_url.trim() : "";
  const image_data_url = isInlineDataUrl(avatar_url)
    ? avatar_url
    : typeof form?.image_data_url === "string" && form.image_data_url.startsWith("data:")
      ? form.image_data_url
      : "";
  return {
    ...form,
    name: String(form?.name || "").trim(),
    avatar_url,
    ...(image_data_url ? { image_data_url } : {}),
  };
}

export function formatAvatarUploadError(err) {
  const msg = String(err?.message || err || "");
  if (/unauthorized|sign in|not signed|401/i.test(msg)) {
    return "Sign in to upload an avatar, then try again.";
  }
  if (/too large|413/i.test(msg)) {
    return "That image is too large. Try a smaller photo.";
  }
  if (/heic|heif/i.test(msg)) {
    return "This photo format (HEIC) isn't supported here. Choose a JPEG or PNG.";
  }
  if (/not found|404/i.test(msg)) {
    return "Image upload is not available on this host. Try again after the API is reachable.";
  }
  return msg || "Avatar upload failed. Try another image.";
}

export function isInlineDataUrl(url) {
  return typeof url === "string" && url.startsWith("data:image/");
}

export function isWorkerStoragePath(url) {
  return typeof url === "string" && url.startsWith("/api/storage/");
}

/**
 * True when a plain <img> can load this URL without auth headers.
 * Storage paths are probed because a Worker assets-only deploy serves HTML 404
 * for /api/storage/objects/... even when UploadFile returned a path.
 */
export async function verifyPortraitUrl(url, fetchImpl = globalThis.fetch) {
  if (isInlineDataUrl(url)) return true;
  if (typeof url !== "string" || !url.trim()) return false;
  if (typeof fetchImpl !== "function") return false;
  try {
    const res = await fetchImpl(url.trim(), {
      method: "GET",
      credentials: "same-origin",
    });
    if (!res.ok) return false;
    const contentType = String(res.headers?.get?.("content-type") || "");
    if (contentType.includes("text/html")) return false;
    return (
      contentType.startsWith("image/") ||
      contentType.startsWith("application/octet-stream") ||
      contentType === ""
    );
  } catch {
    return false;
  }
}

async function readFileAsDataUrl(file) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  const mime = file.type || "image/jpeg";
  return `data:${mime};base64,${btoa(binary)}`;
}

/** Downscale when possible; keep the original data URL if canvas decode fails. */
export async function fileToInlineDataUrl(file, downscale = downscaleDataUrl) {
  const raw = await readFileAsDataUrl(file);
  if (typeof raw !== "string" || !raw.startsWith("data:")) {
    throw new Error("Could not read that image.");
  }
  try {
    return await downscale(raw, 1024, 0.85);
  } catch {
    return raw;
  }
}

const INLINE_STUB_WARNING =
  "Upload returned no fetchable file URL. Portrait saved on this character instead.";
const INLINE_UNSERVABLE_WARNING =
  "The upload API returned a path this host cannot serve. Portrait saved on this character instead.";

/**
 * Try object storage, then fall back to a data: URL so the customiser /
 * New Character preview and Character.create still show the portrait.
 */
export async function persistPortraitWithInlineFallback(
  file,
  uploadFile,
  { downscale = downscaleDataUrl, verifyUrl = verifyPortraitUrl } = {},
) {
  if (!file) {
    throw new Error("No image selected.");
  }
  const type = String(file.type || "");
  if (type && !type.startsWith("image/") && type !== "application/octet-stream") {
    throw new Error("That file is not an image. Choose a JPEG, PNG, or WebP photo.");
  }
  // Read bytes and post to storage in parallel. Do not wait for canvas
  // downscale before UploadFile — jsdom (and some phone HEICs) can hang
  // Image decode, which used to leave the UI stuck on "Uploading…".
  const inlinePromise = fileToInlineDataUrl(file, downscale);
  try {
    const result = await uploadFile({ file });
    const stored = avatarUrlFromUploadResult(result);
    if (stored && (await verifyUrl(stored))) {
      return {
        url: stored,
        file_url: stored,
        image_data_url: await inlinePromise,
        inline: false,
      };
    }
    const image_data_url = await inlinePromise;
    return {
      url: image_data_url,
      file_url: stored || null,
      image_data_url,
      inline: true,
      warning: stored ? INLINE_UNSERVABLE_WARNING : INLINE_STUB_WARNING,
    };
  } catch (err) {
    const image_data_url = await inlinePromise;
    return {
      url: image_data_url,
      file_url: null,
      image_data_url,
      inline: true,
      warning: formatAvatarUploadError(err),
    };
  }
}

/** Same fallback when the customiser already has a generated data: URL. */
export async function persistDataUrlWithInlineFallback(
  dataUrl,
  persistFn,
  { verifyUrl = verifyPortraitUrl } = {},
) {
  if (!isInlineDataUrl(dataUrl)) {
    return { url: dataUrl, image_data_url: null, inline: false };
  }
  try {
    const stored = await persistFn(dataUrl);
    if (stored && (await verifyUrl(stored))) {
      return { url: stored, image_data_url: dataUrl, inline: false };
    }
    return {
      url: dataUrl,
      image_data_url: dataUrl,
      inline: true,
      warning: stored ? INLINE_UNSERVABLE_WARNING : INLINE_STUB_WARNING,
    };
  } catch (err) {
    return {
      url: dataUrl,
      image_data_url: dataUrl,
      inline: true,
      warning: formatAvatarUploadError(err),
    };
  }
}
