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
 * Decoded file size. An 8 MB PDF is about 11 MB of base64 JSON. V8 holds that
 * string as UTF-16 (~22 MB), then extraction copies the decoded bytes again
 * before pdf.js parses them. That spike is fine for one request, but the
 * Worker isolate is 128 MB shared across concurrent requests, so two 8 MB
 * uploads on top of the API can cross it. 4 MB decoded is about 5.4 MB of
 * JSON and stays inside that limit. The request-body cap (100 MB on Free and
 * Pro) and the 30s paid CPU budget are not the binding constraint.
 */
export const PDF_MAX_BYTES = 4 * 1024 * 1024;

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
 * combined. qwen2.5:0.5b on a 1 vCPU droplet prefills on the order of
 * 40–100 tokens/s. 1000 words is about 1,300 tokens, roughly 13–30s of
 * extra prefill that holds Ollama's single slot and pushes the next "hi"
 * past an 18s client timeout. 500 words is about half of that (~650 tokens,
 * ~7–16s) and still leaves a usable excerpt.
 */
export const PDF_CONTEXT_WORD_BUDGET = 500;

/** How many full-text hits to consider before the word budget cuts them. */
export const PDF_CONTEXT_MAX_HITS = 4;
