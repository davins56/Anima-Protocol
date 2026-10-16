/**
 * Client checks for a chat photo, before the file is read or uploaded.
 * The server repeats the type and size checks. iOS camera photos are often
 * HEIC; Safari can draw those into a JPEG before upload. Leave the file
 * input without a `capture` attribute so iPhone offers the camera and the library.
 */

export const CHAT_PHOTO_MAX_SOURCE_BYTES = 15 * 1024 * 1024;
export const CHAT_PHOTO_MAX_COUNT = 4;

/** `image/*` is what makes iOS offer the camera and the photo library. */
export const CHAT_PHOTO_ACCEPT = "image/*,.jpg,.jpeg,.png,.webp,.heic,.heif";

const EXT_RE = /\.(jpe?g|png|webp|heic|heif)$/i;

const TYPE_OK = new Set([
  "image/jpeg",
  "image/jpg",
  "image/pjpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
]);

export function chatPhotoRejection(file) {
  if (!file) return "Choose a photo.";
  const type = String(file.type || "").toLowerCase().split(";")[0].trim();
  const name = String(file.name || "");
  const extOk = EXT_RE.test(name);
  const typeOk =
    TYPE_OK.has(type) ||
    ((type === "" || type === "application/octet-stream") && extOk);
  if (!typeOk) return "Choose a JPEG, PNG, WebP, or HEIC photo.";
  if (!file.size) return "That photo is empty.";
  if (file.size > CHAT_PHOTO_MAX_SOURCE_BYTES) {
    return "That photo is too large. The limit is 15 MB.";
  }
  return null;
}
