/**
 * PDF ingestion pipeline: uploaded → extracting → chunking → embedding → ready
 * (or failed). Every stage is re-entrant so a retry, a status poll, or the
 * hourly cron can pick a document up wherever it stopped:
 *
 *  - claim() is a compare-and-set on status, so two workers never process the
 *    same document; a processing row older than PDF_STALE_PROCESSING_MS is
 *    treated as abandoned (the isolate died) and can be reclaimed.
 *  - chunking is deterministic and replaceChunks() swaps the whole chunk set in
 *    one statement, so re-running it never duplicates rows. Chunk ids are
 *    `<document_id>:<attempt>:<chunk_index>`.
 *  - embeddings are keyed by chunk id (INSERT ... ON CONFLICT DO NOTHING) and
 *    only chunks without a vector are embedded, so a resumed run does no
 *    repeat work.
 *  - An unreachable embedder is not a failure: chunks are already searchable
 *    with full-text search, so the document goes `ready` with vectors pending
 *    and the cron backfill (worker.ts → scheduled) fills them in later. This
 *    mirrors memory_events, which are stored unembedded and backfilled.
 *
 * Dependencies are injected so tests can run the whole thing with an
 * in-memory repo, a fake blob store, and a fake embedder.
 */
import { aiBinding } from "../aiBinding";
import { embedMemoryTexts, type Embedding } from "../memoryCore/embedder";
import { localLlmBaseUrl } from "../openaiClient";
import { chunkPdfPages, type PdfChunkDraft } from "./chunk";
import { isPdfUploadError, PdfUploadError } from "./errors";
import { extractPdfPages, type ExtractedPdf } from "./extract";
import {
  PDF_EMBED_BATCH,
  PDF_EMBED_MAX_BATCHES_PER_RUN,
  PDF_EMBED_TIMEOUT_MS,
  PDF_STALE_PROCESSING_MS,
} from "./limits";
import type { PdfBlobStore } from "./pdfStorage";

export const PDF_STATUSES = [
  "uploaded",
  "extracting",
  "chunking",
  "embedding",
  "ready",
  "failed",
] as const;
export type PdfStatus = (typeof PDF_STATUSES)[number];

export const PDF_PROCESSING_STATUSES: readonly PdfStatus[] = ["uploaded", "extracting", "chunking"];

export function asPdfStatus(value: unknown): PdfStatus {
  return (PDF_STATUSES as readonly string[]).includes(String(value)) ? (value as PdfStatus) : "ready";
}

export type PdfPipelineDoc = {
  id: string;
  userId: string;
  scope: "chat" | "lore";
  sessionId: string | null;
  characterId: string | null;
  filename: string;
  status: PdfStatus;
  pageCount: number;
  chunkCount: number;
  embeddedChunkCount: number;
  storageBucket: string | null;
  storagePath: string | null;
  attempts: number;
  error: string | null;
  errorCode: string | null;
};

export type PdfStatusPatch = {
  pageCount?: number;
  chunkCount?: number;
  embeddedChunkCount?: number;
  embeddingModel?: string | null;
  error?: string | null;
  errorCode?: string | null;
  completed?: boolean;
};

export type PendingChunk = { id: string; content: string };

export interface PdfPipelineRepo {
  get(documentId: string, userId: string): Promise<PdfPipelineDoc | null>;
  /**
   * Atomically move a document into `extracting` if it is `uploaded`, `failed`,
   * or stuck in a processing state for longer than staleMs. Null when another
   * run owns it or it is already past extraction.
   */
  claim(documentId: string, userId: string, staleMs: number): Promise<PdfPipelineDoc | null>;
  setStatus(documentId: string, userId: string, status: PdfStatus, patch?: PdfStatusPatch): Promise<void>;
  /** Delete + insert the full chunk set in one statement. */
  replaceChunks(doc: PdfPipelineDoc, chunks: PdfChunkDraft[]): Promise<void>;
  /** Chunks with no vector yet. Throws a 42P01-style error if the vector table is missing. */
  pendingEmbeddingChunks(documentId: string, userId: string, limit: number): Promise<PendingChunk[]>;
  insertEmbeddings(
    documentId: string,
    userId: string,
    rows: { chunkId: string; vector: number[]; model: string }[],
  ): Promise<void>;
  countEmbedded(documentId: string, userId: string): Promise<number>;
}

export type PdfEmbedFn = (texts: string[]) => Promise<Embedding[] | null>;

export type PdfPipelineDeps = {
  repo: PdfPipelineRepo;
  /** Store holding a row's bytes, chosen by its bucket (NULL = Postgres parts). */
  blobs: (ref: { bucket: string | null }) => PdfBlobStore;
  embed: PdfEmbedFn;
  /** False when the embedder is switched off or has nowhere to go. */
  embedderAvailable: () => boolean;
  extract?: (bytes: Uint8Array, options?: { copy?: boolean }) => Promise<ExtractedPdf>;
  /** Called once when a document reaches `ready` (memory core link). Errors are swallowed. */
  onReady?: (doc: PdfPipelineDoc) => Promise<void>;
  log?: (msg: string, extra?: Record<string, unknown>) => void;
};

