# PDF upload pipeline

PDFs a user uploads (chat attachments, or **lore** files on a companion) are stored, extracted, chunked and
embedded so the companion can quote them. Code lives in `artifacts/api-server/src/lib/pdf/`. The schema is
`supabase/migrations/20261022210000_pdf_pipeline.sql` plus the Drizzle mirror in `lib/db`.

## Status machine
```
uploaded → extracting → chunking → embedding → ready
    └───────────┴───────────┴──────────┴──→ failed (error, error_code)
```
| Status | Meaning | Visible to chat retrieval |
|---|---|---|
| `uploaded` | Row and original stored | no |
| `extracting` / `chunking` | Claimed by a worker (`processing_started_at`) | no |
| `embedding` | Chunks written; vectors being filled | yes (full-text only for chunks without vectors) |
| `ready` | Done. `embedded_chunk_count < chunk_count` means vectors are still pending (embedder down/off) | yes |
| `failed` | `error_code` `pdf_*`; the user can retry | no |

Rows created before the pipeline default to `ready`.

* **Claim** is a compare-and-set `UPDATE ... WHERE status = <expected>`, so two isolates never process the same
  document. A claim older than 2 min (`PDF_STALE_PROCESSING_MS`) is reclaimable: a polling `GET /pdfs/:id` or the
  hourly cron picks it up.
* **Idempotent re-runs.** Chunk ids are `<doc>:<attempt>:<index>`. `replaceChunks` is one statement
  (`WITH cleared AS (DELETE ...) INSERT ...`, because the Hyperdrive pool has no multi-statement transactions).
  Embedding inserts use `ON CONFLICT DO NOTHING`, and a chunk deleted mid-run (FK 23503) is ignored.
* **Permanent vs. retryable failures.** Invalid/encrypted/image-only/oversized PDFs and a missing original are
  permanent (`PdfUploadError`, `pdf_file_missing`). On a fresh upload they're reported synchronously (4xx) and every
  row/object is removed. Anything else becomes `pdf_pipeline_error` (503) and can be retried.
* **Re-upload** of the same bytes (sha256 per user) returns the existing document, or retries it if it had failed.

## Request flow
1. `POST /api/pdfs?scope=chat|lore&session_id=…|character_id=…&filename=…` with the raw file
   (`Content-Type: application/pdf`, up to 20 MB). Legacy JSON `{ base64 }` is still accepted up to 4 MB.
   Validation: MIME (`application/pdf`, `x-pdf`, `acrobat`, `octet-stream` or empty) → `%PDF-` magic bytes → size → 200 pages
   / 400k extracted chars. A bad type returns 415, a bad file 400/422.
2. Inline: claim → extract (`unpdf`) → chunk → write chunks. The response has the document at `embedding`
   (or `ready` when no embedder is configured).
3. Background (`x-anima-bg` → `ctx.waitUntil`): embed in batches of 16, at most 8 batches per run. Bigger files keep
   `embedding` and continue on the next poll or cron tick.
4. `GET /api/pdfs/:id` returns status and nudges stale work. `GET /api/pdfs` lists. `POST /api/pdfs/:id/retry`.
   `PATCH` renames. `DELETE` removes rows, vectors (cascade) and the Storage object, and retracts the memory link.
5. `worker.ts` `scheduled` → `backfillPdfPipelines({ maxDocuments: 8 })`.

Frontend: `src/hooks/usePdfDocuments.ts` (list, poll active docs every 3 s for up to 3 min, retry),
`src/api/pdfPipeline.js` (status labels), `ChatPdfBar.jsx` and `CompanionLoreFiles.jsx` (status chip + Retry).

## Extraction and chunking
* **Library: `unpdf`** (serverless build of pdf.js; no canvas or native deps). It was already a dependency, and it's
  lazy-imported so it doesn't weigh on cold start. Verified under local `workerd` (wrangler 4.141,
  compat date 2026-08-17, `nodejs_compat`): a 2-page PDF extracted per page in ~60 ms.
* **Chunks: 900 characters (~225 tokens) with 150 characters of overlap.** Break at a sentence end in the back half of the
  window, otherwise at whitespace. Overlap starts on a word boundary. Each chunk keeps `page_start`/`page_end`
  and a `token_count` estimate (chars/4). Deterministic, so a retry produces identical text. Cap: 520 chunks.
  The size fits `nomic-embed-text` comfortably and keeps 4 hits inside the 300-word PDF context budget.

## Storage
`PDF_BUCKET` = `SUPABASE_PDF_BUCKET` (default `companion-documents`): a private bucket, 20 MB, `application/pdf` only.
Path is `<clerk user id>/<document id>.pdf`. storage.objects RLS allows select/insert/update/delete only when the first path
segment equals `auth.jwt()->>'sub'`. The server uses the service role, so the policies guard any future direct
client access. Without `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` the original falls back to `pdf_file_parts`
(512 KiB rows in Postgres), and `storage_bucket` on the row records which store holds it.

## Embeddings and recall
* Vectors live in **`pdf_chunk_embeddings`** (`vector(768)`, HNSW cosine `m=16, ef_construction=64`, the same as
  `memory_events`). It's SQL-owned and listed in `lib/db/protected-tables.ts`, so `drizzle-kit push` never touches it.
  The Drizzle tables (`pdf_documents`, `pdf_chunks`) stay pgvector-free, so `ensure-schema` works without the
  extension.
* Embedder: `embedder.ts` (`embedMemoryTexts`) with `ANIMA_PDF_EMBED_PROVIDER`, **default `local`**
  (self-hosted `nomic-embed-text`). PDF text is private user content and, like chat with PDFs, stays on the
  self-hosted model. `auto`/`workersai` opt into the Cloudflare `AI` binding. `off` skips vectors entirely.
* `match_pdf_chunks(user, query_vec, session, character_ids, limit, min_similarity, model)` returns the user's
  `embedding`/`ready` chunks in scope, filtered to the same embedding model (vectors from different models
  aren't comparable).
* **Recall join.** `retrievePdfContext` runs Postgres full-text and `match_pdf_chunks` in parallel and fuses them
  with reciprocal-rank fusion (k=60). The query vector comes from `embedQueryCached`, which is shared with
  `recallMemories` for the same message, so a turn embeds once. A slow embedder (>1.2 s) or any vector error
  falls back to full-text hits. The result goes into the existing PDF context block, which stays local-only and
  within the 300-word budget.
* **Memory link.** Chunks are *not* copied into append-only `memory_events`, because a delete could never remove them.
  Instead, one `document_shared` event per companion (`dedupe_key pdf:<doc>:<character>`) records that the user
  shared the file. Deleting the PDF appends a `retraction` for it.

## Configuration
| Variable | Default | |
|---|---|---|
| `SUPABASE_PDF_BUCKET` | `companion-documents` | Storage bucket for originals |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | — | Enable Storage; otherwise originals go to Postgres |
| `ANIMA_PDF_EMBED_PROVIDER` | `local` | `local` \| `auto` \| `workersai` \| `off` |
| `ANIMA_MEMORY_EMBED_MODEL` | `nomic-embed-text` | Shared with memory core |
| `ANIMA_PDF_MAX_BYTES` | 20 MB | Can only lower the cap |

## Applying
Apply after the memory migrations: `supabase db push`, or
`psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20261022210000_pdf_pipeline.sql`.
It's idempotent. `ensure-schema` also adds the new `pdf_documents`/`pdf_chunks` columns on existing databases, so
the API keeps working before the migration (full-text only, originals in Postgres) and gains vectors after it.
