-- 3D vessel (avatar) customization, versioned alongside the identity core.
-- Non-destructive: new table + ADD COLUMN IF NOT EXISTS + new functions only.

CREATE TABLE IF NOT EXISTS public.character_vessel (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           text NOT NULL,
  character_id      text NOT NULL,
  version           integer NOT NULL CHECK (version >= 1),
  -- VesselConfig v1 (artifacts/anima-protocol/src/lib/vessel/vesselConfig.ts):
  -- { schema: 1, base, bodyType, height, skinTone, hair{style,color}, eyes{color,glow},
  --   outfit{top,bottom,color,accent}, accessories[], effects{aura,glow,particles,color}, model{kind,url} }
  config            jsonb NOT NULL,
  snapshot_bucket   text,
  snapshot_path     text,
  change_note       text NOT NULL DEFAULT '',
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT character_vessel_version_uq UNIQUE (user_id, character_id, version)
);

CREATE INDEX IF NOT EXISTS character_vessel_lookup_idx
  ON public.character_vessel (user_id, character_id, version DESC);

DROP TRIGGER IF EXISTS character_vessel_immutable ON public.character_vessel;
CREATE TRIGGER character_vessel_immutable
  BEFORE UPDATE OR DELETE ON public.character_vessel
  FOR EACH ROW EXECUTE FUNCTION public.anima_forbid_mutation();
DROP TRIGGER IF EXISTS character_vessel_no_truncate ON public.character_vessel;
CREATE TRIGGER character_vessel_no_truncate
  BEFORE TRUNCATE ON public.character_vessel
  FOR EACH STATEMENT EXECUTE FUNCTION public.anima_forbid_mutation();

-- Identity core rows reference the vessel version that was current.
ALTER TABLE public.character_identity_core
  ADD COLUMN IF NOT EXISTS vessel_version integer;

-- Re-expand the view so it exposes the new trailing column (append-only change).
CREATE OR REPLACE VIEW public.character_identity_current AS
SELECT DISTINCT ON (user_id, character_id) *
FROM public.character_identity_core
ORDER BY user_id, character_id, version DESC;

INSERT INTO public.memory_event_types (type, description)
VALUES ('vessel_changed', '3D vessel customization saved (new vessel + identity version)')
ON CONFLICT (type) DO NOTHING;

-- Save a vessel: new vessel version → new identity core version (copying the
-- previous identity, pointing at the vessel) → vessel_changed memory event.
CREATE OR REPLACE FUNCTION public.save_vessel_version(
  p_user_id        text,
  p_character_id   text,
  p_name           text,
  p_config         jsonb,
  p_change_note    text DEFAULT '',
  p_snapshot_bucket text DEFAULT NULL,
  p_snapshot_path  text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_next   integer;
  v_row    public.character_vessel;
  prev     public.character_identity_core;
  ident    public.character_identity_core;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id || ':' || p_character_id, 0));

  SELECT COALESCE(max(version), 0) + 1 INTO v_next FROM public.character_vessel
   WHERE user_id = p_user_id AND character_id = p_character_id;
  INSERT INTO public.character_vessel
    (user_id, character_id, version, config, snapshot_bucket, snapshot_path, change_note)
  VALUES (p_user_id, p_character_id, v_next, p_config, p_snapshot_bucket, p_snapshot_path, COALESCE(p_change_note, ''))
  RETURNING * INTO v_row;

  SELECT * INTO prev FROM public.character_identity_core
   WHERE user_id = p_user_id AND character_id = p_character_id
   ORDER BY version DESC LIMIT 1;
  INSERT INTO public.character_identity_core
    (user_id, character_id, version, name, personality_matrix, voice, core_traits,
     relationships, backstory, source, change_note, vessel_version)
  VALUES (
    p_user_id, p_character_id, COALESCE(prev.version, 0) + 1,
    COALESCE(NULLIF(p_name, ''), prev.name, 'Unnamed'),
    COALESCE(prev.personality_matrix, '{}'::jsonb), COALESCE(prev.voice, '{}'::jsonb),
    COALESCE(prev.core_traits, '[]'::jsonb), COALESCE(prev.relationships, '{}'::jsonb),
    COALESCE(prev.backstory, ''), 'vessel',
    'vessel v' || v_next || CASE WHEN COALESCE(p_change_note, '') <> '' THEN ': ' || p_change_note ELSE '' END,
    v_next
  ) RETURNING * INTO ident;

  INSERT INTO public.memory_events
    (user_id, character_id, event_type, content, payload, emotional_weight, identity_version, dedupe_key, source)
  VALUES (
    p_user_id, p_character_id, 'vessel_changed',
    'My vessel changed (v' || v_next || ')' ||
      CASE WHEN COALESCE(p_change_note, '') <> '' THEN ': ' || p_change_note ELSE '' END,
    jsonb_build_object('vessel_version', v_next, 'config', p_config),
    0.45, ident.version, 'vessel:' || p_character_id || ':' || v_next, 'vessel'
  ) ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;

  RETURN jsonb_build_object('vessel', to_jsonb(v_row), 'identity_version', ident.version);
END $$;

ALTER TABLE public.character_vessel ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'character_vessel_select_own') THEN
      CREATE POLICY character_vessel_select_own ON public.character_vessel
        FOR SELECT TO authenticated USING (user_id = (auth.jwt() ->> 'sub'));
    END IF;
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.character_vessel FROM anon, authenticated;
  END IF;
END $$;
