import {
  avatarUrlFromUploadResult,
  formatImageUploadError,
} from "./characterAvatarUpload";

/**
 * Settings → Background stores novels / notes as UserContext.
 * Image files go through POST /api/storage/uploads. Text documents are sent
 * inline as `file_content` — UploadFile only accepts images and would fail
 * every .txt/.md/.pdf pick with "not an image".
 */
export function userContextNeedsStorageUpload(isImage) {
  return Boolean(isImage);
}

export async function uploadUserContextStorageFile(file, uploadFile) {
  if (!file) {
    throw new Error("No file selected.");
  }
  const result = await uploadFile({ file });
  const fileUrl = avatarUrlFromUploadResult(result);
  if (!fileUrl) {
    throw new Error("Upload failed — no file URL returned. Try another file.");
  }
  return fileUrl;
}

export function formatUserContextUploadError(err) {
  return formatImageUploadError(err, { noun: "file" });
}
