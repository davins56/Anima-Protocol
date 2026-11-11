import {
  PDF_CHUNK_OVERLAP_CHARS,
  PDF_CHUNK_TARGET_CHARS,
  PDF_MAX_CHUNKS,
} from "./limits";

export type PdfChunkDraft = {
  chunkIndex: number;
  pageStart: number;
  pageEnd: number;
  content: string;
};

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Split per-page text into overlapping chunks small enough to store and
 * to rank with Postgres full-text search. Page numbers are kept so the
 * prompt can say where an excerpt came from.
 */
export type PdfChunkResult = {
  chunks: PdfChunkDraft[];
  /** True when maxChunks stopped chunking before the end of the text. */
  truncated: boolean;
  /** Characters of collapsed text across all pages. */
  totalChars: number;
  /** Characters of that text the stored chunks reach (end of the last chunk). */
  coveredChars: number;
};

/** Chunk a PDF's pages, legacy shape: just the chunks. */
export function chunkPdfPages(
  pages: string[],
  options: { target?: number; overlap?: number; maxChunks?: number } = {},
): PdfChunkDraft[] {
  return chunkPdfPagesDetailed(pages, options).chunks;
}

/**
 * Chunk a PDF's pages and report whether the chunk cap cut the text short.
 * The cap used to drop the tail silently; callers now reject instead.
 */
export function chunkPdfPagesDetailed(
  pages: string[],
  options: { target?: number; overlap?: number; maxChunks?: number } = {},
): PdfChunkResult {
  const target = options.target ?? PDF_CHUNK_TARGET_CHARS;
  const overlap = Math.min(options.overlap ?? PDF_CHUNK_OVERLAP_CHARS, Math.floor(target / 2));
  const maxChunks = options.maxChunks ?? PDF_MAX_CHUNKS;

  const spans: { page: number; start: number; end: number }[] = [];
  let full = "";
  for (let i = 0; i < pages.length; i += 1) {
    const text = collapse(pages[i] || "");
    if (!text) continue;
    if (full) full += "\n";
    const start = full.length;
    full += text;
    spans.push({ page: i + 1, start, end: full.length });
  }
  if (!full) return { chunks: [], truncated: false, totalChars: 0, coveredChars: 0 };

  const pageAt = (offset: number): number => {
    const span = spans.find((item) => offset < item.end) ?? spans[spans.length - 1];
    return span?.page ?? 1;
  };

  const chunks: PdfChunkDraft[] = [];
  let start = 0;
  let coveredChars = 0;
  while (start < full.length && chunks.length < maxChunks) {
    let end = Math.min(full.length, start + target);
    if (end < full.length) {
      const breakAt = full.lastIndexOf(" ", end);
      if (breakAt > start + Math.floor(target / 2)) end = breakAt;
    }
    const content = full.slice(start, end).trim();
    if (content) {
      const pageStart = pageAt(start);
      const pageEnd = pageAt(Math.max(start, end - 1));
      chunks.push({
        chunkIndex: chunks.length,
        pageStart,
        pageEnd: Math.max(pageStart, pageEnd),
        content,
      });
    }
    coveredChars = end;
    if (end >= full.length) break;
    const next = end - overlap;
    start = next > start ? next : end;
  }
  return {
    chunks,
    truncated: coveredChars < full.length,
    totalChars: full.length,
    coveredChars,
  };
}

/** Shown when the chunk cap would drop text. Nothing is stored. */
export function pdfChunkCapMessage(coveredChars: number, totalChars: number): string {
  const fmt = (n: number) => Math.max(0, Math.round(n)).toLocaleString("en-US");
  return (
    `This PDF has too much text for one file. Only the first ${fmt(coveredChars)} of ` +
    `${fmt(totalChars)} characters would fit, so it wasn't saved. Split it into smaller files.`
  );
}
