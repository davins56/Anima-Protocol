-- Persistent memory · layer 2: append-only, immutable event stream.
-- Rows are never updated or deleted. The single permitted UPDATE is the
-- one-time backfill of `embedding` (NULL → vector) by the embed worker.
-- To "forget" something, append a `retraction` event targeting it.

-- Event types are rows, not a Postgres ENUM: drizzle-kit push drops unknown
-- enum types, and adding a type later is a plain INSERT (non-destructive).
CREATE TABLE IF NOT EXISTS public.memory_event_types (
  type        text PRIMARY KEY,
  description text NOT NULL DEFAULT ''
);
INSERT INTO public.memory_event_types (type, description) VALUES
  ('turn', 'one user/companion exchange'),
  ('emotional_beat', 'emotionally significant moment'),
  ('decision', 'a choice made together'),
  ('image_generated', 'photo generator produced an image'),
  ('recall', 'a memory was surfaced (see memory_recalls)'),
  ('identity_changed', 'identity core advanced a version'),
  ('milestone', 'relationship milestone'),
  ('note', 'user/companion note'),
  ('retraction', 'marks payload.target_event_id as forgotten')
ON CONFLICT (type) DO NOTHING;

-- pgvector (Supabase installs extensions into schema `extensions`).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'extensions') THEN
    CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;
  ELSE
    CREATE EXTENSION IF NOT EXISTS vector;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.memory_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          text NOT NULL,
  character_id     text NOT NULL,
  conversation_id  text,                     -- chat_sessions.id
  message_id       text,                     -- chat_messages.id (nullable)
  event_type       text NOT NULL REFERENCES public.memory_event_types(type),
  content          text NOT NULL,
  payload          jsonb NOT NULL DEFAULT '{}'::jsonb,
  emotional_weight real NOT NULL DEFAULT 0.5 CHECK (emotional_weight >= 0 AND emotional_weight <= 1),
  identity_version integer,                  -- character_identity_core.version at the time
  embedding        vector(768),              -- bge-base-en-v1.5 / nomic-embed-text (768-d)
  embedding_model  text,
  dedupe_key       text,                     -- idempotent writes on retried turns
  source           text NOT NULL DEFAULT 'api',
  occurred_at      timestamptz NOT NULL DEFAULT now(),
  inserted_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS memory_events_dedupe_uq
  ON public.memory_events (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS memory_events_char_time_idx
  ON public.memory_events (user_id, character_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS memory_events_conversation_idx
  ON public.memory_events (user_id, conversation_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS memory_events_unembedded_idx
  ON public.memory_events (inserted_at) WHERE embedding IS NULL;
CREATE INDEX IF NOT EXISTS memory_events_retraction_target_idx
  ON public.memory_events ((payload ->> 'target_event_id')) WHERE event_type = 'retraction';

CREATE OR REPLACE FUNCTION public.memory_events_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.embedding IS NULL
     AND NEW.embedding IS NOT NULL
     AND (to_jsonb(NEW) - 'embedding' - 'embedding_model')
         = (to_jsonb(OLD) - 'embedding' - 'embedding_model') THEN
    RETURN NEW;  -- one-time embedding backfill only
  END IF;
  RAISE EXCEPTION 'anima: % on memory_events is forbidden (append-only)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END $$;

DROP TRIGGER IF EXISTS memory_events_immutable ON public.memory_events;
CREATE TRIGGER memory_events_immutable
  BEFORE UPDATE OR DELETE ON public.memory_events
  FOR EACH ROW EXECUTE FUNCTION public.memory_events_guard();

DROP TRIGGER IF EXISTS memory_events_no_truncate ON public.memory_events;
CREATE TRIGGER memory_events_no_truncate
  BEFORE TRUNCATE ON public.memory_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.anima_forbid_mutation();

ALTER TABLE public.memory_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'memory_events_select_own') THEN
      CREATE POLICY memory_events_select_own ON public.memory_events
        FOR SELECT TO authenticated USING (user_id = (auth.jwt() ->> 'sub'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'memory_events_insert_own') THEN
      CREATE POLICY memory_events_insert_own ON public.memory_events
        FOR INSERT TO authenticated WITH CHECK (user_id = (auth.jwt() ->> 'sub'));
    END IF;
    -- No UPDATE / DELETE policies exist, and the privileges are revoked too.
    REVOKE UPDATE, DELETE, TRUNCATE ON public.memory_events FROM anon, authenticated;
    REVOKE ALL ON public.memory_events FROM anon;
  END IF;
END $$;

-- Photo generator link: a completed generated_images row logs image_generated.
-- Additive trigger only; generated_images itself is not altered.
CREATE OR REPLACE FUNCTION public.log_image_generated_event()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'completed' AND COALESCE(OLD.status, '') <> 'completed' THEN
    INSERT INTO public.memory_events
      (user_id, character_id, conversation_id, message_id, event_type, content, payload,
       emotional_weight, identity_version, dedupe_key, source, occurred_at)
    VALUES (
      NEW.user_id, NEW.character_id, NEW.session_id, NEW.message_id, 'image_generated',
      left('Shared a photo: ' || COALESCE(NULLIF(NEW.user_prompt, ''), NEW.composed_prompt), 1000),
      jsonb_build_object('image_id', NEW.id, 'refinement', NEW.refinement, 'scene', NEW.scene,
                         'parent_image_id', NEW.parent_image_id),
      0.55, NEW.identity_version, 'image:' || NEW.id::text, 'trigger', COALESCE(NEW.completed_at, now())
    )
    ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

DO $$
BEGIN
  IF to_regclass('public.generated_images') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS generated_images_log_memory ON public.generated_images;
    CREATE TRIGGER generated_images_log_memory
      AFTER UPDATE OF status ON public.generated_images
      FOR EACH ROW EXECUTE FUNCTION public.log_image_generated_event();
  END IF;
END $$;
