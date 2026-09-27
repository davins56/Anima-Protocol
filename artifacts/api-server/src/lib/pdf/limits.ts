/**
 * PDF upload and retrieval budgets.
 *
 * PDF_CONTEXT_CHAR_BUDGET is the knob for how much extracted text is added
 * to a single chat turn. Keep it small: anima-chat is a ~3B model and
 * reply speed matters more than reading a whole file.
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
 * Characters of PDF excerpt injected into one companion turn.
 * Tune this constant — retrieval will not exceed it.
 */
export const PDF_CONTEXT_CHAR_BUDGET = 1_200;

/** How many full-text hits to consider before the character budget cuts them. */
export const PDF_CONTEXT_MAX_HITS = 4;
