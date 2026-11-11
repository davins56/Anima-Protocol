import {
  avatarUrlFromUploadResult,
  formatImageUploadError,
} from "./characterAvatarUpload";

/**
 * Settings → Background stores novels / notes as UserContext.
 * Image files go through POST /api/storage/uploads. Text documents are sent
 * inline as `file_content` — UploadFile only accepts images and would fail
 * every .txt/.md/.pdf pick with "not an image".
 */
export function userContextNeedsStorageUpload(isImage) {
  return Boolean(isImage);
}

export async function uploadUserContextStorageFile(file, uploadFile) {
  if (!file) {
    throw new Error("No file selected.");
  }
  const result = await uploadFile({ file });
  const fileUrl = avatarUrlFromUploadResult(result);
  if (!fileUrl) {
    throw new Error("Upload failed — no file URL returned. Try another file.");
  }
  return fileUrl;
}

export function formatUserContextUploadError(err) {
  return formatImageUploadError(err, { noun: "file" });
}

/**
 * Book PDFs (and .docx / .epub, which are zip files the browser can't read as
 * text) are not supported on this screen until the new upload pipeline ships.
 * The old modal saved an empty card for them and reported success.
 */
export const USER_CONTEXT_PDF_UNSUPPORTED_MESSAGE =
  "PDFs can't be read here yet. Book PDFs are coming with the new upload pipeline. For now, upload a .txt or .md file.";
export const USER_CONTEXT_DOC_UNSUPPORTED_MESSAGE =
  "Word and EPUB files can't be read here yet. They're coming with the new upload pipeline. For now, save it as .txt or .md and upload that.";
export const USER_CONTEXT_NO_TEXT_MESSAGE =
  "No text received, re-upload when book uploads are available.";

export const USER_CONTEXT_TEXT_EXTS = [".txt", ".md"];
export const USER_CONTEXT_IMAGE_EXTS = [".png", ".jpg", ".jpeg", ".webp", ".gif"];
export const USER_CONTEXT_ACCEPT = ".txt,.md,text/plain,text/markdown,image/*";
/** Must match CONTEXT_ANALYSIS_MAX_CHARS in api-server functions.ts. */
export const USER_CONTEXT_ANALYSIS_MAX_CHARS = 12_000;
/**
 * A text analysis is one model call with a 12s timeout, so a row still
 * "processing" after this long was abandoned (the request died or 500'd).
 */
export const USER_CONTEXT_STALL_MS = 5 * 60 * 1000;
/** Client wait for processUserContext (vision calls have no server timeout). */
export const USER_CONTEXT_PROCESS_TIMEOUT_MS = 90_000;

function extOf(name) {
  const n = String(name || "");
  const dot = n.lastIndexOf(".");
  return dot === -1 ? "" : n.slice(dot).toLowerCase();
}

/** "text" | "image" | "pdf" | "document" (docx/epub) | "unsupported" */
export function classifyUserContextFile(file) {
  if (!file) return "unsupported";
  const ext = extOf(file.name);
  const type = String(file.type || "").toLowerCase();
  if (ext === ".pdf" || type === "application/pdf") return "pdf";
  if (
    ext === ".docx" ||
    ext === ".epub" ||
    type === "application/epub+zip" ||
    type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return "document";
  }
  if (type.startsWith("image/") || USER_CONTEXT_IMAGE_EXTS.includes(ext)) return "image";
  if (USER_CONTEXT_TEXT_EXTS.includes(ext) || type === "text/plain" || type === "text/markdown") {
    return "text";
  }
  return "unsupported";
}

/** Error to show for a picked file, or "" when it can be uploaded. */
export function userContextFileRejection(file, maxBytes = 10 * 1024 * 1024) {
  const kind = classifyUserContextFile(file);
  if (kind === "pdf") return USER_CONTEXT_PDF_UNSUPPORTED_MESSAGE;
  if (kind === "document") return USER_CONTEXT_DOC_UNSUPPORTED_MESSAGE;
  if (kind === "unsupported") return "Please upload a .txt or .md file, or an image.";
  if (file.size > maxBytes) return "File must be under 10MB.";
  return "";
}

/** Message for a failed processUserContext call (thrown by throwOnError). */
export function formatUserContextProcessError(err) {
  if (!err) return "The analysis didn't finish. Try again.";
  if (err.name === "TimeoutError" || err.name === "AbortError") {
    return "The analysis took too long and was stopped. Try again.";
  }
  const msg = String(err.message || "").trim();
  return msg || "The analysis didn't finish. Try again.";
}

function hasAnalysis(doc) {
  return Boolean(
    doc?.extracted_summary ||
      doc?.extracted_text ||
      doc?.key_themes?.length ||
      doc?.personal_values?.length ||
      doc?.characters_mentioned?.length,
  );
}

