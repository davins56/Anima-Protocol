import { afterEach, describe, expect, it, vi } from "vitest";
import { chunkPdfPages, estimateTokens, type PdfChunkDraft } from "../src/lib/pdf/chunk";
import { PdfUploadError } from "../src/lib/pdf/errors";
import { isAcceptedPdfMime, sha256Hex, validatePdfUpload } from "../src/lib/pdf/extract";
import { PDF_EMBED_BATCH, PDF_MAX_BASE64_BYTES, pdfMaxBytes } from "../src/lib/pdf/limits";
import {
  embedPendingChunks,
  pdfEmbedderAvailable,
  pdfEmbedProvider,
  runPdfPipeline,
  type PdfPipelineDeps,
  type PdfPipelineDoc,
  type PdfPipelineRepo,
  type PdfStatus,
  type PdfStatusPatch,
} from "../src/lib/pdf/pipeline";
import { pdfObjectPath, supabasePdfStore, type PdfBlobStore } from "../src/lib/pdf/pdfStorage";
import { fusePdfHits } from "../src/lib/pdf/store";
import { chunkId } from "../src/lib/pdf/pipelineRepo";
import type { PdfHit } from "../src/lib/pdf/context";
import { buildTextPdf } from "./pdfFixture";

// ── In-memory fakes ───────────────────────────────────────────────────────

type MemDoc = PdfPipelineDoc & { processingStartedAt: number | null; embeddingModel: string | null };

function memoryRepo(initial: Partial<MemDoc> = {}) {
  const doc: MemDoc = {
    id: "doc1",
    userId: "user_a",
    scope: "lore",
    sessionId: null,
    characterId: "char_1",
    filename: "lore.pdf",
    status: "uploaded",
    pageCount: 0,
    chunkCount: 0,
    embeddedChunkCount: 0,
    storageBucket: null,
    storagePath: null,
    attempts: 0,
    error: null,
    errorCode: null,
    processingStartedAt: null,
    embeddingModel: null,
    ...initial,
  };
  const docs = new Map<string, MemDoc>([[doc.id, doc]]);
  const chunks = new Map<string, { id: string; documentId: string; content: string; index: number }>();
  const vectors = new Map<string, { chunkId: string; model: string }>();
  const history: PdfStatus[] = [];
  const failures: { replaceChunks?: Error; pending?: Error } = {};

  const own = (id: string, userId: string) => {
    const d = docs.get(id);
    return d && d.userId === userId ? d : null;
  };
  const snapshot = (d: MemDoc): PdfPipelineDoc => ({ ...d });

  const repo: PdfPipelineRepo = {
    async get(id, userId) {
      const d = own(id, userId);
      return d ? snapshot(d) : null;
    },
    async claim(id, userId, staleMs) {
      const d = own(id, userId);
      if (!d) return null;
      const stale =
        (d.status === "extracting" || d.status === "chunking") &&
        d.processingStartedAt !== null &&
        Date.now() - d.processingStartedAt > staleMs;
      if (!(d.status === "uploaded" || d.status === "failed" || stale)) return null;
      d.status = "extracting";
      d.attempts += 1;
      d.processingStartedAt = Date.now();
      d.error = null;
      d.errorCode = null;
      history.push("extracting");
      return snapshot(d);
    },
    async setStatus(id, userId, status, patch: PdfStatusPatch = {}) {
      const d = own(id, userId);
      if (!d) return;
      d.status = status;
      history.push(status);
      if (patch.pageCount !== undefined) d.pageCount = patch.pageCount;
      if (patch.chunkCount !== undefined) d.chunkCount = patch.chunkCount;
      if (patch.embeddedChunkCount !== undefined) d.embeddedChunkCount = patch.embeddedChunkCount;
      if (patch.embeddingModel !== undefined) d.embeddingModel = patch.embeddingModel;
      if (patch.error !== undefined) d.error = patch.error;
      if (patch.errorCode !== undefined) d.errorCode = patch.errorCode;
      if (status === "ready" || status === "failed") d.processingStartedAt = null;
    },
    async replaceChunks(d, drafts: PdfChunkDraft[]) {
      if (failures.replaceChunks) throw failures.replaceChunks;
      for (const [id, c] of chunks) {
        if (c.documentId === d.id) {
          chunks.delete(id);
          vectors.delete(id);
        }
      }
      for (const draft of drafts) {
        const id = chunkId(d.id, d.attempts, draft.chunkIndex);
        chunks.set(id, { id, documentId: d.id, content: draft.content, index: draft.chunkIndex });
      }
    },
    async pendingEmbeddingChunks(id, _userId, limit) {
      if (failures.pending) throw failures.pending;
      return [...chunks.values()]
        .filter((c) => c.documentId === id && !vectors.has(c.id))
        .sort((a, b) => a.index - b.index)
        .slice(0, limit)
        .map((c) => ({ id: c.id, content: c.content }));
    },
    async insertEmbeddings(_id, _userId, rows) {
      for (const row of rows) {
        if (chunks.has(row.chunkId) && !vectors.has(row.chunkId)) {
          vectors.set(row.chunkId, { chunkId: row.chunkId, model: row.model });
        }
      }
    },
    async countEmbedded(id) {
      return [...vectors.keys()].filter((key) => chunks.get(key)?.documentId === id).length;
    },
  };
  return { repo, doc, docs, chunks, vectors, history, failures };
}

