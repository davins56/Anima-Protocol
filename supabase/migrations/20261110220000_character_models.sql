-- Private bucket for per-companion 3D vessel models (VRM / GLB).
-- Non-destructive: bucket + storage policies only. No new table.
-- Model metadata lives on character_vessel.config.model (VesselConfig schema 2).
-- Object layout: character-models/{clerk_user_id}/{character_id}/{uuid}.{vrm|glb}

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'storage' AND table_name = 'buckets') THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES (
      'character-models',
      'character-models',
      false,
      52428800,
      ARRAY['model/gltf-binary', 'model/vrm', 'application/octet-stream']
    )
    ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;

-- Owner-only RLS: the first path segment must equal the caller's Clerk user id
-- (auth.jwt() ->> 'sub'). No public read, no update (replace = new object +
-- new vessel version). The api-server uses the service role; these policies
-- cover direct client access with a signed upload URL / Supabase JWT.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'storage' AND table_name = 'objects')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND policyname = 'character_models_select_own') THEN
      CREATE POLICY character_models_select_own ON storage.objects
        FOR SELECT TO authenticated
        USING (bucket_id = 'character-models'
               AND (storage.foldername(name))[1] = (auth.jwt() ->> 'sub'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND policyname = 'character_models_insert_own') THEN
      CREATE POLICY character_models_insert_own ON storage.objects
        FOR INSERT TO authenticated
        WITH CHECK (bucket_id = 'character-models'
                    AND (storage.foldername(name))[1] = (auth.jwt() ->> 'sub'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND policyname = 'character_models_delete_own') THEN
      CREATE POLICY character_models_delete_own ON storage.objects
        FOR DELETE TO authenticated
        USING (bucket_id = 'character-models'
               AND (storage.foldername(name))[1] = (auth.jwt() ->> 'sub'));
    END IF;
  END IF;
END $$;
