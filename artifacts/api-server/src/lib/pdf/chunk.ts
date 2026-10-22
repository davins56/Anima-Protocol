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
  /** Estimated tokens (see estimateTokens). */
  tokenCount: number;
};

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Cheap, tokenizer-free estimate (~4 chars per token for English BPE). Both
 * supported embedders (nomic-embed-text, bge-base-en-v1.5) are within ±15%
 * of this on prose; it only sizes chunks and batches, nothing bills on it.
 */
export function estimateTokens(text: string): number {
  const clean = String(text || "").trim();
  if (!clean) return 0;
  return Math.max(1, Math.ceil(clean.length / 4));
}

/** Prefer a sentence end, then a word break, in the back half of the window. */
function breakPoint(full: string, start: number, end: number, target: number): number {
  const floor = start + Math.floor(target / 2);
  const window = full.slice(floor, end);
  const sentence = Math.max(
    window.lastIndexOf(". "),
    window.lastIndexOf("? "),
    window.lastIndexOf("! "),
  );
  if (sentence >= 0) return floor + sentence + 1;
  const space = full.lastIndexOf(" ", end);
  return space > floor ? space : end;
}

/**
 * Split per-page text into overlapping chunks small enough to embed and to
 * rank with Postgres full-text search. Page numbers are kept so the prompt
 * can say where an excerpt came from. Overlap starts on a word boundary.
 * Deterministic: the same pages always produce the same chunks, which is what
 * makes a pipeline retry idempotent.
 */
export function chunkPdfPages(
  pages: string[],
  options: { target?: number; overlap?: number; maxChunks?: number } = {},
): PdfChunkDraft[] {
  const target = Math.max(50, options.target ?? PDF_CHUNK_TARGET_CHARS);
  const overlap = Math.max(
    0,
    Math.min(options.overlap ?? PDF_CHUNK_OVERLAP_CHARS, Math.floor(target / 2)),
  );
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
  if (!full) return [];

  const pageAt = (offset: number): number => {
    const span = spans.find((item) => offset < item.end) ?? spans[spans.length - 1];
    return span?.page ?? 1;
  };

  const chunks: PdfChunkDraft[] = [];
  let start = 0;
  while (start < full.length && chunks.length < maxChunks) {
    let end = Math.min(full.length, start + target);
    if (end < full.length) end = breakPoint(full, start, end, target);
    const content = full.slice(start, end).trim();
    if (content) {
      // Skip leading whitespace so the page of the first real character counts.
      let first = start;
      while (first < end && /\s/.test(full[first] || "")) first += 1;
      const pageStart = pageAt(first);
      const pageEnd = pageAt(Math.max(first, end - 1));
      chunks.push({
        chunkIndex: chunks.length,
        pageStart,
        pageEnd: Math.max(pageStart, pageEnd),
        content,
        tokenCount: estimateTokens(content),
      });
    }
    if (end >= full.length) break;
    let next = end - overlap;
    if (next > start && overlap > 0) {
      // Start the overlap on a word so a chunk never opens mid-word.
      const space = full.indexOf(" ", next);
      if (space >= 0 && space < end) next = space + 1;
    }
    start = next > start ? next : end;
  }
  return chunks;
}
