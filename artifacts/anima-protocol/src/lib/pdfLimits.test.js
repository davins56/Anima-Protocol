import { describe, expect, it } from "vitest";
import { PDF_MAX_BYTES, PDF_MAX_PAGES, pdfFileRejection } from "./pdfLimits";

describe("pdfFileRejection", () => {
  it("accepts a normal PDF and rejects the wrong type or a huge file", () => {
    expect(PDF_MAX_BYTES).toBe(4 * 1024 * 1024);
    expect(PDF_MAX_PAGES).toBe(80);
    expect(
      pdfFileRejection({ name: "notes.pdf", type: "application/pdf", size: 1200 }),
    ).toBeNull();
    expect(
      pdfFileRejection({ name: "photo.jpg", type: "image/jpeg", size: 1200 }),
    ).toMatch(/isn't a PDF/i);
    expect(
      pdfFileRejection({ name: "huge.pdf", type: "application/pdf", size: PDF_MAX_BYTES + 1 }),
    ).toMatch(/too large[\s\S]*4 MB/i);
    expect(
      pdfFileRejection({ name: "Scan.PDF", type: "", size: 10 }),
    ).toBeNull();
  });
});
