// Downscale a data-URL image to fit within maxSize (longest edge) and re-encode
// it as a JPEG at the given quality. Returns a new data: URL. Images already
// smaller than maxSize are only re-encoded (never upscaled).
//
// Shared by the photo-pick flow (large phone photos must be shrunk before the
// AI image-edit request so they don't hit size limits / 413s) and by the final
// avatar save (which downscales further to a small thumbnail).

const HEIC_HINT = /image\/hei[cf]|data:image\/hei[cf]/i;
const LOAD_TIMEOUT_MS = 15000;

function loadErrorMessage(src) {
  if (HEIC_HINT.test(String(src || ""))) {
    return "This photo format (HEIC) isn't supported here. Choose a JPEG or PNG, or set iPhone camera to Most Compatible.";
  }
  return "Failed to load image. Try a JPEG, PNG, or WebP.";
}

export function downscaleDataUrl(src, maxSize, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    const timer = setTimeout(() => {
      finish(reject, new Error(loadErrorMessage(src)));
    }, LOAD_TIMEOUT_MS);
    img.onerror = () => finish(reject, new Error(loadErrorMessage(src)));
    img.onload = () => {
      try {
        if (!img.width || !img.height) {
          finish(reject, new Error(loadErrorMessage(src)));
          return;
        }
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          finish(reject, new Error("Failed to prepare image for upload."));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        finish(resolve, canvas.toDataURL("image/jpeg", quality));
      } catch (err) {
        finish(reject, err instanceof Error ? err : new Error(loadErrorMessage(src)));
      }
    };
    img.src = src;
    // jsdom (and some failed decodes) mark the image complete with 0×0
    // without firing onerror. Invalid data: URLs in jsdom stay incomplete
    // forever and never fire load/error either. Reject immediately instead
    // of hanging until LOAD_TIMEOUT_MS — callers can fall back to the
    // original data URL.
    const jsdomStuck =
      typeof navigator !== "undefined" &&
      /jsdom/i.test(navigator.userAgent || "") &&
      !img.complete;
    if ((img.complete || jsdomStuck) && !(img.naturalWidth || img.width)) {
      queueMicrotask(() => finish(reject, new Error(loadErrorMessage(src))));
    }
  });
}