// ── Embedder selection ────────────────────────────────────────────────────

/**
 * ANIMA_PDF_EMBED_PROVIDER = local (default) | auto | workersai | off.
 * Local-only by default: PDF text is the user's own document, and chat already
 * keeps PDF excerpts on the self-hosted model (context.ts). `auto`/`workersai`
 * opt into the Cloudflare AI binding like the memory core does.
 */
export function pdfEmbedProvider(env: NodeJS.ProcessEnv = process.env): string {
  const raw = (env.ANIMA_PDF_EMBED_PROVIDER || "local").trim().toLowerCase();
  return ["local", "auto", "workersai", "off"].includes(raw) ? raw : "local";
}

export function pdfEmbedderAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  const p = pdfEmbedProvider(env);
  if (p === "off") return false;
  const local = Boolean(localLlmBaseUrl(env));
  const workers = Boolean(aiBinding);
  if (p === "local") return local;
  if (p === "workersai") return workers;
  return local || workers;
}

export const embedPdfTexts: PdfEmbedFn = (texts) =>
  embedMemoryTexts(texts, { provider: pdfEmbedProvider(), timeoutMs: PDF_EMBED_TIMEOUT_MS });

// ── Errors ────────────────────────────────────────────────────────────────

export function isMissingRelation(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null;
  return e?.code === "42P01" || e?.code === "42883" || /does not exist/i.test(String(e?.message || ""));
}

const GENERIC_FAILURE = "Something went wrong while reading that PDF. Try again in a moment.";

// ── Stages ────────────────────────────────────────────────────────────────

export type PipelineResult = {
  doc: PdfPipelineDoc | null;
  /** Set when this run failed the document. */
  error?: PdfUploadError;
  /** True when the failure is the file itself (retrying the same bytes will fail again). */
  permanent?: boolean;
  /** Chunks still waiting for a vector after this run. */
  vectorsPending?: boolean;
};

async function finalizeReady(deps: PdfPipelineDeps, doc: PdfPipelineDoc, embedded: number, model?: string | null) {
  const wasReady = doc.status === "ready";
  await deps.repo.setStatus(doc.id, doc.userId, "ready", {
    embeddedChunkCount: embedded,
    ...(model ? { embeddingModel: model } : {}),
    error: null,
    errorCode: null,
    completed: true,
  });
  const ready = { ...doc, status: "ready" as const, embeddedChunkCount: embedded };
  if (!wasReady && deps.onReady) {
    await deps.onReady(ready).catch((err) => deps.log?.("pdf onReady failed", { err: String(err) }));
  }
  return ready;
}

/**
 * Embed up to maxBatches × PDF_EMBED_BATCH chunks that have no vector yet.
 * Safe to call any number of times, from any status at or past `embedding`.
 */
export async function embedPendingChunks(
  deps: PdfPipelineDeps,
  input: { documentId: string; userId: string; maxBatches?: number },
): Promise<PipelineResult> {
  const doc = await deps.repo.get(input.documentId, input.userId);
  if (!doc || (doc.status !== "embedding" && doc.status !== "ready")) return { doc };
  if (!deps.embedderAvailable()) {
    const ready = doc.status === "ready" ? doc : await finalizeReady(deps, doc, doc.embeddedChunkCount);
    return { doc: ready, vectorsPending: ready.embeddedChunkCount < ready.chunkCount };
  }
  const maxBatches = Math.max(1, input.maxBatches ?? PDF_EMBED_MAX_BATCHES_PER_RUN);
  let model: string | null = null;
  let pendingLeft = true;
  let embedderDown = false;
  try {
    for (let batch = 0; batch < maxBatches; batch += 1) {
      const pending = await deps.repo.pendingEmbeddingChunks(doc.id, doc.userId, PDF_EMBED_BATCH);
      if (!pending.length) {
        pendingLeft = false;
        break;
      }
      const vectors = await deps.embed(pending.map((chunk) => chunk.content));
      if (!vectors || vectors.length !== pending.length) {
        embedderDown = true; // leave the rest for the backfill
        break;
      }
      model = vectors[0]?.model ?? model;
      await deps.repo.insertEmbeddings(
        doc.id,
        doc.userId,
        pending.map((chunk, i) => ({ chunkId: chunk.id, vector: vectors[i]!.vector, model: vectors[i]!.model })),
      );
    }
    if (pendingLeft) {
      // Either the batch cap or a down embedder. Check whether anything remains.
      pendingLeft = (await deps.repo.pendingEmbeddingChunks(doc.id, doc.userId, 1)).length > 0;
    }
  } catch (error) {
    if (!isMissingRelation(error)) throw error;
    // pdf_chunk_embeddings not migrated yet: full-text retrieval still works.
    deps.log?.("pdf embeddings table missing; skipping vectors", { documentId: doc.id });
    const ready = doc.status === "ready" ? doc : await finalizeReady(deps, doc, 0);
    return { doc: ready, vectorsPending: true };
  }
  const embedded = await deps.repo.countEmbedded(doc.id, doc.userId);
  if (doc.status === "embedding" && pendingLeft && !embedderDown) {
    // Batch cap reached with the embedder still answering: stay in `embedding`
    // so the next status poll / background slot / cron continues.
    await deps.repo.setStatus(doc.id, doc.userId, "embedding", {
      embeddedChunkCount: embedded,
      ...(model ? { embeddingModel: model } : {}),
    });
    return { doc: { ...doc, embeddedChunkCount: embedded }, vectorsPending: true };
  }
  if (doc.status === "ready") {
    // Backfill on an already-searchable document: just record progress.
    await deps.repo.setStatus(doc.id, doc.userId, "ready", {
      embeddedChunkCount: embedded,
      ...(model ? { embeddingModel: model } : {}),
    });
    return { doc: { ...doc, embeddedChunkCount: embedded }, vectorsPending: pendingLeft };
  }
  // Every vector is in, or the embedder stopped answering: searchable either way.
  return { doc: await finalizeReady(deps, doc, embedded, model), vectorsPending: pendingLeft };
}

