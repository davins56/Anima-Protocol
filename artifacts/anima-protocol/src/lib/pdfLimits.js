/**
 * Client-side prechecks. The server enforces the same limits
 * (artifacts/api-server/src/lib/pdf/limits.ts). 4 MB decoded keeps two
 * uploads inside a Worker isolate's 128 MB memory limit.
 */
export const PDF_MAX_BYTES = 4 * 1024 * 1024;
export const PDF_MAX_PAGES = 80;

export function pdfFileRejection(file) {
  if (!file) return "Choose a PDF file.";
  const name = String(file.name || "");
  const type = String(file.type || "").toLowerCase();
  const looksPdf =
    type === "application/pdf" ||
    type === "application/x-pdf" ||
    name.toLowerCase().endsWith(".pdf");
  if (!looksPdf) return "That file isn't a PDF. Choose a .pdf file.";
  if (!file.size) return "That PDF is empty.";
  if (file.size > PDF_MAX_BYTES) return "That PDF is too large. The limit is 4 MB.";
  return null;
}
