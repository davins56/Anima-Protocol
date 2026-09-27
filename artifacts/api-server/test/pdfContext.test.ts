import { describe, expect, it } from "vitest";
import { chunkPdfPages } from "../src/lib/pdf/chunk";
import {
  buildPdfRetrievalSql,
  capPdfPromptBlock,
  chatMayIncludePdfContext,
  packPdfContext,
  pdfSearchTerms,
  pdfWordCount,
  safeEntityId,
  sanitizePdfFilename,
} from "../src/lib/pdf/context";
import { extractPdfPages } from "../src/lib/pdf/extract";
import { PDF_CONTEXT_WORD_BUDGET, PDF_MAX_PAGES } from "../src/lib/pdf/limits";
import {
  composeCompanionChatMessages,
  composePrompt,
  LLM_CHAT_HISTORY_MAX_CHARS,
  LLM_CHAT_HISTORY_MAX_MESSAGES,
} from "../src/lib/promptBuilder";
import { buildTextPdf } from "./pdfFixture";

const character = {
  id: "char_1",
  name: "Serenity",
  personality: "Calm and exact",
  backstory: "A guide who remembers what she is shown.",
  speaking_style: "Soft and precise",
};

describe("PDF extraction", () => {
  it("reads selectable text from a real PDF", async () => {
    const extracted = await extractPdfPages(
      buildTextPdf(["The dragon keeps the silver key."]),
    );
    expect(extracted.pageCount).toBe(1);
    expect(extracted.pages[0]).toContain("silver key");
  });

  it("rejects a PDF with no extractable text", async () => {
    const blank = buildTextPdf([""]);
    await expect(extractPdfPages(blank)).rejects.toMatchObject({
      code: "pdf_no_text",
      status: 422,
    });
  });

  it("rejects files that are not PDFs and PDFs over the page cap", async () => {
    await expect(extractPdfPages(new Uint8Array([1, 2, 3, 4]))).rejects.toMatchObject({
      code: "pdf_not_pdf",
    });
    const tooMany = buildTextPdf(
      Array.from({ length: PDF_MAX_PAGES + 1 }, (_, i) => `Page ${i + 1} notes.`),
    );
    await expect(extractPdfPages(tooMany)).rejects.toMatchObject({
      code: "pdf_too_many_pages",
      status: 413,
    });
  });
});

describe("PDF chunking", () => {
  it("splits long text and keeps page numbers", () => {
    const page = "alpha ".repeat(400);
    const chunks = chunkPdfPages([page.trim(), "The silver key is in the north gate."], {
      target: 200,
      overlap: 40,
    });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]?.pageStart).toBe(1);
    expect(chunks.at(-1)?.content).toContain("silver key");
    expect(chunks.at(-1)?.pageEnd).toBe(2);
    for (let i = 1; i < chunks.length; i += 1) {
      expect(chunks[i]!.chunkIndex).toBe(i);
    }
  });
});