/**
 * Extract → chunk → (optionally) embed one document.
 * `bytes` skips the storage read when the caller still holds the upload.
 * `embed: "defer"` stops at `embedding` so the caller can return and run
 * embedPendingChunks in the background (ctx.waitUntil on the Worker).
 */
export async function runPdfPipeline(
  deps: PdfPipelineDeps,
  input: {
    documentId: string;
    userId: string;
    bytes?: Uint8Array;
    embed?: "inline" | "defer";
    staleMs?: number;
  },
): Promise<PipelineResult> {
  const claimed = await deps.repo.claim(input.documentId, input.userId, input.staleMs ?? PDF_STALE_PROCESSING_MS);
  if (!claimed) {
    // Someone else is on it, or it is already chunked: resume embedding if that is where it stopped.
    const current = await deps.repo.get(input.documentId, input.userId);
    if (current?.status === "embedding" && input.embed === "inline") {
      return embedPendingChunks(deps, { documentId: current.id, userId: current.userId });
    }
    return { doc: current };
  }
  const doc = claimed;
  const fail = async (error: PdfUploadError, permanent: boolean): Promise<PipelineResult> => {
    await deps.repo.setStatus(doc.id, doc.userId, "failed", { error: error.message, errorCode: error.code });
    return {
      doc: { ...doc, status: "failed", error: error.message, errorCode: error.code },
      error,
      permanent,
    };
  };

  try {
    let bytes = input.bytes ?? null;
    if (!bytes) {
      bytes = await deps.blobs({ bucket: doc.storageBucket }).get({
        userId: doc.userId,
        documentId: doc.id,
        bucket: doc.storageBucket,
        path: doc.storagePath,
      });
    }
    if (!bytes || !bytes.byteLength) {
      return fail(
        new PdfUploadError("The original file for this PDF is missing. Upload it again.", "pdf_file_missing", 410),
        true,
      );
    }

    const extract = deps.extract ?? ((b, o) => extractPdfPages(b, o));
    let extracted: ExtractedPdf;
    try {
      // The caller already stored the original, so pdf.js may take this buffer.
      extracted = await extract(bytes, { copy: false });
    } catch (error) {
      if (isPdfUploadError(error)) return fail(error, true);
      throw error;
    }

    await deps.repo.setStatus(doc.id, doc.userId, "chunking", { pageCount: extracted.pageCount });
    const chunks = chunkPdfPages(extracted.pages);
    if (!chunks.length) {
      return fail(
        new PdfUploadError(
          "This PDF has no extractable text. It looks like a scan or pictures only, so I can't read it. Export a text-based PDF and try again.",
          "pdf_no_text",
          422,
        ),
        true,
      );
    }
    const chunked: PdfPipelineDoc = {
      ...doc,
      pageCount: extracted.pageCount,
      chunkCount: chunks.length,
      embeddedChunkCount: 0,
    };
    await deps.repo.replaceChunks(chunked, chunks);
    await deps.repo.setStatus(doc.id, doc.userId, "embedding", {
      chunkCount: chunks.length,
      embeddedChunkCount: 0,
    });
    const embedding: PdfPipelineDoc = { ...chunked, status: "embedding" };

    if (!deps.embedderAvailable()) {
      return { doc: await finalizeReady(deps, embedding, 0), vectorsPending: true };
    }
    if (input.embed === "defer") return { doc: embedding, vectorsPending: true };
    return await embedPendingChunks(deps, { documentId: doc.id, userId: doc.userId });
  } catch (error) {
    deps.log?.("pdf pipeline failed", { documentId: doc.id, err: String(error) });
    return fail(new PdfUploadError(GENERIC_FAILURE, "pdf_pipeline_error", 503), false);
  }
}
