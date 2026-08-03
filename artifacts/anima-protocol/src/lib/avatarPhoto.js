// Pure, testable helpers behind the pick-a-photo-and-AI-edit avatar flow.
//
// Two surfaces share this logic:
//   - AvatarAIEditModal: deciding what image "Apply" / "Use Photo" saves and
//     downscaling it before handing it to the caller.
//   - MainHome: reading a freshly picked file into a data URL, shrinking it for
//     the AI edit request, and opening the editor pre-loaded with it.
//
// Keeping these as plain functions (with the DOM-bound bits injectable) lets the
// flow be unit-tested without rendering React or relying on a real canvas/image
// pipeline, which jsdom does not implement.

import { downscaleDataUrl } from "@/lib/downscaleImage";

// Which image should "Apply" / "Use Photo" save?
//   - An AI result always wins once one exists.
//   - Otherwise the untouched source is only eligible when the caller opted into
//     saving the original (the pick-then-use-as-is path).
//   - When neither applies there is nothing to save.
export function resolveApplyTarget({ result, sourceImage, allowSaveOriginal }) {
  if (result) return result;
  if (allowSaveOriginal && sourceImage) return sourceImage;
  return null;
}

// Should the Apply / "Use Photo" button be shown at all? Mirrors
// resolveApplyTarget so the button never appears when there's nothing to apply.
export function canShowApply({ result, sourceImage, allowSaveOriginal }) {
  return resolveApplyTarget({ result, sourceImage, allowSaveOriginal }) !== null;
}

// Resolve the target image, downscale it to a small thumbnail, and hand it to
// onApply. Returns true when something was applied, false when there was nothing
// to save. The downscale step is injectable so tests can run without a DOM
// canvas.
export async function applyAvatarEdit(
  { result, sourceImage, allowSaveOriginal },
  { onApply, downscale = downscaleDataUrl, maxSize = 512, quality = 0.85 } = {},
) {
  const target = resolveApplyTarget({ result, sourceImage, allowSaveOriginal });
  if (!target) return false;
  const small = await downscale(target, maxSize, quality);
  await onApply(small);
  return true;
}

// Read a picked file into a data URL. Resolves null for a missing file or a
// non-string read result (so callers can no-op safely). The FileReader is
// injectable for testing/determinism.
export function readPhotoAsDataUrl(file, { reader = new FileReader() } = {}) {
  return new Promise((resolve, reject) => {
    if (!file) {
      resolve(null);
      return;
    }
    reader.onload = () => {
      resolve(typeof reader.result === "string" ? reader.result : null);
    };
    reader.onerror = () => reject(reader.error || new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

// Read a freshly picked photo and open the AI edit modal pre-loaded with it,
// marked as a new photo so "Use Photo" (save-as-is) is offered. Large phone
// photos (5–15MB) are shrunk to ~1024px JPEG first so they don't slow down or
// hit size limits on the AI image-edit request; the raw photo is used as a
// fallback if downscaling fails. No-ops when the file can't be read. Returns
// true when the editor was opened. The read/downscale steps are injectable for
// testing.
export async function openPhotoEditor(
  file,
  {
    read = readPhotoAsDataUrl,
    downscale = downscaleDataUrl,
    setEditSource,
    setEditingNewPhoto,
    setAiEditOpen,
  } = {},
) {
  const dataUrl = await read(file);
  if (!dataUrl) return false;
  let source = dataUrl;
  try {
    source = await downscale(dataUrl, 1024, 0.85);
  } catch (err) {
    console.debug("Photo downscale failed; using original", err);
  }
  setEditSource(source);
  setEditingNewPhoto(true);
  setAiEditOpen(true);
  return true;
}
