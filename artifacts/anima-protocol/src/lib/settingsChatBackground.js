import {
  avatarUrlFromUploadResult,
  formatImageUploadError,
  uploadCharacterAvatar,
} from "./characterAvatarUpload";
import { isRetryableStoreWriteError } from "./storeErrorSignals";

/**
 * Upload a Settings custom chat-background image through the same
 * Postgres-backed `/api/storage/uploads` path used for avatars.
 */
export async function uploadChatBackgroundImage(file, uploadFile) {
  return uploadCharacterAvatar(file, uploadFile);
}

export function chatBackgroundUrlFromUploadResult(result) {
  return avatarUrlFromUploadResult(result);
}

/**
 * Persist the new background onto the user profile so a refresh keeps the
 * same-origin `/api/storage/...` preview.
 */
export async function persistChatBackgroundSettings({
  prefs,
  fileUrl,
  updateMe,
}) {
  const next = {
    ...prefs,
    chat_bg_theme: "custom",
    chat_bg_image: fileUrl,
  };
  let lastErr;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await updateMe({
        settings: next,
        display_name: next.display_name,
      });
      return next;
    } catch (err) {
      lastErr = err;
      if (attempt === 2 || !isRetryableStoreWriteError(err)) throw err;
    }
  }
  throw lastErr;
}

export function formatChatBackgroundUploadError(err) {
  return formatImageUploadError(err, { noun: "image" });
}