const NO_TEXT_CODES = new Set(["pdf_not_supported", "no_text_received"]);

/**
 * What a Background card should say about a UserContext row.
 *   state: "ready" | "processing" | "stalled" | "failed" | "no_text"
 *   retry: "server" (re-run on the stored excerpt), "file" (choose the file
 *          again), or null (nothing to retry with).
 */
export function deriveUserContextStatus(doc, now = Date.now()) {
  const storedInput = typeof doc?.analysis_input === "string" && doc.analysis_input.trim() !== "";
  const retryMode = storedInput
    ? "server"
    : doc?.source_kind === "image" || doc?.source_kind === "text"
      ? "file"
      : null;
  const err = doc?.processing_error;
  if (doc?.processing_status === "failed" || (err && typeof err === "object")) {
    const code = err?.code || "";
    if (NO_TEXT_CODES.has(code)) {
      return { state: "no_text", label: "No text", reason: USER_CONTEXT_NO_TEXT_MESSAGE, retry: null };
    }
    return {
      state: "failed",
      label: "Failed",
      reason: err?.message || "The analysis didn't finish.",
      retry: retryMode,
    };
  }
  if (doc?.processing_complete) {
    if (!hasAnalysis(doc)) {
      return { state: "no_text", label: "No text", reason: USER_CONTEXT_NO_TEXT_MESSAGE, retry: null };
    }
    return { state: "ready", label: "Ready", reason: "", retry: null };
  }
  const startedRaw = doc?.processing_started_at || doc?.created_date;
  const started = startedRaw ? Date.parse(startedRaw) : NaN;
  const stalled = !Number.isFinite(started) || now - started > USER_CONTEXT_STALL_MS;
  if (!stalled) {
    return { state: "processing", label: "Analysing", reason: "", retry: null };
  }
  if (!retryMode) {
    // Rows from the old modal: a PDF (or a file whose analysis 500'd) with no
    // text stored anywhere. Retrying would only "succeed" with nothing.
    return { state: "no_text", label: "No text", reason: USER_CONTEXT_NO_TEXT_MESSAGE, retry: null };
  }
  return {
    state: "stalled",
    label: "Stalled",
    reason: "The analysis didn't finish. It may have been interrupted.",
    retry: retryMode,
  };
}

/** Card subtitle word count. Never shows a made-up "0 words". */
export function userContextWordCountLabel(doc, status = deriveUserContextStatus(doc)) {
  if (typeof doc?.word_count === "number" && Number.isFinite(doc.word_count)) {
    const n = doc.word_count;
    return `${n.toLocaleString("en-US")} ${n === 1 ? "word" : "words"}`;
  }
  if (doc?.source_kind === "image") return "image";
  if (status.state === "no_text") return "no text received";
  if (status.state === "processing") return "counting words…";
  return "word count not recorded";
}

/** "Summary covers the first 12,000 of 48,210 characters." or "". */
export function userContextTruncationNote(doc) {
  if (!doc?.analysis_truncated) return "";
  const analysed = Number(doc.analyzed_char_count) || USER_CONTEXT_ANALYSIS_MAX_CHARS;
  const total = Number(doc.source_char_count) || 0;
  if (!total) return `Summary covers only the first ${analysed.toLocaleString("en-US")} characters.`;
  return `Summary covers only the first ${analysed.toLocaleString("en-US")} of ${total.toLocaleString("en-US")} characters.`;
}

/** Codes the API writes onto the row itself before it returns the error. */
const SERVER_RECORDED_CODES = new Set([
  "pdf_not_supported",
  "no_text_received",
  "llm_busy",
  "analysis_failed",
  "analysis_empty",
]);

/**
 * Run processUserContext for one row and surface the outcome. On a failure the
 * API didn't record (network drop, 500, client timeout) the row is marked
 * failed here so the card can't keep pulsing "in progress".
 * Resolves { ok: true, data } or { ok: false, message }.
 */
export async function runUserContextProcessing({ invoke, updateRecord, recordId, payload }) {
  try {
    const result = await invoke(
      "processUserContext",
      { ...payload, user_context_id: recordId },
      { throwOnError: true, timeoutMs: USER_CONTEXT_PROCESS_TIMEOUT_MS },
    );
    return { ok: true, data: result?.data ?? null };
  } catch (err) {
    const message = formatUserContextProcessError(err);
    if (recordId && updateRecord && !SERVER_RECORDED_CODES.has(err?.code)) {
      try {
        await updateRecord(recordId, {
          processing_status: "failed",
          processing_error: {
            code: err?.code || "request_failed",
            message,
            retryable: true,
          },
        });
      } catch (markErr) {
        console.warn("Could not mark Background document failed", markErr);
      }
    }
    return { ok: false, message, code: err?.code || "" };
  }
}