function memoryBlobs(bytes: Uint8Array | null): PdfBlobStore & { gets: number } {
  const store = {
    kind: "postgres" as const,
    gets: 0,
    async put() {
      return { bucket: null, path: null };
    },
    async get() {
      store.gets += 1;
      return bytes ? bytes.slice() : null;
    },
    async remove() {},
  };
  return store;
}

function fakeEmbedder(opts: { failAfterCalls?: number; down?: boolean } = {}) {
  const calls: string[][] = [];
  const embed = vi.fn(async (texts: string[]) => {
    calls.push(texts);
    if (opts.down) return null;
    if (opts.failAfterCalls !== undefined && calls.length > opts.failAfterCalls) return null;
    return texts.map(() => ({ vector: new Array(768).fill(0.01), model: "local:nomic-embed-text" }));
  });
  return { embed, calls };
}

function longPages(pageCount: number, sentencesPerPage = 30): string[] {
  return Array.from({ length: pageCount }, (_, p) =>
    Array.from(
      { length: sentencesPerPage },
      (_, i) => `Page ${p + 1} sentence ${i + 1} tells of the harbor bell and the silver key.`,
    ).join(" "),
  );
}

function depsFor(
  mem: ReturnType<typeof memoryRepo>,
  overrides: Partial<PdfPipelineDeps> = {},
): PdfPipelineDeps {
  return {
    repo: mem.repo,
    blobs: () => memoryBlobs(buildTextPdf(["unused"])),
    embed: fakeEmbedder().embed,
    embedderAvailable: () => true,
    extract: async () => ({ pageCount: 3, pages: longPages(3) }),
    ...overrides,
  };
}

// ── Chunker ───────────────────────────────────────────────────────────────

describe("PDF chunker", () => {
  it("overlaps neighbouring chunks and never starts mid-word", () => {
    const chunks = chunkPdfPages(longPages(2), { target: 300, overlap: 80 });
    expect(chunks.length).toBeGreaterThan(3);
    for (let i = 1; i < chunks.length; i += 1) {
      const prev = chunks[i - 1]!.content;
      const head = chunks[i]!.content.split(" ").slice(0, 3).join(" ");
      expect(prev).toContain(head); // overlap carried over
      expect(chunks[i]!.content[0]).not.toBe(" ");
      expect(chunks[i]!.content.length).toBeLessThanOrEqual(300);
    }
  });

  it("prefers sentence ends for the split", () => {
    const chunks = chunkPdfPages(longPages(1), { target: 300, overlap: 0 });
    for (const chunk of chunks.slice(0, -1)) expect(chunk.content.endsWith(".")).toBe(true);
  });

  it("tracks page ranges across page boundaries", () => {
    const chunks = chunkPdfPages(["alpha beta gamma.", "", "delta epsilon zeta."], { target: 60, overlap: 0 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ pageStart: 1, pageEnd: 3 });
    const many = chunkPdfPages(longPages(4), { target: 400, overlap: 50 });
    expect(many[0]!.pageStart).toBe(1);
    expect(many.at(-1)!.pageEnd).toBe(4);
    for (const chunk of many) expect(chunk.pageEnd).toBeGreaterThanOrEqual(chunk.pageStart);
    expect(many.some((c) => c.pageEnd > c.pageStart)).toBe(true);
  });

  it("estimates tokens and stays deterministic (idempotent re-chunking)", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("a".repeat(900))).toBe(225);
    const a = chunkPdfPages(longPages(3));
    const b = chunkPdfPages(longPages(3));
    expect(a).toEqual(b);
    for (const chunk of a) expect(chunk.tokenCount).toBe(estimateTokens(chunk.content));
  });

  it("caps the number of chunks and handles empty input", () => {
    expect(chunkPdfPages(["", "   "])).toEqual([]);
    expect(chunkPdfPages(longPages(5), { target: 100, overlap: 10, maxChunks: 7 })).toHaveLength(7);
  });
});

