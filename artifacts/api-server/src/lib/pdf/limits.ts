/**
 * PDF upload and retrieval budgets.
 *
 * PDF_CONTEXT_WORD_BUDGET is the knob for how much extracted text is added
 * to a single chat turn (chat attachments and companion lore combined).
 * Retrieval is Postgres full-text search only. Do not add embeddings, a
 * second Ollama model, Workers AI, or Vectorize — the droplet has 1 GB RAM
 * and PDF text must stay on this app's server and database.
 */

/** Decoded file size. 8 MB base64 fits the 25 MB JSON body limit. */
export const PDF_MAX_BYTES = 8 * 1024 * 1024;

/** Page cap so extraction stays inside a Worker / Node request. */
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
 * combined. Tune this constant. 1000 is the ceiling; a smaller number is
 * safer because every extra word delays the first reply on anima-chat.
 */
export const PDF_CONTEXT_WORD_BUDGET = 1_000;

/** How many full-text hits to consider before the word budget cuts them. */
export const PDF_CONTEXT_MAX_HITS = 4;
