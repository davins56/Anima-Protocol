import { PDF_MAX_BYTES } from "./pdf/limits";

/**
 * The 413 body for a request over the JSON body limit. It used to say "That
 * image is too large" for every route, including PDF and text uploads.
 */
export function payloadTooLargeMessage(path: string): string {
  const p = String(path || "");
  if (/\/pdfs(\/|$|\?)/.test(p)) {
    return `That PDF is too large. The limit is ${Math.round(PDF_MAX_BYTES / (1024 * 1024))} MB.`;
  }
  if (/\/storage\/uploads|\/avatar|\/image/i.test(p)) {
    return "That image is too large. Try a smaller photo.";
  }
  return "That upload is too large. Try a smaller file.";
}
