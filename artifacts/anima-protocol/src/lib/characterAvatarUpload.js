/**
 * Shared helpers for the New Character / add-character image upload path.
 * The Character entity persists the portrait on `avatar_url`. UploadFile may
 * return either `file_url` (current) or `url` (legacy stub / typings).
 */

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
  return {
    ...form,
    name: String(form?.name || "").trim(),
    avatar_url,
  };
}

function articleFor(noun) {
  return /^[aeiou]/i.test(String(noun || "")) ? "an" : "a";
}

/**
 * Map upload/storage failures to a short user-visible sentence.
 * Used by Settings chat backgrounds, avatar pickers, and document uploads.
 */
export function formatImageUploadError(err, { noun = "image" } = {}) {
  const msg = String(err?.message || err || "");
  const label = String(noun || "image");
  if (/unauthorized|sign in|not signed|401/i.test(msg)) {
    return `Sign in to upload ${articleFor(label)} ${label}, then try again.`;
  }
  if (/too large|413/i.test(msg)) {
    return `That ${label} is too large. Try a smaller photo.`;
  }
  if (/heic|heif/i.test(msg)) {
    return "This photo format (HEIC) isn't supported here. Choose a JPEG or PNG.";
  }
  if (/not found|404/i.test(msg)) {
    return "Image upload is not available on this host. Try again after the API is reachable.";
  }
  if (
    /database|503|unavailable|could not be reached|hyperdrive|schema is missing/i.test(
      msg,
    )
  ) {
    return "Image upload is temporarily unavailable. The database may be down — try again in a moment.";
  }
  return msg || `${label.charAt(0).toUpperCase()}${label.slice(1)} upload failed. Try another image.`;
}

export function formatAvatarUploadError(err) {
  return formatImageUploadError(err, { noun: "avatar" });
}
