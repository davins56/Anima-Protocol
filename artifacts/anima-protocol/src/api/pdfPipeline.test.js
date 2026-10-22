import { describe, expect, it } from "vitest";
import { isPdfActive, pdfStatusLabel } from "./pdfPipeline";

describe("PDF pipeline status helpers", () => {
  it("labels in-flight stages and shows the server's reason on failure", () => {
    expect(pdfStatusLabel({ status: "extracting" })).toMatch(/reading text/i);
    expect(pdfStatusLabel({ status: "embedding" })).toMatch(/indexing/i);
    expect(pdfStatusLabel({ status: "failed", error: "This PDF has no extractable text." })).toBe(
      "This PDF has no extractable text.",
    );
    expect(pdfStatusLabel({ status: "failed" })).toMatch(/couldn't read/i);
    // Ready (and rows from before the pipeline, which have no status) show the page count.
    expect(pdfStatusLabel({ status: "ready" })).toBeNull();
    expect(pdfStatusLabel({})).toBeNull();
  });

  it("polls only while a file is still being processed", () => {
    for (const status of ["uploaded", "extracting", "chunking", "embedding"]) {
      expect(isPdfActive({ status })).toBe(true);
    }
    expect(isPdfActive({ status: "ready" })).toBe(false);
    expect(isPdfActive({ status: "failed" })).toBe(false);
    expect(isPdfActive({})).toBe(false);
  });
});
