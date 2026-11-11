import { describe, expect, it, vi } from "vitest";
import {
  USER_CONTEXT_NO_TEXT_MESSAGE,
  USER_CONTEXT_PDF_UNSUPPORTED_MESSAGE,
  USER_CONTEXT_STALL_MS,
  classifyUserContextFile,
  deriveUserContextStatus,
  runUserContextProcessing,
  userContextFileRejection,
  userContextTruncationNote,
  userContextWordCountLabel,
  formatUserContextUploadError,
  uploadUserContextStorageFile,
  userContextNeedsStorageUpload,
} from "./userContextUpload";

describe("userContextUpload", () => {
  it("only posts images to /api/storage/uploads", () => {
    expect(userContextNeedsStorageUpload(true)).toBe(true);
    expect(userContextNeedsStorageUpload(false)).toBe(false);
  });

  it("returns the stored file_url for an image", async () => {
    const file = new File(["fake"], "page.png", { type: "image/png" });
    const uploadFile = vi.fn(async () => ({
      file_url: "/api/storage/objects/uploads/page-1",
    }));
    await expect(uploadUserContextStorageFile(file, uploadFile)).resolves.toBe(
      "/api/storage/objects/uploads/page-1",
    );
    expect(uploadFile).toHaveBeenCalledWith({ file });
  });

  it("surfaces auth and size failures instead of a generic retry", () => {
    expect(formatUserContextUploadError(new Error("Unauthorized"))).toMatch(
      /sign in/i,
    );
    expect(formatUserContextUploadError(new Error("too large"))).toMatch(
      /too large/i,
    );
  });
});

const NOW = Date.parse("2026-11-11T01:30:00Z");

// The three rows on the user's screen: saved by the old modal yesterday, the
// processUserContext call 500'd, nothing else was ever written.
const stuckNovel = {
  id: "ctx_novel_1",
  title: "the-slipthk-way-TRADE",
  document_type: "novel",
  file_url: "",
  is_active: true,
  processing_complete: false,
  created_date: "2026-11-09T22:10:00.000Z",
};

describe("Background file picking", () => {
  it("classifies files", () => {
    expect(classifyUserContextFile(new File(["x"], "book.pdf", { type: "application/pdf" }))).toBe("pdf");
    expect(classifyUserContextFile(new File(["x"], "book.PDF", { type: "" }))).toBe("pdf");
    expect(classifyUserContextFile(new File(["x"], "a.docx"))).toBe("document");
    expect(classifyUserContextFile(new File(["x"], "a.epub"))).toBe("document");
    expect(classifyUserContextFile(new File(["x"], "notes.md"))).toBe("text");
    expect(classifyUserContextFile(new File(["x"], "notes.txt", { type: "text/plain" }))).toBe("text");
    expect(classifyUserContextFile(new File(["x"], "page.jpg", { type: "image/jpeg" }))).toBe("image");
    expect(classifyUserContextFile(new File(["x"], "a.zip"))).toBe("unsupported");
  });

  it("blocks PDFs with a clear message and allows text", () => {
    expect(userContextFileRejection(new File(["%PDF"], "novel.pdf", { type: "application/pdf" }))).toBe(
      USER_CONTEXT_PDF_UNSUPPORTED_MESSAGE,
    );
    expect(USER_CONTEXT_PDF_UNSUPPORTED_MESSAGE).toMatch(/new upload pipeline/);
    expect(userContextFileRejection(new File(["x"], "a.docx"))).toMatch(/Word and EPUB/);
    expect(userContextFileRejection(new File(["hello"], "notes.txt", { type: "text/plain" }))).toBe("");
  });
});