describe("PDF retrieval and prompt budget", () => {
  it("binds the user id and never interpolates the message into SQL", () => {
    const message = "Where is the silver key?'; DROP TABLE pdf_chunks; --";
    const sql = buildPdfRetrievalSql({
      userId: "user_owner",
      sessionId: "sess_1",
      characterIds: ["char_1", "bad id", "char_2"],
      tsQuery: pdfSearchTerms(message).length
        ? "silver:* | key:*"
        : null,
      mode: "search",
    });
    expect(sql).not.toBeNull();
    expect(sql!.values[0]).toBe("user_owner");
    expect(sql!.text).toContain("c.user_id = $1");
    expect(sql!.text).toContain("d.user_id = $1");
    expect(sql!.text).not.toContain("user_owner");
    expect(sql!.text).not.toContain("DROP TABLE");
    expect(sql!.text).not.toContain("silver key");
    expect(sql!.text).toContain("to_tsquery('english'");
    expect(sql!.text).toContain("search_vector");
    expect(sql!.text).not.toMatch(/embedding|vectorize|ollama/i);
    expect(sql!.values).toContain("char_1");
    expect(sql!.values).not.toContain("bad id");
    expect(safeEntityId("user' OR 1=1")).toBeNull();
  });

  it("keeps chat and lore excerpts inside one word budget", () => {
    const chatWords = Array.from({ length: 800 }, (_, i) => `chat${i}`).join(" ");
    const loreWords = Array.from({ length: 800 }, (_, i) => `lore${i}`).join(" ");
    const packed = packPdfContext({
      files: [
        { filename: "notes.pdf", scope: "chat", pageCount: 2 },
        { filename: "novel.pdf", scope: "lore", pageCount: 40 },
      ],
      hits: [
        {
          filename: "notes.pdf",
          scope: "chat",
          pageStart: 1,
          pageEnd: 1,
          content: chatWords,
          rank: 2,
        },
        {
          filename: "novel.pdf",
          scope: "lore",
          pageStart: 3,
          pageEnd: 4,
          content: loreWords,
          rank: 1,
        },
      ],
    });
    expect(pdfWordCount(packed)).toBeLessThanOrEqual(PDF_CONTEXT_WORD_BUDGET);
    expect(pdfWordCount(packed)).toBeGreaterThan(700);
    expect(packed).toContain("chat0");
    expect(packed).toContain("lore0");
    expect(packed).toContain("notes.pdf");
    expect(packed).toContain("novel.pdf");
    expect(pdfWordCount(capPdfPromptBlock(`${"Q ".repeat(5_000)}`))).toBeLessThanOrEqual(
      PDF_CONTEXT_WORD_BUDGET,
    );
    expect(pdfWordCount(capPdfPromptBlock("Z".repeat(50_000)))).toBeLessThanOrEqual(
      PDF_CONTEXT_WORD_BUDGET,
    );
  });

  it("adds the capped excerpt to the system prompt and not to replayed history", () => {
    const marker = "SILVERKEYUNIQUE";
    const pdfContext = `${marker} ${"y ".repeat(PDF_CONTEXT_WORD_BUDGET + 400)}`;
    const recent = Array.from({ length: 20 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `turn ${i} ${"h".repeat(800)}`,
    }));
    const messages = composeCompanionChatMessages({
      characters: [character],
      activeCharacter: character,
      memories: [],
      recentMessages: recent,
      content: "What about the key?",
      mode: "solo",
      pdfContext,
    });
    const system = messages.find((message) => message.role === "system")?.content || "";
    expect(system).toContain(marker);
    const afterMarker = system.slice(system.indexOf(marker));
    const excerpt = afterMarker.match(/^SILVERKEYUNIQUE(?:\s+y)+/)?.[0] ?? "";
    expect(pdfWordCount(excerpt)).toBeGreaterThan(0);
    expect(pdfWordCount(excerpt)).toBeLessThanOrEqual(PDF_CONTEXT_WORD_BUDGET);
    expect(pdfWordCount(excerpt)).toBeLessThan(PDF_CONTEXT_WORD_BUDGET + 400);
    const replay = messages.filter((message) => message.role !== "system");
    expect(replay.map((message) => message.content).join("\n")).not.toContain(marker);
    const history = replay.filter((message) => message.content.startsWith("turn "));
    expect(history.length).toBeLessThanOrEqual(LLM_CHAT_HISTORY_MAX_MESSAGES);
    for (const message of history) {
      expect(message.content.length).toBeLessThanOrEqual(LLM_CHAT_HISTORY_MAX_CHARS);
    }
  });

  it("caps a huge pdfContext inside composePrompt", () => {
    const prompt = composePrompt({
      characters: [character],
      activeCharacter: character,
      memories: [],
      recentMessages: [],
      content: "hello",
      mode: "solo",
      pdfContext: "zeta ".repeat(PDF_CONTEXT_WORD_BUDGET + 500),
    });
    const start = prompt.indexOf("zeta");
    expect(start).toBeGreaterThan(-1);
    const run = prompt.slice(start).match(/^(?:zeta\s+)+/)?.[0] || "";
    expect(pdfWordCount(run)).toBeLessThanOrEqual(PDF_CONTEXT_WORD_BUDGET);
    expect(pdfWordCount(run)).toBeGreaterThan(100);
  });

  it("sends PDF text only when the provider chain is local-only", () => {
    expect(chatMayIncludePdfContext(["local"])).toBe(true);
    expect(chatMayIncludePdfContext(["local", "openrouter"])).toBe(false);
    expect(chatMayIncludePdfContext(["workersai"])).toBe(false);
    expect(chatMayIncludePdfContext([])).toBe(false);
  });

  it("strips path tricks from filenames", () => {
    expect(sanitizePdfFilename("../../etc/passwd")).toBe("passwd.pdf");
    expect(sanitizePdfFilename("world bible.pdf")).toBe("world bible.pdf");
  });
});