// ── Validation ────────────────────────────────────────────────────────────

describe("PDF upload validation", () => {
  const pdf = buildTextPdf(["hello"]);

  it("accepts real PDFs with a PDF or generic MIME", () => {
    expect(() => validatePdfUpload({ bytes: pdf, contentType: "application/pdf" })).not.toThrow();
    expect(() => validatePdfUpload({ bytes: pdf, contentType: "application/octet-stream" })).not.toThrow();
    expect(() => validatePdfUpload({ bytes: pdf })).not.toThrow();
    expect(isAcceptedPdfMime("application/pdf; charset=binary")).toBe(true);
  });

  it("rejects a non-PDF MIME even when the bytes look right", () => {
    expect(() => validatePdfUpload({ bytes: pdf, contentType: "image/png" })).toThrow(
      expect.objectContaining({ code: "pdf_not_pdf", status: 415 }),
    );
  });

  it("checks %PDF- magic bytes, emptiness, and the size cap", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
    expect(() => validatePdfUpload({ bytes: png, contentType: "application/pdf" })).toThrow(
      expect.objectContaining({ code: "pdf_not_pdf", status: 400 }),
    );
    expect(() => validatePdfUpload({ bytes: new Uint8Array() })).toThrow(
      expect.objectContaining({ code: "pdf_empty" }),
    );
    expect(() => validatePdfUpload({ bytes: pdf, maxBytes: 16 })).toThrow(
      expect.objectContaining({ code: "pdf_too_large", status: 413 }),
    );
    const preamble = new Uint8Array(600 + pdf.length);
    preamble.set(pdf, 600); // header inside the first 1024 bytes is valid
    expect(() => validatePdfUpload({ bytes: preamble })).not.toThrow();
  });

  it("uses 20 MB for raw uploads, 4 MB for base64 JSON, and honours ANIMA_PDF_MAX_BYTES", () => {
    expect(pdfMaxBytes({})).toBe(20 * 1024 * 1024);
    expect(pdfMaxBytes({ ANIMA_PDF_MAX_BYTES: "1048576" })).toBe(1048576);
    expect(pdfMaxBytes({ ANIMA_PDF_MAX_BYTES: String(99 * 1024 * 1024) })).toBe(20 * 1024 * 1024);
    expect(pdfMaxBytes({ ANIMA_PDF_MAX_BYTES: "nope" })).toBe(20 * 1024 * 1024);
    expect(PDF_MAX_BASE64_BYTES).toBe(4 * 1024 * 1024);
  });

  it("hashes content stably for idempotent re-uploads", () => {
    expect(sha256Hex(pdf)).toBe(sha256Hex(pdf.slice()));
    expect(sha256Hex(pdf)).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256Hex(buildTextPdf(["other"]))).not.toBe(sha256Hex(pdf));
  });
});

// ── Pipeline ──────────────────────────────────────────────────────────────