describe("deriveUserContextStatus", () => {
  it("shows the user's three stuck PDF cards as No text, not in progress, with no Retry", () => {
    const status = deriveUserContextStatus(stuckNovel, NOW);
    expect(status.state).toBe("no_text");
    expect(status.reason).toBe(USER_CONTEXT_NO_TEXT_MESSAGE);
    expect(status.reason).toBe("No text received, re-upload when book uploads are available.");
    expect(status.retry).toBeNull();
    expect(userContextWordCountLabel(stuckNovel, status)).toBe("no text received");
  });

  it("shows a PDF row the post-#671 server marked complete-with-nothing as No text", () => {
    const row = { ...stuckNovel, processing_complete: true, extracted_summary: "", key_themes: [] };
    expect(deriveUserContextStatus(row, NOW).state).toBe("no_text");
  });

  it("shows a server-recorded pdf_not_supported failure as No text", () => {
    const row = {
      ...stuckNovel,
      processing_status: "failed",
      processing_error: { code: "pdf_not_supported", message: "No text received..." },
    };
    const status = deriveUserContextStatus(row, NOW);
    expect(status.state).toBe("no_text");
    expect(status.retry).toBeNull();
  });

  it("keeps a fresh upload as in progress until the stall timeout", () => {
    const row = {
      id: "c",
      source_kind: "text",
      processing_complete: false,
      processing_status: "processing",
      processing_started_at: new Date(NOW - 60_000).toISOString(),
    };
    expect(deriveUserContextStatus(row, NOW).state).toBe("processing");
    const later = NOW + USER_CONTEXT_STALL_MS;
    const stalled = deriveUserContextStatus(row, later);
    expect(stalled.state).toBe("stalled");
    expect(stalled.label).toBe("Stalled");
    expect(stalled.retry).toBe("file");
  });

  it("offers a server Retry when the analysed excerpt is stored", () => {
    const row = {
      id: "c",
      source_kind: "text",
      analysis_input: "some text",
      processing_complete: false,
      processing_status: "failed",
      processing_error: { code: "analysis_failed", message: "The analysis didn't finish because the model call failed. Try again." },
    };
    const status = deriveUserContextStatus(row, NOW);
    expect(status.state).toBe("failed");
    expect(status.label).toBe("Failed");
    expect(status.reason).toMatch(/model call failed/);
    expect(status.retry).toBe("server");
  });

  it("is Ready only when there is real analysis", () => {
    const row = {
      processing_complete: true,
      processing_status: "complete",
      extracted_summary: "A summary.",
      word_count: 48210,
      analysis_truncated: true,
      analyzed_char_count: 12000,
      source_char_count: 260512,
    };
    const status = deriveUserContextStatus(row, NOW);
    expect(status.state).toBe("ready");
    expect(userContextWordCountLabel(row, status)).toBe("48,210 words");
    expect(userContextTruncationNote(row)).toBe(
      "Summary covers only the first 12,000 of 260,512 characters.",
    );
    expect(userContextTruncationNote({ ...row, analysis_truncated: false })).toBe("");
  });

  it("never shows a made-up 0 words for old rows", () => {
    const legacy = { processing_complete: true, extracted_summary: "Old summary" };
    expect(userContextWordCountLabel(legacy)).toBe("word count not recorded");
    expect(userContextWordCountLabel({ ...legacy, source_kind: "image" })).toBe("image");
    expect(userContextWordCountLabel({ ...legacy, word_count: 1 })).toBe("1 word");
  });
});

describe("runUserContextProcessing", () => {
  it("passes throwOnError and resolves ok on success", async () => {
    const invoke = vi.fn(async () => ({ data: { word_count: 3 } }));
    const updateRecord = vi.fn();
    const out = await runUserContextProcessing({
      invoke,
      updateRecord,
      recordId: "ctx_1",
      payload: { file_content: "a b c" },
    });
    expect(out).toEqual({ ok: true, data: { word_count: 3 } });
    expect(invoke).toHaveBeenCalledWith(
      "processUserContext",
      { file_content: "a b c", user_context_id: "ctx_1" },
      expect.objectContaining({ throwOnError: true }),
    );
    expect(updateRecord).not.toHaveBeenCalled();
  });

  it("marks the row failed itself when the server couldn't (500 / network)", async () => {
    const err = Object.assign(new Error("Internal server error"), { status: 500 });
    const invoke = vi.fn(async () => {
      throw err;
    });
    const updateRecord = vi.fn(async () => ({}));
    const out = await runUserContextProcessing({ invoke, updateRecord, recordId: "ctx_1", payload: {} });
    expect(out.ok).toBe(false);
    expect(out.message).toBe("Internal server error");
    expect(updateRecord).toHaveBeenCalledWith("ctx_1", {
      processing_status: "failed",
      processing_error: { code: "request_failed", message: "Internal server error", retryable: true },
    });
  });

  it("leaves the server's own failure record alone", async () => {
    const err = Object.assign(new Error("The model returned no usable analysis. Try again."), {
      status: 502,
      code: "analysis_empty",
    });
    const updateRecord = vi.fn();
    const out = await runUserContextProcessing({
      invoke: async () => {
        throw err;
      },
      updateRecord,
      recordId: "ctx_1",
      payload: {},
    });
    expect(out).toMatchObject({ ok: false, code: "analysis_empty" });
    expect(updateRecord).not.toHaveBeenCalled();
  });

  it("says when the client gave up waiting", async () => {
    const err = Object.assign(new Error("signal timed out"), { name: "TimeoutError" });
    const out = await runUserContextProcessing({
      invoke: async () => {
        throw err;
      },
      updateRecord: vi.fn(async () => ({})),
      recordId: "ctx_1",
      payload: {},
    });
    expect(out.message).toMatch(/took too long/);
  });
});
