import { PdfUploadError } from "./errors";
import {
  PDF_MAX_BYTES,
  PDF_MAX_EXTRACTED_CHARS,
  PDF_MAX_PAGES,
} from "./limits";

/** PDF header can sit after a short preamble; the spec allows the first 1024 bytes. */
export function isPdfBytes(bytes: Uint8Array): boolean {
  const head = bytes.subarray(0, Math.min(bytes.length, 1024));
  const text = new TextDecoder("latin1").decode(head);
  return text.includes("%PDF-");
}

export function assertPdfBytes(bytes: Uint8Array): void {
  if (!bytes.byteLength) {
    throw new PdfUploadError("That PDF is empty.", "pdf_empty", 400);
  }
  if (bytes.byteLength > PDF_MAX_BYTES) {
    throw new PdfUploadError(
      "That PDF is too large. The limit is 4 MB.",
      "pdf_too_large",
      413,
    );
  }
  if (!isPdfBytes(bytes)) {
    throw new PdfUploadError(
      "That file isn't a PDF. Choose a .pdf file.",
      "pdf_not_pdf",
      400,
    );
  }
}

/**
 * Decode a raw base64 payload or a data URL. The browser uploads the file;
 * extraction stays on the server.
 */
export function decodePdfBase64(input: string): Uint8Array {
  const trimmed = String(input || "").trim();
  const dataUrl = /^data:[^;]+;base64,([\s\S]+)$/.exec(trimmed);
  const b64 = (dataUrl ? dataUrl[1] : trimmed).replace(/\s+/g, "");
  if (!b64) {
    throw new PdfUploadError("That PDF is empty.", "pdf_empty", 400);
  }
  return new Uint8Array(Buffer.from(b64, "base64"));
}

export type ExtractedPdf = {
  pageCount: number;
  pages: string[];
};

type UnpdfApi = {
  extractText: (
    pdf: unknown,
    options: { mergePages: false },
  ) => Promise<{ text: string | string[] }>;
  getDocumentProxy: (data: Uint8Array) => Promise<{
    numPages: number;
    loadingTask: { destroy: () => Promise<void> };
  }>;
};

let unpdfLoad: Promise<UnpdfApi> | null = null;

/**
 * pdf.js is several megabytes. Chat and store import this module, so a static
 * `unpdf` import evaluates on every cold start. Import it here so that
 * initializer runs on the first extraction only.
 */
function loadUnpdf(): Promise<UnpdfApi> {
  if (!unpdfLoad) {
    unpdfLoad = import("unpdf").then(
      (mod) => mod as unknown as UnpdfApi,
      (err) => {
        unpdfLoad = null;
        throw err;
      },
    );
  }
  return unpdfLoad;
}

/**
 * Extract selectable text with unpdf (PDF.js packaged for serverless).
 * The same module runs inside the esbuild bundle used by the Cloudflare
 * Worker (`worker.ts`) and the Node / Vercel server. It does not render
 * pages and does not need a canvas native addon.
 *
 * Scanned / image-only PDFs have no text operators, so extraction returns
 * empty strings and we say so instead of storing a blank document.
 */
export async function extractPdfPages(bytes: Uint8Array): Promise<ExtractedPdf> {
  assertPdfBytes(bytes);
  const { extractText, getDocumentProxy } = await loadUnpdf();
  // pdf.js transfers the buffer into its worker and detaches the original.
  // Copy first so the caller can still read byteLength, and so a retry of
  // the same bytes is not an empty buffer.
  const copy = bytes.slice();
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>> | null = null;
  try {
    pdf = await getDocumentProxy(copy);
  } catch {
    throw new PdfUploadError(
      "I couldn't open that PDF. It may be damaged or password-protected.",
      "pdf_unreadable",
      400,
    );
  }
  try {
    const pageCount = pdf.numPages;
    if (!pageCount) {
      throw new PdfUploadError(
        "That PDF has no pages.",
        "pdf_empty",
        400,
      );
    }
    if (pageCount > PDF_MAX_PAGES) {
      throw new PdfUploadError(
        `That PDF has ${pageCount} pages. The limit is ${PDF_MAX_PAGES} pages so replies stay fast. Split it into smaller files.`,
        "pdf_too_many_pages",
        413,
      );
    }
    const extracted = await extractText(pdf, { mergePages: false });
    const rawPages = Array.isArray(extracted.text) ? extracted.text : [extracted.text];
    const pages = rawPages.map((page) => String(page || "").replace(/\u0000/g, "").trim());
    const totalChars = pages.reduce((sum, page) => sum + page.length, 0);
    if (!pages.some((page) => page.length > 0)) {
      throw new PdfUploadError(
        "This PDF has no extractable text. It looks like a scan or pictures only, so I can't read it. Export a text-based PDF and try again.",
        "pdf_no_text",
        422,
      );
    }
    if (totalChars > PDF_MAX_EXTRACTED_CHARS) {
      throw new PdfUploadError(
        "This PDF has too much text to keep replies fast. Split it into smaller files.",
        "pdf_too_much_text",
        413,
      );
    }
    return { pageCount, pages };
  } finally {
    // unpdf's proxy has no document.destroy(); the loading task owns the worker.
    // A cleanup failure must not replace the extract result or a friendly error.
    try {
      await pdf.loadingTask.destroy();
    } catch {
      /* ignore */
    }
  }
}
