/**
 * PDF upload and retrieval budgets.
 *
 * PDF_CONTEXT_WORD_BUDGET is the knob for how much extracted text is added
 * to a single chat turn (chat attachments and companion lore combined).
 * Retrieval is Postgres full-text search only. Do not add embeddings, a
 * second Ollama model, Workers AI, or Vectorize — the droplet has 1 GB RAM
 * and PDF text must stay on this app's server and database.
 */

/**
 * Decoded file size: 100 MB. The upload is base64 JSON (~134 MB for a full
 * 100 MB file), so the express body limit in app.ts is sized to match.
 * Caution: on the Cloudflare Worker the isolate has 128 MB of memory and the
 * edge rejects request bodies over 100 MB (Free/Pro), so very large PDFs can
 * still fail there before or during extraction. The page and extracted-text
 * caps below still apply.
 */
export const PDF_MAX_BYTES = 100 * 1024 * 1024;

/**
 * Original PDF bytes are stored in Postgres so a chat chip can open the file.
 * One multi-MB parameterized INSERT is dropped by Hyperdrive, so the file is
 * split into 512 KiB parts (the same size as own-model weight chunks).
 */
export const PDF_FILE_PART_BYTES = 512 * 1024;

/**
 * Page cap. 80 pages of text near the extracted-character cap finishes in
 * well under a second, inside the Worker CPU budget, so the page count stays.
 */
export const PDF_MAX_PAGES = 80;

/** Reject dense PDFs even when the page count is under the cap. */
export const PDF_MAX_EXTRACTED_CHARS = 100_000;

export const PDF_MAX_FILES_PER_CHAT = 8;
export const PDF_MAX_FILES_PER_LORE = 12;

/** Target size of one stored chunk. */
export const PDF_CHUNK_TARGET_CHARS = 900;
/** Characters copied onto the next chunk so a sentence can straddle a split. */
export const PDF_CHUNK_OVERLAP_CHARS = 100;
export const PDF_MAX_CHUNKS = 120;

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
