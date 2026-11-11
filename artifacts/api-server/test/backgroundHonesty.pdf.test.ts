import { describe, expect, it, vi, beforeEach } from "vitest";

// createPdfDocument talks to Postgres through getPool(); a fake pool lets the
// test see every statement without the pdf_* tables in the test schema.
const queries = vi.hoisted(() => [] as { text: string; values: unknown[] }[]);
vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    ensureSchemaOnce: vi.fn(async () => undefined),
    withTransientDbRetry: async <T>(run: () => Promise<T>) => run(),
    getPool: () => ({
      query: async (text: string, values: unknown[] = []) => {
        queries.push({ text, values });
        if (/FROM user_entities/i.test(text)) return { rows: [{ ok: 1 }] };
        if (/count\(\*\)/i.test(text)) return { rows: [{ n: 0 }] };
        return { rows: [] };
      },
    }),
  };
});

import {
  chunkPdfPages,
  chunkPdfPagesDetailed,
  pdfChunkCapMessage,
} from "../src/lib/pdf/chunk";
import {
  PDF_CHUNK_OVERLAP_CHARS,
  PDF_CHUNK_TARGET_CHARS,
  PDF_MAX_CHUNKS,
  PDF_MAX_EXTRACTED_CHARS,
  PDF_MAX_PAGES,
} from "../src/lib/pdf/limits";
import { createPdfDocument } from "../src/lib/pdf/store";
import { payloadTooLargeMessage } from "../src/lib/payloadTooLarge";
import { buildTextPdf } from "./pdfFixture";

function wordsOfLength(chars: number): string {
  return "lorem ".repeat(Math.ceil(chars / 6)).slice(0, chars).trim();
}

describe("lore PDF chunk cap", () => {
  beforeEach(() => {
    queries.length = 0;
  });

  it("text under the 100k extract cap can exceed what 120 chunks hold (the old silent drop)", () => {
    const step = PDF_CHUNK_TARGET_CHARS - PDF_CHUNK_OVERLAP_CHARS;
    const roughCapacity = (PDF_MAX_CHUNKS - 1) * step + PDF_CHUNK_TARGET_CHARS;
    expect(roughCapacity).toBeLessThan(PDF_MAX_EXTRACTED_CHARS);
    const pages = Array.from({ length: 80 }, () => wordsOfLength(1_220));
    const total = pages.reduce((n, p) => n + p.length, 0);
    expect(total).toBeLessThanOrEqual(PDF_MAX_EXTRACTED_CHARS);
    const result = chunkPdfPagesDetailed(pages);
    expect(result.chunks).toHaveLength(PDF_MAX_CHUNKS);
    expect(result.truncated).toBe(true);
    expect(result.coveredChars).toBeLessThan(result.totalChars);
    // The legacy helper still returns the same chunks.
    expect(chunkPdfPages(pages)).toEqual(result.chunks);
  });

  it("reports full coverage when the text fits", () => {
    const result = chunkPdfPagesDetailed([wordsOfLength(5_000)]);
    expect(result.truncated).toBe(false);
    expect(result.coveredChars).toBe(result.totalChars);
    expect(chunkPdfPagesDetailed([""]).truncated).toBe(false);
  });

  it("says how much would be kept and that nothing was saved", () => {
    expect(pdfChunkCapMessage(96_100, 97_600)).toBe(
      "This PDF has too much text for one file. Only the first 96,100 of 97,600 characters would fit, so it wasn't saved. Split it into smaller files.",
    );
  });

  it("rejects a lore PDF the chunk cap would cut short, before any INSERT", async () => {
    // 80 pages x 10 lines x 120 chars: ~95,900 extracted chars, under the
    // 100k cap and the 80-page cap, but more than 120 chunks reach.
    const line = wordsOfLength(120);
    const pages = Array.from({ length: PDF_MAX_PAGES }, () =>
      Array.from({ length: 10 }, () => line).join("\n"),
    );
    const pdf = buildTextPdf(pages);
    await expect(
      createPdfDocument({
        userId: "user_chunkcap",
        scope: "lore",
        characterId: "char_chunkcap",
        filename: "dense-lore.pdf",
        dataBase64: Buffer.from(pdf).toString("base64"),
      }),
    ).rejects.toMatchObject({
      code: "pdf_too_much_text",
      status: 413,
      message: expect.stringMatching(/Only the first [\d,]+ of [\d,]+ characters would fit, so it wasn't saved/),
    });
    expect(queries.some((q) => /INSERT INTO pdf_/i.test(q.text))).toBe(false);
  });

  it("still stores a lore PDF that fits", async () => {
    const pdf = buildTextPdf(["The dragon keeps the silver key under the north gate."]);
    await createPdfDocument({
      userId: "user_chunkcap",
      scope: "lore",
      characterId: "char_chunkcap",
      filename: "short-lore.pdf",
      dataBase64: Buffer.from(pdf).toString("base64"),
    }).catch(() => undefined);
    expect(queries.some((q) => /INSERT INTO pdf_documents/i.test(q.text))).toBe(true);
  });
});

describe("413 payload_too_large message", () => {
  it("names the right kind of upload", () => {
    expect(payloadTooLargeMessage("/api/pdfs")).toBe("That PDF is too large. The limit is 4 MB.");
    expect(payloadTooLargeMessage("/pdfs")).toBe("That PDF is too large. The limit is 4 MB.");
    expect(payloadTooLargeMessage("/api/storage/uploads")).toBe(
      "That image is too large. Try a smaller photo.",
    );
    expect(payloadTooLargeMessage("/api/openai/invoke/processUserContext")).toBe(
      "That upload is too large. Try a smaller file.",
    );
    expect(payloadTooLargeMessage("")).toBe("That upload is too large. Try a smaller file.");
  });
});
