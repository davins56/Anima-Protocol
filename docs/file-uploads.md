# File uploads → memory (feature/file-uploads)

PDF upload already existed on `main` (#577): the chat composer's attach button
(PDF picker in `ChatInput.jsx`) and companion lore files post to `POST /api/pdfs`. The server
extracts the text server-side with `unpdf` (pdf.js build) (`lib/pdf/extract.ts`), chunks it
(`lib/pdf/chunk.ts`) into `pdf_chunks` (full-text search), and keeps the original bytes
in `pdf_file_parts`. `ChatPdfBar` lists, opens and removes a chat's PDFs.

This branch makes uploaded PDFs part of the companion's **persistent memory**:

| Piece | Where |
|---|---|
| `document_chunk` memory event type, private `companion-documents` bucket, owner-only RLS on `storage.objects` (first path segment = `auth.jwt()->>'sub'`), document index | `supabase/migrations/20261022260000_document_memory.sql` |
| Chunk → embedded `memory_events` rows (idempotent `doc:<id>:<chunk>` dedupe key, max 64 chunks/doc, batch-embedded, best-effort) | `api-server/src/lib/pdf/documentMemory.ts` |
| Remove PDF → append `retraction` events for its chunks (memory_events never updated/deleted) | `retractDocumentFromMemory` |
| Optional mirror of the original to the bucket at `{userId}/{documentId}.pdf` when `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` are set | `api-server/src/lib/pdf/documentStorage.ts` |
| Recalled chunks render as `from "file.pdf" pp. 2–3` in the memory block | `memoryCore/sessionContext.ts` |

Which companion owns a memory: a lore PDF uses its `character_id`. A chat PDF uses
the session's companion, but only for solo chats. Group-chat PDFs stay chat-only
(full-text path) because there is no single owner.

Recall is the existing `recall_memories` blend (similarity 0.6, recency 0.25 with
a 30-day half-life, emotion 0.15). Document chunks have emotional weight 0.35 for
chat PDFs and 0.45 for lore, so conversation memories still lead.

## Env
- `ANIMA_DOCUMENT_MEMORY` (default on; `off` disables ingest). It also follows `ANIMA_MEMORY_CORE`.
- `SUPABASE_DOCUMENT_BUCKET` (default `companion-documents`).
- Existing: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (bucket mirror), and the embedder (Ollama `nomic-embed-text` or Workers AI).

## Remaining
- Client-direct bucket uploads need a Supabase JWT minted from the Clerk session (Supabase third-party auth). Until then, uploads go through the API with the service role.
- Scanned (image-only) PDFs are still rejected (no OCR).
- The 64-chunk memory cap means very long PDFs are only partly in vector memory, though all of the text stays in full-text search.
- The other `feature/pdf-upload` branch (another worktree) reworks the same pipeline. It needs reconciling before both merge, including its migration timestamp `20261022210000`, which collides with `companion_roster`.
