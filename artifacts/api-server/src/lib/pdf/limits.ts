/**
 * PDF upload, pipeline, and retrieval budgets.
 *
 * PDF_CONTEXT_WORD_BUDGET is the knob for how much extracted text is added
 * to a single chat turn (chat attachments and companion lore combined).
 *
 * Retrieval is hybrid: Postgres full-text search (always) plus pgvector
 * similarity over 768-d chunk embeddings (pdf_chunk_embeddings) when an
 * embedder is reachable. Embeddings come from the memory core embedder
 * (lib/memoryCore/embedder.ts) and default to the self-hosted host only
 * (ANIMA_PDF_EMBED_PROVIDER=local), so PDF text stays on this app's server,
 * its database, and its own model host. Never a third-party API.
 */

/**
 * Raw `application/pdf` uploads (the default client path). The bytes are held
 * once: storage gets the original, then pdf.js parses it in place without a
 * second copy. Override with ANIMA_PDF_MAX_BYTES (bytes) if the Worker isolate
 * (128 MB, shared by concurrent requests) needs a lower ceiling.
 */
export const PDF_MAX_BYTES_DEFAULT = 20 * 1024 * 1024;

export function pdfMaxBytes(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.ANIMA_PDF_MAX_BYTES);
  return Number.isFinite(raw) && raw > 0 ? Math.min(raw, PDF_MAX_BYTES_DEFAULT) : PDF_MAX_BYTES_DEFAULT;
}

/**
 * Legacy JSON `{ dataBase64 }` uploads. An 8 MB PDF is about 11 MB of base64
 * JSON, which V8 holds as UTF-16 (~22 MB) before the decoded copy, so this
 * path stays at 4 MB decoded to fit two concurrent uploads in one isolate.
 */
export const PDF_MAX_BASE64_BYTES = 4 * 1024 * 1024;

/** @deprecated use pdfMaxBytes() / PDF_MAX_BASE64_BYTES. Kept for older imports. */
export const PDF_MAX_BYTES = PDF_MAX_BASE64_BYTES;

/**
 * Original PDF bytes are stored in Supabase Storage when configured, else in
 * Postgres so a chat chip can open the file. One 4 MB parameterized INSERT is
 * dropped by Hyperdrive, so the Postgres fallback splits the file into 512 KiB
 * parts (the same size as own-model weight chunks).
 */
export const PDF_FILE_PART_BYTES = 512 * 1024;

/**
 * Page cap. pdf.js text extraction (no rendering) runs ~10–20 ms/page, so 200
 * pages stays well inside the 30 s paid Worker CPU budget.
 */
export const PDF_MAX_PAGES = 200;

/** Reject dense PDFs even when the page count is under the cap. */
export const PDF_MAX_EXTRACTED_CHARS = 400_000;

export const PDF_MAX_FILES_PER_CHAT = 8;
export const PDF_MAX_FILES_PER_LORE = 12;

/**
 * Target size of one stored chunk: ~900 chars ≈ 225 tokens. Fits bge-base's
 * 512-token window with room to spare (nomic-embed-text takes 8k) and is
 * small enough that one excerpt does not eat the 300-word prompt budget.
 */
export const PDF_CHUNK_TARGET_CHARS = 900;
/** ~150 chars (one or two sentences) copied onto the next chunk so a sentence can straddle a split. */
export const PDF_CHUNK_OVERLAP_CHARS = 150;
/** 400k chars / (900 − 150) ≈ 534; 520 covers a full-size document. */
export const PDF_MAX_CHUNKS = 520;

/** Chunks per embed request. Small so a CPU-only host answers inside the timeout. */
export const PDF_EMBED_BATCH = 16;
/** Per-batch timeout for the self-hosted embedder during ingestion (not the chat path). */
export const PDF_EMBED_TIMEOUT_MS = 15_000;
/** Max batches one request / background slot runs before yielding to the cron or a status poll. */
export const PDF_EMBED_MAX_BATCHES_PER_RUN = 8;

/** A document stuck in a processing state this long is treated as abandoned and can be reclaimed. */
export const PDF_STALE_PROCESSING_MS = 2 * 60 * 1000;

/**
 * Words of PDF text injected into one companion turn, chat files and lore
 * combined. The droplet log showed a 3,916-token prompt against n_ctx 4096;
 * PDF text is the first thing dropped when that prompt is over budget, and
 * 300 words is about 400 tokens so a cache miss does not spend the whole
 * 18s client limit on excerpt prefill.
 */
export const PDF_CONTEXT_WORD_BUDGET = 300;

/** How many full-text hits to consider before the word budget cuts them. */
export const PDF_CONTEXT_MAX_HITS = 4;

/** Vector hits below this cosine similarity are noise for 768-d sentence embedders. */
export const PDF_VECTOR_MIN_SIMILARITY = 0.35;
/** Query embedding budget on the chat path (inside the 1.5 s optional-context ceiling). */
export const PDF_QUERY_EMBED_TIMEOUT_MS = 1200;
