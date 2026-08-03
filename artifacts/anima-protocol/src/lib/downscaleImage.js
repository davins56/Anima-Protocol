// Downscale a data-URL image to fit within maxSize (longest edge) and re-encode
// it as a JPEG at the given quality. Returns a new data: URL. Images already
// smaller than maxSize are only re-encoded (never upscaled).
//
// Shared by the photo-pick flow (large phone photos must be shrunk before the
// AI image-edit request so they don't hit size limits / 413s) and by the final
// avatar save (which downscales further to a small thumbnail).
export function downscaleDataUrl(src, maxSize, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onerror = () => reject(new Error("Failed to load image"));
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.src = src;
  });
}
