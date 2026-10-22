-- Serenity voice: per-character voice selection (xAI built-in or custom/cloned
-- voice_id), versioned alongside the identity core. Non-destructive.

INSERT INTO public.memory_event_types (type, description)
VALUES ('voice_changed', 'Companion voice changed (new voice + identity version)')
ON CONFLICT (type) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.character_voice (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            text NOT NULL,
  character_id       text NOT NULL,
  version            integer NOT NULL CHECK (version >= 1),
  provider           text NOT NULL DEFAULT 'xai' CHECK (provider IN ('xai')),
  -- xAI built-in voice id (e.g. 'eve') or 8-char custom voice id.
  voice_id           text NOT NULL CHECK (voice_id ~ '^[a-z0-9_-]{2,40}$'),
  voice_kind         text NOT NULL CHECK (voice_kind IN ('builtin', 'custom')),
  display_name       text,
  language           text,
  -- Realtime session preferences: { speed?: 0.7..1.5, reasoning_effort?: 'high'|'none', replace?: {} }
  settings           jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Clone provenance (no audio is stored by default).
  clone_source       text CHECK (clone_source IS NULL OR clone_source IN ('api', 'console')),
  reference_seconds  real CHECK (reference_seconds IS NULL OR (reference_seconds > 0 AND reference_seconds <= 120)),
  consent_attested   boolean NOT NULL DEFAULT false,
  change_note        text NOT NULL DEFAULT '',
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT character_voice_version_uq UNIQUE (user_id, character_id, version),
  CONSTRAINT character_voice_custom_consent CHECK (voice_kind <> 'custom' OR consent_attested)
);
CREATE INDEX IF NOT EXISTS character_voice_lookup_idx
  ON public.character_voice (user_id, character_id, version DESC);

DROP TRIGGER IF EXISTS character_voice_immutable ON public.character_voice;
CREATE TRIGGER character_voice_immutable
  BEFORE UPDATE OR DELETE ON public.character_voice
  FOR EACH ROW EXECUTE FUNCTION public.anima_forbid_mutation();
DROP TRIGGER IF EXISTS character_voice_no_truncate ON public.character_voice;
CREATE TRIGGER character_voice_no_truncate
  BEFORE TRUNCATE ON public.character_voice
  FOR EACH STATEMENT EXECUTE FUNCTION public.anima_forbid_mutation();

ALTER TABLE public.character_identity_core
  ADD COLUMN IF NOT EXISTS voice_version integer;

CREATE OR REPLACE VIEW public.character_identity_current AS
SELECT DISTINCT ON (user_id, character_id) *
FROM public.character_identity_core
ORDER BY user_id, character_id, version DESC;

-- New voice version → new identity version (voice jsonb + voice_version) → voice_changed event.
CREATE OR REPLACE FUNCTION public.save_voice_version(
  p_user_id          text,
  p_character_id     text,
  p_name             text,
  p_voice_id         text,
  p_voice_kind       text,
  p_display_name     text DEFAULT NULL,
  p_language         text DEFAULT NULL,
  p_settings         jsonb DEFAULT '{}'::jsonb,
  p_clone_source     text DEFAULT NULL,
  p_reference_seconds real DEFAULT NULL,
  p_consent          boolean DEFAULT false,
  p_change_note      text DEFAULT ''
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_next integer;
  v_row  public.character_voice;
  prev   public.character_identity_core;
  ident  public.character_identity_core;
  v_json jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id || ':' || p_character_id, 0));

  SELECT COALESCE(max(version), 0) + 1 INTO v_next FROM public.character_voice
   WHERE user_id = p_user_id AND character_id = p_character_id;
  INSERT INTO public.character_voice
    (user_id, character_id, version, voice_id, voice_kind, display_name, language, settings,
     clone_source, reference_seconds, consent_attested, change_note)
  VALUES (p_user_id, p_character_id, v_next, p_voice_id, p_voice_kind, p_display_name, p_language,
          COALESCE(p_settings, '{}'::jsonb), p_clone_source, p_reference_seconds, COALESCE(p_consent, false),
          COALESCE(p_change_note, ''))
  RETURNING * INTO v_row;

  v_json := jsonb_build_object('provider', 'xai', 'voice_id', p_voice_id, 'kind', p_voice_kind,
                               'name', p_display_name, 'voice_version', v_next);

  SELECT * INTO prev FROM public.character_identity_core
   WHERE user_id = p_user_id AND character_id = p_character_id
   ORDER BY version DESC LIMIT 1;
  INSERT INTO public.character_identity_core
    (user_id, character_id, version, name, personality_matrix, voice, core_traits,
     relationships, backstory, source, change_note, vessel_version, voice_version)
  VALUES (
    p_user_id, p_character_id, COALESCE(prev.version, 0) + 1,
    COALESCE(NULLIF(p_name, ''), prev.name, 'Unnamed'),
    COALESCE(prev.personality_matrix, '{}'::jsonb),
    COALESCE(prev.voice, '{}'::jsonb) || jsonb_build_object('realtime', v_json),
    COALESCE(prev.core_traits, '[]'::jsonb), COALESCE(prev.relationships, '{}'::jsonb),
    COALESCE(prev.backstory, ''), 'voice',
    'voice v' || v_next || ' (' || p_voice_id || ')', prev.vessel_version, v_next
  ) RETURNING * INTO ident;

  INSERT INTO public.memory_events
    (user_id, character_id, event_type, content, payload, emotional_weight, identity_version, dedupe_key, source)
  VALUES (
    p_user_id, p_character_id, 'voice_changed',
    'My voice changed to ' || COALESCE(p_display_name, p_voice_id) ||
      CASE WHEN p_voice_kind = 'custom' THEN ' (a custom voice)' ELSE '' END,
    v_json, 0.4, ident.version, 'voice:' || p_character_id || ':' || v_next, 'voice'
  ) ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;

  RETURN jsonb_build_object('voice', to_jsonb(v_row), 'identity_version', ident.version);
END $$;

ALTER TABLE public.character_voice ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'character_voice_select_own') THEN
      CREATE POLICY character_voice_select_own ON public.character_voice
        FOR SELECT TO authenticated USING (user_id = (auth.jwt() ->> 'sub'));
    END IF;
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.character_voice FROM anon, authenticated;
  END IF;
END $$;
