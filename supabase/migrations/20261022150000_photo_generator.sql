-- Anima Protocol — lifelike photo generator (identity-locked companion photos)
-- Non-destructive: CREATE ... IF NOT EXISTS only. Never DROP / TRUNCATE here.
--
-- Auth model: the app authenticates with Clerk, and the api-server talks to
-- Postgres through DATABASE_URL / Hyperdrive as the table owner (bypasses RLS).
-- user_id is the Clerk user id (text). RLS below is defence-in-depth for the
-- Supabase PostgREST surface: anon gets nothing; `authenticated` (Clerk JWT via
-- Supabase third-party auth, sub = Clerk user id) can read its own rows only.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Locked visual identity: one row per (user, character).
CREATE TABLE IF NOT EXISTS public.character_visual_identity (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          text NOT NULL,
  character_id     text NOT NULL,              -- user_entities.entity_id (Anima / Character row)
  character_name   text NOT NULL DEFAULT '',
  version          integer NOT NULL DEFAULT 1, -- bumped on every reference-set change
  locked           boolean NOT NULL DEFAULT false,
  -- [{ url, storage_path, kind: 'face'|'half'|'full', is_primary, width, height, added_at }]
  reference_images jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Immutable look: { age_range, ethnicity, skin_tone, face_shape, eye_color, eye_shape,
  --   hair_color, hair_style, body_type, height, distinguishing_marks[], signature_outfit,
  --   style: 'photoreal'|'cinematic'|'anime' }
  descriptor       jsonb NOT NULL DEFAULT '{}'::jsonb,
  negative_traits  text NOT NULL DEFAULT '',
  -- { strategy: 'pulid'|'lora'|'kontext'|'gemini', lora_url, lora_scale, trigger_word,
  --   id_weight, base_seed, training_request_id }
  provider_config  jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT character_visual_identity_user_char_uq UNIQUE (user_id, character_id)
);

CREATE INDEX IF NOT EXISTS character_visual_identity_user_idx
  ON public.character_visual_identity (user_id);

-- 2. Every generation (including failed / in-flight) tied to character + chat.
CREATE TABLE IF NOT EXISTS public.generated_images (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             text NOT NULL,
  character_id        text NOT NULL,
  identity_id         uuid REFERENCES public.character_visual_identity(id) ON DELETE SET NULL,
  identity_version    integer NOT NULL DEFAULT 1,
  session_id          text,                    -- chat_sessions.id
  message_id          text,                    -- chat_messages.id the image is attached to
  parent_image_id     uuid REFERENCES public.generated_images(id) ON DELETE SET NULL,
  -- { op: 'new'|'regenerate'|'vary_angle'|'outfit'|'expression'|'freeform', value }
  refinement          jsonb NOT NULL DEFAULT '{"op":"new"}'::jsonb,
  user_prompt         text NOT NULL DEFAULT '',
  -- { setting, mood, lighting, composition, camera, outfit, expression, angle }
  scene               jsonb NOT NULL DEFAULT '{}'::jsonb,
  composed_prompt     text NOT NULL DEFAULT '',
  provider            text NOT NULL DEFAULT 'fal',
  model               text NOT NULL DEFAULT '',
  provider_request_id text,
  seed                bigint,
  status              text NOT NULL DEFAULT 'queued'
                        CHECK (status IN ('queued','running','completed','failed','cancelled')),
  storage_bucket      text,
  storage_path        text,
  width               integer,
  height              integer,
  content_type        text,
  byte_size           integer,
  error               text,
  is_favorite         boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  completed_at        timestamptz
);

CREATE INDEX IF NOT EXISTS generated_images_user_char_idx
  ON public.generated_images (user_id, character_id, created_at DESC);
CREATE INDEX IF NOT EXISTS generated_images_session_idx
  ON public.generated_images (user_id, session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS generated_images_parent_idx
  ON public.generated_images (parent_image_id);

-- 3. RLS (defence-in-depth; the api-server owner role bypasses it).
ALTER TABLE public.character_visual_identity ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.generated_images ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'cvi_select_own') THEN
      CREATE POLICY cvi_select_own ON public.character_visual_identity
        FOR SELECT TO authenticated USING (user_id = (auth.jwt() ->> 'sub'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'gi_select_own') THEN
      CREATE POLICY gi_select_own ON public.generated_images
        FOR SELECT TO authenticated USING (user_id = (auth.jwt() ->> 'sub'));
    END IF;
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.character_visual_identity FROM anon, authenticated;
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.generated_images FROM anon, authenticated;
  END IF;
END $$;

-- 4. Private storage bucket (Supabase only; skipped on plain Postgres).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'storage' AND table_name = 'buckets') THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES ('character-images', 'character-images', false, 10485760,
            ARRAY['image/jpeg','image/png','image/webp'])
    ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;
-- Object layout: character-images/{user_id}/{character_id}/{references|generated}/{uuid}.{ext}
-- Only the service role (api-server) writes; clients get short-lived signed URLs
-- through GET /api/photo/images/:id/file.