describe("PDF pipeline", () => {
  it("walks uploaded → extracting → chunking → embedding → ready and embeds every chunk", async () => {
    const mem = memoryRepo();
    const embedder = fakeEmbedder();
    const onReady = vi.fn(async () => {});
    const result = await runPdfPipeline(depsFor(mem, { embed: embedder.embed, onReady }), {
      documentId: "doc1",
      userId: "user_a",
      embed: "inline",
    });
    expect(result.error).toBeUndefined();
    expect(mem.history).toEqual(["extracting", "chunking", "embedding", "ready"]);
    expect(mem.doc.status).toBe("ready");
    expect(mem.doc.pageCount).toBe(3);
    expect(mem.doc.chunkCount).toBe(mem.chunks.size);
    expect(mem.vectors.size).toBe(mem.chunks.size);
    expect(mem.doc.embeddedChunkCount).toBe(mem.chunks.size);
    expect(mem.doc.embeddingModel).toBe("local:nomic-embed-text");
    for (const batch of embedder.calls) expect(batch.length).toBeLessThanOrEqual(PDF_EMBED_BATCH);
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it("reads the original from storage when no bytes are passed", async () => {
    const mem = memoryRepo();
    const blobs = memoryBlobs(buildTextPdf(["The silver key opens the north gate."]));
    const result = await runPdfPipeline(
      { ...depsFor(mem), blobs: () => blobs, extract: undefined },
      { documentId: "doc1", userId: "user_a", embed: "inline" },
    );
    expect(blobs.gets).toBe(1);
    expect(result.doc?.status).toBe("ready");
    expect([...mem.chunks.values()][0]!.content).toContain("silver key");
  });

  it("marks a missing original as a permanent failure", async () => {
    const mem = memoryRepo();
    const result = await runPdfPipeline(
      { ...depsFor(mem), blobs: () => memoryBlobs(null) },
      { documentId: "doc1", userId: "user_a" },
    );
    expect(result).toMatchObject({ permanent: true, error: { code: "pdf_file_missing" } });
    expect(mem.doc.status).toBe("failed");
  });

  it("fails permanently on an unreadable file and keeps the user-facing reason", async () => {
    const mem = memoryRepo();
    const result = await runPdfPipeline(
      depsFor(mem, {
        extract: async () => {
          throw new PdfUploadError("This PDF has no extractable text.", "pdf_no_text", 422);
        },
      }),
      { documentId: "doc1", userId: "user_a", bytes: new Uint8Array([1]) },
    );
    expect(result.permanent).toBe(true);
    expect(mem.doc).toMatchObject({ status: "failed", errorCode: "pdf_no_text" });
    expect(mem.chunks.size).toBe(0);
  });

  it("turns an infrastructure error into a retryable failure, then recovers idempotently", async () => {
    const mem = memoryRepo();
    mem.failures.replaceChunks = Object.assign(new Error("ECONNRESET"), { code: "ECONNRESET" });
    const first = await runPdfPipeline(depsFor(mem), { documentId: "doc1", userId: "user_a", bytes: new Uint8Array([1]) });
    expect(first).toMatchObject({ permanent: false, error: { code: "pdf_pipeline_error" } });
    expect(mem.doc.status).toBe("failed");
    expect(mem.doc.error).not.toMatch(/ECONNRESET/); // no internals leak to the user

    delete mem.failures.replaceChunks;
    const second = await runPdfPipeline(depsFor(mem), { documentId: "doc1", userId: "user_a", embed: "inline" });
    expect(second.doc?.status).toBe("ready");
    expect(mem.doc.attempts).toBe(2);
    expect([...mem.chunks.keys()].every((id) => id.startsWith("doc1:2:"))).toBe(true);

    // Re-running a finished document is a no-op (claim refuses, nothing re-chunked).
    const before = [...mem.chunks.keys()];
    const third = await runPdfPipeline(depsFor(mem), { documentId: "doc1", userId: "user_a", embed: "inline" });
    expect(third.doc?.status).toBe("ready");
    expect([...mem.chunks.keys()]).toEqual(before);
  });

  it("never processes a document another run is working on, but reclaims a stale one", async () => {
    const mem = memoryRepo({ status: "extracting", processingStartedAt: Date.now() });
    const extract = vi.fn(async () => ({ pageCount: 1, pages: ["fresh text here."] }));
    const busy = await runPdfPipeline(depsFor(mem, { extract }), { documentId: "doc1", userId: "user_a" });
    expect(extract).not.toHaveBeenCalled();
    expect(busy.doc?.status).toBe("extracting");

    mem.doc.processingStartedAt = Date.now() - 10 * 60 * 1000;
    const reclaimed = await runPdfPipeline(depsFor(mem, { extract }), {
      documentId: "doc1",
      userId: "user_a",
      embed: "inline",
    });
    expect(extract).toHaveBeenCalledTimes(1);
    expect(reclaimed.doc?.status).toBe("ready");
  });

  it("refuses another user's document", async () => {
    const mem = memoryRepo();
    const result = await runPdfPipeline(depsFor(mem), { documentId: "doc1", userId: "intruder" });
    expect(result.doc).toBeNull();
    expect(mem.history).toEqual([]);
  });

  it("goes ready with vectors pending when the embedder is off, then backfills later", async () => {
    const mem = memoryRepo();
    const onReady = vi.fn(async () => {});
    const off = await runPdfPipeline(depsFor(mem, { embedderAvailable: () => false, onReady }), {
      documentId: "doc1",
      userId: "user_a",
      embed: "inline",
    });
    expect(off).toMatchObject({ vectorsPending: true, doc: { status: "ready" } });
    expect(mem.vectors.size).toBe(0);

    const embedder = fakeEmbedder();
    const filled = await embedPendingChunks(depsFor(mem, { embed: embedder.embed, onReady }), {
      documentId: "doc1",
      userId: "user_a",
      maxBatches: 100,
    });
    expect(filled.vectorsPending).toBe(false);
    expect(mem.vectors.size).toBe(mem.chunks.size);
    expect(mem.doc.embeddedChunkCount).toBe(mem.chunks.size);
    expect(onReady).toHaveBeenCalledTimes(1); // once, when it first became ready
  });

  it("resumes after an embedder outage without re-embedding finished chunks", async () => {
    const mem = memoryRepo();
    const flaky = fakeEmbedder({ failAfterCalls: 1 });
    const extract = async () => ({ pageCount: 6, pages: longPages(6, 40) });
    const first = await runPdfPipeline(depsFor(mem, { embed: flaky.embed, extract }), {
      documentId: "doc1",
      userId: "user_a",
      embed: "inline",
    });
    expect(first.doc?.status).toBe("ready"); // searchable via full text meanwhile
    expect(first.vectorsPending).toBe(true);
    const embeddedFirst = mem.vectors.size;
    expect(mem.chunks.size).toBeGreaterThan(PDF_EMBED_BATCH);
    expect(embeddedFirst).toBe(PDF_EMBED_BATCH);

    const healthy = fakeEmbedder();
    await embedPendingChunks(depsFor(mem, { embed: healthy.embed }), { documentId: "doc1", userId: "user_a", maxBatches: 100 });
    const reembedded = healthy.calls.flat();
    expect(reembedded).toHaveLength(mem.chunks.size - embeddedFirst);
    expect(mem.vectors.size).toBe(mem.chunks.size);
  });

  it("stays in `embedding` when the per-run batch cap is hit", async () => {
    const mem = memoryRepo();
    const deps = depsFor(mem, { extract: async () => ({ pageCount: 6, pages: longPages(6, 40) }) });
    const first = await runPdfPipeline(deps, { documentId: "doc1", userId: "user_a", embed: "defer" });
    expect(first.doc?.status).toBe("embedding");
    const step = await embedPendingChunks(deps, { documentId: "doc1", userId: "user_a", maxBatches: 1 });
    expect(step.doc?.status).toBe("embedding");
    expect(mem.vectors.size).toBe(PDF_EMBED_BATCH);
    const done = await embedPendingChunks(deps, { documentId: "doc1", userId: "user_a", maxBatches: 100 });
    expect(done.doc?.status).toBe("ready");
  });

  it("treats a missing vector table as full-text only instead of failing", async () => {
    const mem = memoryRepo();
    mem.failures.pending = Object.assign(new Error('relation "pdf_chunk_embeddings" does not exist'), { code: "42P01" });
    const result = await runPdfPipeline(depsFor(mem), { documentId: "doc1", userId: "user_a", embed: "inline" });
    expect(result).toMatchObject({ vectorsPending: true, doc: { status: "ready" } });
  });
});

// ── Embedder selection ────────────────────────────────────────────────────

describe("PDF embedder selection", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("defaults to the self-hosted host only", () => {
    expect(pdfEmbedProvider({})).toBe("local");
    expect(pdfEmbedProvider({ ANIMA_PDF_EMBED_PROVIDER: "OFF" })).toBe("off");
    expect(pdfEmbedProvider({ ANIMA_PDF_EMBED_PROVIDER: "openai" })).toBe("local");
    expect(pdfEmbedderAvailable({ ANIMA_PDF_EMBED_PROVIDER: "off" })).toBe(false);
    expect(
      pdfEmbedderAvailable({
        ANIMA_PDF_EMBED_PROVIDER: "local",
        ANIMA_LOCAL_LLM_BASE_URL: "https://llm.example.com/v1",
      }),
    ).toBe(true);
  });
});

// ── Storage adapter ───────────────────────────────────────────────────────

describe("Supabase PDF storage", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("writes to {user}/{document}.pdf with the service key and upsert, reads and deletes", async () => {
    vi.stubEnv("SUPABASE_URL", "https://proj.supabase.co/");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
    vi.stubEnv("SUPABASE_PDF_BUCKET", "");
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (init?.method === "POST") return new Response("{}", { status: 200 });
      if (init?.method === "DELETE") return new Response("[]", { status: 200 });
      if (String(url).includes("missing")) return new Response("not found", { status: 404 });
      return new Response(new Uint8Array([37, 80, 68, 70]), { status: 200 });
    }) as unknown as typeof fetch;
    const store = supabasePdfStore(fetchImpl);

    const ref = await store.put({ userId: "user_2abc", documentId: "doc-1", bytes: new Uint8Array([1, 2]) });
    expect(ref).toEqual({ bucket: "companion-documents", path: "user_2abc/doc-1.pdf" });
    expect(calls[0]!.url).toBe("https://proj.supabase.co/storage/v1/object/companion-documents/user_2abc/doc-1.pdf");
    const headers = calls[0]!.init!.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer service-key");
    expect(headers["x-upsert"]).toBe("true");
    expect(headers["Content-Type"]).toBe("application/pdf");

    const bytes = await store.get({ userId: "user_2abc", documentId: "doc-1", ...ref });
    expect(Array.from(bytes!)).toEqual([37, 80, 68, 70]);
    expect(await store.get({ userId: "u", documentId: "d", bucket: "companion-documents", path: "missing.pdf" })).toBeNull();

    await store.remove({ userId: "user_2abc", documentId: "doc-1", ...ref });
    const del = calls.at(-1)!;
    expect(del.init!.method).toBe("DELETE");
    expect(JSON.parse(String(del.init!.body))).toEqual({ prefixes: ["user_2abc/doc-1.pdf"] });
  });

  it("keeps the owner as the first path segment (what storage RLS checks)", () => {
    expect(pdfObjectPath("user_2abc", "d1")).toBe("user_2abc/d1.pdf");
    expect(pdfObjectPath("../evil", "x/y")).toBe("___evil/x_y.pdf");
  });
});

// ── Hybrid recall ─────────────────────────────────────────────────────────

describe("hybrid PDF recall fusion", () => {
  const hit = (chunkId: string, content = chunkId): PdfHit => ({
    chunkId,
    content,
    filename: "a.pdf",
    scope: "chat",
    pageStart: 1,
    pageEnd: 1,
    rank: 0,
  });

  it("ranks chunks found by both keyword and vector search first and dedupes them", () => {
    const fused = fusePdfHits([hit("k1"), hit("both"), hit("k3")], [hit("v1"), hit("both")]);
    expect(fused[0]!.chunkId).toBe("both");
    expect(fused.filter((h) => h.chunkId === "both")).toHaveLength(1);
    expect(fused).toHaveLength(4);
  });

  it("keeps keyword order when there are no vector hits", () => {
    expect(fusePdfHits([hit("a"), hit("b")], []).map((h) => h.chunkId)).toEqual(["a", "b"]);
    expect(fusePdfHits([], [hit("v")]).map((h) => h.chunkId)).toEqual(["v"]);
  });
});
