-- Anima Protocol — PDF upload pipeline: private storage bucket, pipeline status,
-- and pgvector chunk embeddings joined into chat recall.
-- Non-destructive: CREATE ... IF NOT EXISTS / ADD COLUMN IF NOT EXISTS only.
-- Never DROP / TRUNCATE / DELETE here (scripts/ci/check-migration-safety.mjs).
--
-- Ownership:
--   pdf_documents, pdf_chunks, pdf_file_parts — Drizzle-owned (lib/db/src/schema).
--     The new columns and the status CHECK are declared in the Drizzle schema and
--     in lib/db ensure-schema too, so `drizzle-kit push` keeps them.
--     The CREATE TABLE IF NOT EXISTS blocks below mirror ensure-schema so this
--     file also works on a fresh Supabase project before the API has booted.
--   pdf_chunk_embeddings — SQL-owned (this file). Listed in
--     lib/db/protected-tables.ts so drizzle-kit never drops it.
--
-- Auth model (same as the photo + memory migrations): the api-server reaches
-- Postgres as the table owner (bypasses RLS) and authenticates users with Clerk.
-- RLS / grants below are defence-in-depth for the Supabase PostgREST surface.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- pgvector (Supabase installs extensions into schema `extensions`).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'extensions') THEN
    CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;
  ELSE
    CREATE EXTENSION IF NOT EXISTS vector;
  END IF;
END $$;

