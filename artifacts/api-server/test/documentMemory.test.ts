import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  buildDocumentChunkEvents,
  documentMemoryEnabled,
  documentRecallLabel,
  DOCUMENT_MEMORY_MAX_CHUNKS,
} from "../src/lib/pdf/documentMemory";
import { documentObjectPath } from "../src/lib/pdf/documentStorage";
import { formatMemoryCoreBlock } from "../src/lib/memoryCore/sessionContext";
import { MEMORY_EVENT_TYPES } from "../src/lib/memoryCore/memoryCore";

const chunks = [
  { chunkIndex: 0, pageStart: 1, pageEnd: 1, content: "  The   lighthouse keeper's log. " },
  { chunkIndex: 1, pageStart: 1, pageEnd: 2, content: "" },
  { chunkIndex: 2, pageStart: 2, pageEnd: 3, content: "Storm season begins in March." },
];

describe("document memory", () => {
  it("turns chunks into idempotent document_chunk events", () => {
    const ev = buildDocumentChunkEvents({
      userId: "u1", characterId: "c1", documentId: "d1", filename: "log.pdf",
      scope: "chat", sessionId: "s1", chunks,
    });
    expect(ev).toHaveLength(2);
    expect(ev[0]).toMatchObject({
      eventType: "document_chunk",
      content: "The lighthouse keeper's log.",
      dedupeKey: "doc:d1:0",
      conversationId: "s1",
      source: "pdf_upload",
    });
    expect(ev[1].payload).toMatchObject({ document_id: "d1", chunk_index: 2, page_start: 2, page_end: 3, filename: "log.pdf" });
  });

  it("lore PDFs have no conversation and weigh a bit more; chunk count is capped", () => {
    const many = Array.from({ length: DOCUMENT_MEMORY_MAX_CHUNKS + 10 }, (_, i) => ({ chunkIndex: i, pageStart: 1, pageEnd: 1, content: `c${i}` }));
    const ev = buildDocumentChunkEvents({ userId: "u", characterId: "c", documentId: "d", filename: "f", scope: "lore", sessionId: null, chunks: many });
    expect(ev).toHaveLength(DOCUMENT_MEMORY_MAX_CHUNKS);
    expect(ev[0].conversationId).toBeNull();
    expect(ev[0].emotionalWeight).toBeGreaterThan(0.35);
  });

  it("labels recalled chunks with filename and pages in the prompt block", () => {
    expect(documentRecallLabel({ document_id: "d", filename: "log.pdf", page_start: 2, page_end: 3 })).toBe('from "log.pdf" pp. 2–3');
    expect(documentRecallLabel({ document_id: "d", filename: "log.pdf", page_start: 4, page_end: 4 })).toBe('from "log.pdf" p. 4');
    expect(documentRecallLabel({})).toBeNull();
    const block = formatMemoryCoreBlock(null, [
      { id: "m1", event_type: "document_chunk", content: "Storm season begins in March.", payload: { document_id: "d", filename: "log.pdf", page_start: 2, page_end: 2 },
        conversation_id: null, occurred_at: new Date().toISOString(), emotional_weight: 0.35, similarity: 0.9, recency: 1, score: 0.8 },
    ]);
    expect(block).toContain('from "log.pdf" p. 2');
    expect(block).toContain("Storm season");
  });

  it("respects the kill switches", () => {
    expect(documentMemoryEnabled({ ANIMA_DOCUMENT_MEMORY: "off" } as NodeJS.ProcessEnv)).toBe(false);
    expect(documentMemoryEnabled({ ANIMA_MEMORY_CORE: "off" } as NodeJS.ProcessEnv)).toBe(false);
    expect(documentMemoryEnabled({} as NodeJS.ProcessEnv)).toBe(true);
  });

  it("stores objects under the owner's folder (matches the RLS policy)", () => {
    expect(documentObjectPath("user_2abc", "d-1")).toBe("user_2abc/d-1.pdf");
    expect(documentObjectPath("../x", "d")).toBe("___x/d.pdf");
  });

  it("migration is append-only and owner-scoped", () => {
    const sql = readFileSync(new URL("../../../supabase/migrations/20261022260000_document_memory.sql", import.meta.url), "utf8");
    expect(sql).toContain("'document_chunk'");
    expect(sql).toMatch(/'companion-documents', 'companion-documents', false/);
    expect(sql).toContain("(storage.foldername(name))[1] = (auth.jwt() ->> 'sub')");
    expect(sql).not.toMatch(/UPDATE\s+public\.memory_events|DELETE\s+FROM\s+public\.memory_events/i);
    expect(MEMORY_EVENT_TYPES).toContain("document_chunk");
  });
});
