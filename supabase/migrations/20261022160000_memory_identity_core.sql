-- Persistent memory · layer 1: versioned, never-truncated identity core.
-- Non-destructive: only CREATE IF NOT EXISTS / CREATE OR REPLACE.
-- A character's identity is a chain of immutable versions. Changing identity
-- means appending version N+1; old versions are never updated or deleted.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.character_identity_core (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            text NOT NULL,          -- Clerk user id
  character_id       text NOT NULL,          -- user_entities.entity_id (Anima / Character)
  version            integer NOT NULL CHECK (version >= 1),
  name               text NOT NULL,
  personality_matrix jsonb NOT NULL DEFAULT '{}'::jsonb,  -- incl. lover personality matrix
  voice              jsonb NOT NULL DEFAULT '{}'::jsonb,  -- speech style, TTS voice id, anchors
  core_traits        jsonb NOT NULL DEFAULT '[]'::jsonb,
  relationships      jsonb NOT NULL DEFAULT '{}'::jsonb,
  backstory          text NOT NULL DEFAULT '',
  source             text NOT NULL DEFAULT 'app',         -- app | snapshot | import | vessel
  change_note        text NOT NULL DEFAULT '',
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT character_identity_core_version_uq UNIQUE (user_id, character_id, version)
);

CREATE INDEX IF NOT EXISTS character_identity_core_lookup_idx
  ON public.character_identity_core (user_id, character_id, version DESC);

-- Current version per character.
CREATE OR REPLACE VIEW public.character_identity_current AS
SELECT DISTINCT ON (user_id, character_id) *
FROM public.character_identity_core
ORDER BY user_id, character_id, version DESC;

-- Immutability: no UPDATE, DELETE or TRUNCATE for anyone (incl. service role).
CREATE OR REPLACE FUNCTION public.anima_forbid_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'anima: % on % is forbidden (append-only memory table)', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END $$;

DROP TRIGGER IF EXISTS character_identity_core_no_update ON public.character_identity_core;
CREATE TRIGGER character_identity_core_no_update
  BEFORE UPDATE OR DELETE ON public.character_identity_core
  FOR EACH ROW EXECUTE FUNCTION public.anima_forbid_mutation();

DROP TRIGGER IF EXISTS character_identity_core_no_truncate ON public.character_identity_core;
CREATE TRIGGER character_identity_core_no_truncate
  BEFORE TRUNCATE ON public.character_identity_core
  FOR EACH STATEMENT EXECUTE FUNCTION public.anima_forbid_mutation();

-- Append the next version atomically (advisory lock per character).
CREATE OR REPLACE FUNCTION public.append_identity_version(
  p_user_id text,
  p_character_id text,
  p_name text,
  p_personality_matrix jsonb DEFAULT NULL,
  p_voice jsonb DEFAULT NULL,
  p_core_traits jsonb DEFAULT NULL,
  p_relationships jsonb DEFAULT NULL,
  p_backstory text DEFAULT NULL,
  p_source text DEFAULT 'app',
  p_change_note text DEFAULT ''
) RETURNS public.character_identity_core
LANGUAGE plpgsql AS $$
DECLARE
  prev public.character_identity_core;
  next_row public.character_identity_core;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id || ':' || p_character_id, 0));
  SELECT * INTO prev FROM public.character_identity_core
   WHERE user_id = p_user_id AND character_id = p_character_id
   ORDER BY version DESC LIMIT 1;

  INSERT INTO public.character_identity_core
    (user_id, character_id, version, name, personality_matrix, voice, core_traits,
     relationships, backstory, source, change_note)
  VALUES (
    p_user_id, p_character_id, COALESCE(prev.version, 0) + 1,
    COALESCE(NULLIF(p_name, ''), prev.name, 'Unnamed'),
    COALESCE(p_personality_matrix, prev.personality_matrix, '{}'::jsonb),
    COALESCE(p_voice, prev.voice, '{}'::jsonb),
    COALESCE(p_core_traits, prev.core_traits, '[]'::jsonb),
    COALESCE(p_relationships, prev.relationships, '{}'::jsonb),
    COALESCE(p_backstory, prev.backstory, ''),
    COALESCE(p_source, 'app'),
    COALESCE(p_change_note, '')
  )
  RETURNING * INTO next_row;
  RETURN next_row;
END $$;

ALTER TABLE public.character_identity_core ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'identity_core_select_own') THEN
      CREATE POLICY identity_core_select_own ON public.character_identity_core
        FOR SELECT TO authenticated USING (user_id = (auth.jwt() ->> 'sub'));
    END IF;
    REVOKE UPDATE, DELETE, TRUNCATE ON public.character_identity_core FROM anon, authenticated;
    REVOKE ALL ON public.character_identity_core FROM anon;
  END IF;
END $$;