-- 1. Base tables (identical to lib/db/src/ensure-schema.ts ensurePdfSchema).
CREATE TABLE IF NOT EXISTS public.pdf_documents (
  "id"           text PRIMARY KEY NOT NULL,
  "user_id"      text NOT NULL,                 -- Clerk user id
  "scope"        text NOT NULL,                 -- 'chat' | 'lore'
  "session_id"   text,                          -- chat_sessions entity id (scope = chat)
  "character_id" text,                          -- user_entities.entity_id (scope = lore)
  "filename"     text NOT NULL,
  "byte_size"    integer DEFAULT 0 NOT NULL,
  "page_count"   integer DEFAULT 0 NOT NULL,
  "chunk_count"  integer DEFAULT 0 NOT NULL,
  "created_at"   timestamp DEFAULT now() NOT NULL,
  "updated_at"   timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "pdf_documents_user_session_idx"
  ON public.pdf_documents USING btree ("user_id", "scope", "session_id");
CREATE INDEX IF NOT EXISTS "pdf_documents_user_character_idx"
  ON public.pdf_documents USING btree ("user_id", "scope", "character_id");

CREATE TABLE IF NOT EXISTS public.pdf_chunks (
  "id"            text PRIMARY KEY NOT NULL,
  "document_id"   text NOT NULL,
  "user_id"       text NOT NULL,
  "chunk_index"   integer NOT NULL,
  "page_start"    integer DEFAULT 1 NOT NULL,
  "page_end"      integer DEFAULT 1 NOT NULL,
  "content"       text NOT NULL,
  "search_vector" tsvector NOT NULL,
  "created_at"    timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "pdf_chunks_document_idx"
  ON public.pdf_chunks USING btree ("user_id", "document_id", "chunk_index");
CREATE INDEX IF NOT EXISTS "pdf_chunks_search_idx"
  ON public.pdf_chunks USING gin ("search_vector");
DO $$ BEGIN
  ALTER TABLE public.pdf_chunks
    ADD CONSTRAINT "pdf_chunks_document_id_fk"
    FOREIGN KEY ("document_id") REFERENCES public.pdf_documents("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.pdf_file_parts (
  "document_id" text NOT NULL REFERENCES public.pdf_documents("id") ON DELETE CASCADE,
  "user_id"     text NOT NULL,
  "part_index"  integer NOT NULL,
  "data"        bytea NOT NULL,
  CONSTRAINT "pdf_file_parts_pk" PRIMARY KEY ("document_id", "part_index")
);
CREATE INDEX IF NOT EXISTS "pdf_file_parts_user_idx"
  ON public.pdf_file_parts USING btree ("user_id", "document_id");

-- 2. Pipeline state on pdf_documents. Rows created before this migration were
--    fully processed synchronously, so they default to 'ready'.
ALTER TABLE public.pdf_documents
  ADD COLUMN IF NOT EXISTS "status"                text DEFAULT 'ready' NOT NULL,
  ADD COLUMN IF NOT EXISTS "error"                 text,
  ADD COLUMN IF NOT EXISTS "error_code"            text,
  ADD COLUMN IF NOT EXISTS "attempts"              integer DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS "content_sha256"        text,
  ADD COLUMN IF NOT EXISTS "storage_bucket"        text,      -- NULL = bytes in pdf_file_parts
  ADD COLUMN IF NOT EXISTS "storage_path"          text,
  ADD COLUMN IF NOT EXISTS "embedded_chunk_count"  integer DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS "embedding_model"       text,
  ADD COLUMN IF NOT EXISTS "processing_started_at" timestamp,
  ADD COLUMN IF NOT EXISTS "completed_at"          timestamp;

DO $$ BEGIN
  ALTER TABLE public.pdf_documents
    ADD CONSTRAINT "pdf_documents_status_check"
    CHECK ("status" IN ('uploaded','extracting','chunking','embedding','ready','failed'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "pdf_documents_user_status_idx"
  ON public.pdf_documents USING btree ("user_id", "status");
CREATE INDEX IF NOT EXISTS "pdf_documents_user_sha_idx"
  ON public.pdf_documents USING btree ("user_id", "content_sha256");

ALTER TABLE public.pdf_chunks
  ADD COLUMN IF NOT EXISTS "token_count" integer DEFAULT 0 NOT NULL;

-- 3. Chunk embeddings. Same dimension (768) and index style (HNSW, cosine,
--    m = 16, ef_construction = 64) as memory_events in 20261022160200.
--    Rows are derived data: they cascade away with their chunk / document, so
--    deleting a PDF really deletes its vectors.
CREATE TABLE IF NOT EXISTS public.pdf_chunk_embeddings (
  chunk_id        text PRIMARY KEY REFERENCES public.pdf_chunks(id) ON DELETE CASCADE,
  document_id     text NOT NULL REFERENCES public.pdf_documents(id) ON DELETE CASCADE,
  user_id         text NOT NULL,
  embedding       vector(768) NOT NULL,       -- nomic-embed-text / bge-base-en-v1.5
  embedding_model text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pdf_chunk_embeddings_doc_idx
  ON public.pdf_chunk_embeddings (user_id, document_id);
CREATE INDEX IF NOT EXISTS pdf_chunk_embeddings_hnsw
  ON public.pdf_chunk_embeddings USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- 4. RLS / grants.
ALTER TABLE public.pdf_chunk_embeddings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'pdf_chunk_embeddings_select_own') THEN
      CREATE POLICY pdf_chunk_embeddings_select_own ON public.pdf_chunk_embeddings
        FOR SELECT TO authenticated USING (user_id = (auth.jwt() ->> 'sub'));
    END IF;
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.pdf_chunk_embeddings FROM anon, authenticated;
    REVOKE ALL ON public.pdf_chunk_embeddings FROM anon;
    -- Drizzle-owned PDF tables: drizzle-kit manages their RLS flag, so they are
    -- closed with grants instead. Every read goes through /api/pdfs (Clerk).
    REVOKE ALL ON public.pdf_documents, public.pdf_chunks, public.pdf_file_parts
      FROM anon, authenticated;
  END IF;
END $$;

-- 5. Private storage bucket for original PDFs (Supabase only; skipped on plain
--    Postgres, where the api-server falls back to pdf_file_parts).
--    Object layout: companion-documents/{user_id}/{document_id}.pdf
--    The first path segment is the owner, which is what the policies check.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'storage' AND table_name = 'buckets') THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES ('companion-documents', 'companion-documents', false, 20971520,
            ARRAY['application/pdf'])
    ON CONFLICT (id) DO NOTHING;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'storage' AND table_name = 'objects')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_policies
                   WHERE schemaname = 'storage' AND tablename = 'objects'
                     AND policyname = 'companion_documents_select_own') THEN
      CREATE POLICY companion_documents_select_own ON storage.objects
        FOR SELECT TO authenticated
        USING (bucket_id = 'companion-documents'
               AND (storage.foldername(name))[1] = (auth.jwt() ->> 'sub'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies
                   WHERE schemaname = 'storage' AND tablename = 'objects'
                     AND policyname = 'companion_documents_insert_own') THEN
      CREATE POLICY companion_documents_insert_own ON storage.objects
        FOR INSERT TO authenticated
        WITH CHECK (bucket_id = 'companion-documents'
                    AND (storage.foldername(name))[1] = (auth.jwt() ->> 'sub'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies
                   WHERE schemaname = 'storage' AND tablename = 'objects'
                     AND policyname = 'companion_documents_update_own') THEN
      CREATE POLICY companion_documents_update_own ON storage.objects
        FOR UPDATE TO authenticated
        USING (bucket_id = 'companion-documents'
               AND (storage.foldername(name))[1] = (auth.jwt() ->> 'sub'))
        WITH CHECK (bucket_id = 'companion-documents'
                    AND (storage.foldername(name))[1] = (auth.jwt() ->> 'sub'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies
                   WHERE schemaname = 'storage' AND tablename = 'objects'
                     AND policyname = 'companion_documents_delete_own') THEN
      CREATE POLICY companion_documents_delete_own ON storage.objects
        FOR DELETE TO authenticated
        USING (bucket_id = 'companion-documents'
               AND (storage.foldername(name))[1] = (auth.jwt() ->> 'sub'));
    END IF;
  END IF;
END $$;

-- 6. Retrieval RPC: cosine similarity over the user's in-scope chunks.
--    Scope = this chat's PDFs + lore PDFs of the companions in the chat.
--    The candidate set is filtered to the user's own documents first (at most
--    8 chat + 12 lore files per scope), then ranked exactly; the HNSW index
--    serves larger stores. Only vectors from p_embedding_model are compared, so
--    switching embedders (nomic vs bge: both 768-d, different spaces) never
--    mixes incompatible vectors.
CREATE OR REPLACE FUNCTION public.match_pdf_chunks(
  p_user_id         text,
  p_query_embedding vector(768),
  p_session_id      text DEFAULT NULL,
  p_character_ids   text[] DEFAULT '{}',
  p_limit           integer DEFAULT 4,
  p_min_similarity  real DEFAULT 0.3,
  p_embedding_model text DEFAULT NULL
) RETURNS TABLE (
  chunk_id     text,
  document_id  text,
  filename     text,
  scope        text,
  chunk_index  integer,
  page_start   integer,
  page_end     integer,
  content      text,
  similarity   real
)
LANGUAGE sql STABLE AS $$
  WITH docs AS MATERIALIZED (
    SELECT d.id, d.filename, d.scope
    FROM public.pdf_documents d
    WHERE d.user_id = p_user_id
      AND d.status IN ('embedding', 'ready')
      AND (
        (p_session_id IS NOT NULL AND d.scope = 'chat' AND d.session_id = p_session_id)
        OR (d.scope = 'lore' AND d.character_id = ANY (COALESCE(p_character_ids, '{}'::text[])))
      )
  )
  SELECT c.id, c.document_id, docs.filename, docs.scope, c.chunk_index,
         c.page_start, c.page_end, c.content,
         (1 - (e.embedding <=> p_query_embedding))::real AS similarity
  FROM docs
  JOIN public.pdf_chunk_embeddings e ON e.document_id = docs.id AND e.user_id = p_user_id
  JOIN public.pdf_chunks c ON c.id = e.chunk_id AND c.user_id = p_user_id
  WHERE p_query_embedding IS NOT NULL
    AND (p_embedding_model IS NULL OR e.embedding_model = p_embedding_model)
    AND (1 - (e.embedding <=> p_query_embedding)) >= COALESCE(p_min_similarity, 0)
  ORDER BY e.embedding <=> p_query_embedding ASC, c.chunk_index ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 4), 1), 20);
$$;

-- 7. Memory core link. A ready PDF appends one `document_shared` event (dedupe
--    key pdf:<document_id>) so the companion remembers *that* it was shared.
--    The text itself stays in pdf_chunks: memory_events is append-only, and a
--    deleted PDF must stop being recalled, which a `retraction` event does.
INSERT INTO public.memory_event_types (type, description) VALUES
  ('document_shared', 'user shared a PDF (payload.document_id); text lives in pdf_chunks')
ON CONFLICT (type) DO NOTHING;
