-- File uploads → memory: private PDF bucket with owner-only RLS, and a
-- `document_chunk` memory event type so extracted PDF text joins the pgvector
-- recall layer. Non-destructive: one lookup row, one bucket, storage policies.
-- memory_events stays append-only: removing a PDF appends `retraction` events
-- (payload.target_event_id) for its chunks; nothing is updated or deleted.

INSERT INTO public.memory_event_types (type, description) VALUES
  ('document_chunk', 'a chunk of an uploaded PDF: payload {document_id, chunk_index, page_start, page_end, filename, scope}')
ON CONFLICT (type) DO NOTHING;

-- Private bucket (Supabase only; skipped on plain Postgres).
-- Object layout: companion-documents/{clerk_user_id}/{document_id}.pdf
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'storage' AND table_name = 'buckets') THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES ('companion-documents', 'companion-documents', false, 20971520, ARRAY['application/pdf'])
    ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;

-- Owner-only RLS on the bucket: the first path segment must equal the
-- caller's Clerk user id (auth.jwt() ->> 'sub'). No public read, no update.
-- The api-server writes with the service role; these policies cover direct
-- client access with a Supabase JWT minted from the Clerk session.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'storage' AND table_name = 'objects')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND policyname = 'companion_documents_select_own') THEN
      CREATE POLICY companion_documents_select_own ON storage.objects
        FOR SELECT TO authenticated
        USING (bucket_id = 'companion-documents'
               AND (storage.foldername(name))[1] = (auth.jwt() ->> 'sub'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND policyname = 'companion_documents_insert_own') THEN
      CREATE POLICY companion_documents_insert_own ON storage.objects
        FOR INSERT TO authenticated
        WITH CHECK (bucket_id = 'companion-documents'
                    AND (storage.foldername(name))[1] = (auth.jwt() ->> 'sub'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND policyname = 'companion_documents_delete_own') THEN
      CREATE POLICY companion_documents_delete_own ON storage.objects
        FOR DELETE TO authenticated
        USING (bucket_id = 'companion-documents'
               AND (storage.foldername(name))[1] = (auth.jwt() ->> 'sub'));
    END IF;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS memory_events_document_idx
  ON public.memory_events (user_id, (payload ->> 'document_id'))
  WHERE event_type = 'document_chunk';
