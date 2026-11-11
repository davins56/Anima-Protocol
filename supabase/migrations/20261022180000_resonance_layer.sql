-- Resonance layer: frequency-tuned map nodes backed by personas, plus an
-- append-only encounter log mirrored into memory_events.
-- Non-destructive: new tables / functions / lookup rows only.

INSERT INTO public.memory_event_types (type, description)
VALUES ('resonance_encounter', 'User tuned into and opened a resonance node')
ON CONFLICT (type) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.resonance_bands (
  band        text PRIMARY KEY,
  min_freq    real NOT NULL,
  max_freq    real NOT NULL,
  color       text NOT NULL,
  description text NOT NULL DEFAULT ''
);
INSERT INTO public.resonance_bands (band, min_freq, max_freq, color, description) VALUES
  ('delta', 0,  15,  '#8b5cf6', 'deep / dreaming signals'),
  ('theta', 15, 30,  '#6366f1', 'memory and intuition'),
  ('alpha', 30, 50,  '#22d3ee', 'calm companions'),
  ('beta',  50, 70,  '#22c55e', 'active / social signals'),
  ('gamma', 70, 90,  '#f59e0b', 'charged, volatile signals'),
  ('omega', 90, 100, '#f8fafc', 'signature band (Serenity)')
ON CONFLICT (band) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.resonance_nodes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL user_id = global ambient node visible to every user.
  user_id       text,
  -- Persona backing the node: a user_entities entity_id (Anima/Character).
  -- Soft reference: user_entities has no unique (user_id, entity_id) key to
  -- point a FK at, and adding one to that legacy table is not non-destructive.
  character_id  text,
  label         text NOT NULL,
  band          text NOT NULL REFERENCES public.resonance_bands(band),
  frequency     real NOT NULL CHECK (frequency >= 0 AND frequency <= 100),
  signal_type   text NOT NULL CHECK (signal_type IN ('benign', 'companion', 'hostile', 'noise')),
  is_signature  boolean NOT NULL DEFAULT false,
  -- Map-space position (scan view), plus optional real-world anchor.
  position      jsonb NOT NULL DEFAULT '{"x":0,"y":0,"z":0}'::jsonb,
  geo_lat       double precision CHECK (geo_lat BETWEEN -90 AND 90),
  geo_lng       double precision CHECK (geo_lng BETWEEN -180 AND 180),
  -- { hours?: int[], chance?: 0..1, radius_m?: number, min_strength?: 0..1,
  --   persona?: { name, personality, greeting } (for nodes without character_id) }
  spawn_rules   jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by    text NOT NULL DEFAULT 'user' CHECK (created_by IN ('system', 'user', 'auto')),
  seed_key      text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  retired_at    timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS resonance_nodes_seed_uq
  ON public.resonance_nodes (COALESCE(user_id, ''), seed_key) WHERE seed_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS resonance_nodes_user_idx
  ON public.resonance_nodes (user_id, band) WHERE retired_at IS NULL;

-- Nodes may be moved/re-tuned (UPDATE) but never deleted: retire instead.
CREATE OR REPLACE FUNCTION public.resonance_nodes_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'resonance_nodes rows are never deleted; set retired_at instead'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.id <> OLD.id OR NEW.created_at <> OLD.created_at
     OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'resonance_nodes id/owner/created_at are immutable'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS resonance_nodes_guard ON public.resonance_nodes;
CREATE TRIGGER resonance_nodes_guard
  BEFORE UPDATE OR DELETE ON public.resonance_nodes
  FOR EACH ROW EXECUTE FUNCTION public.resonance_nodes_guard();
DROP TRIGGER IF EXISTS resonance_nodes_no_truncate ON public.resonance_nodes;
CREATE TRIGGER resonance_nodes_no_truncate
  BEFORE TRUNCATE ON public.resonance_nodes
  FOR EACH STATEMENT EXECUTE FUNCTION public.anima_forbid_mutation();

CREATE TABLE IF NOT EXISTS public.resonance_encounters (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id          uuid NOT NULL REFERENCES public.resonance_nodes(id),
  user_id          text NOT NULL,
  character_id     text,
  session_id       text,
  band             text NOT NULL,
  node_frequency   real NOT NULL,
  tuned_frequency  real NOT NULL,
  signal_strength  real NOT NULL CHECK (signal_strength BETWEEN 0 AND 1),
  signal_type      text NOT NULL,
  mode             text NOT NULL DEFAULT 'map' CHECK (mode IN ('map', 'ar', 'pan')),
  -- Coarsened (~1 km) location only, if the user granted it.
  geo_lat          real,
  geo_lng          real,
  memory_event_id  uuid REFERENCES public.memory_events(id),
  occurred_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS resonance_encounters_user_idx
  ON public.resonance_encounters (user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS resonance_encounters_node_idx
  ON public.resonance_encounters (node_id, occurred_at DESC);

DROP TRIGGER IF EXISTS resonance_encounters_immutable ON public.resonance_encounters;
CREATE TRIGGER resonance_encounters_immutable
  BEFORE UPDATE OR DELETE ON public.resonance_encounters
  FOR EACH ROW EXECUTE FUNCTION public.anima_forbid_mutation();
DROP TRIGGER IF EXISTS resonance_encounters_no_truncate ON public.resonance_encounters;
CREATE TRIGGER resonance_encounters_no_truncate
  BEFORE TRUNCATE ON public.resonance_encounters
  FOR EACH STATEMENT EXECUTE FUNCTION public.anima_forbid_mutation();

-- Log an encounter (+ memory event when the node is persona-backed).
CREATE OR REPLACE FUNCTION public.log_resonance_encounter(
  p_user_id         text,
  p_node_id         uuid,
  p_character_id    text,
  p_session_id      text,
  p_tuned_frequency real,
  p_signal_strength real,
  p_mode            text DEFAULT 'map',
  p_geo_lat         real DEFAULT NULL,
  p_geo_lng         real DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  n      public.resonance_nodes;
  ev_id  uuid;
  enc    public.resonance_encounters;
  ch     text;
BEGIN
  SELECT * INTO n FROM public.resonance_nodes
   WHERE id = p_node_id AND (user_id IS NULL OR user_id = p_user_id) AND retired_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'resonance node not found' USING ERRCODE = 'no_data_found';
  END IF;
  ch := COALESCE(n.character_id, NULLIF(p_character_id, ''));

  IF ch IS NOT NULL THEN
    INSERT INTO public.memory_events
      (user_id, character_id, conversation_id, event_type, content, payload, emotional_weight, source)
    VALUES (
      p_user_id, ch, p_session_id, 'resonance_encounter',
      'We found each other on the ' || n.band || ' band at ' || round(n.frequency::numeric, 1) || ' (' || n.label || ')',
      jsonb_build_object('node_id', n.id, 'band', n.band, 'frequency', n.frequency,
                         'signal_type', n.signal_type, 'tuned', p_tuned_frequency,
                         'strength', p_signal_strength, 'mode', p_mode, 'signature', n.is_signature),
      CASE n.signal_type WHEN 'hostile' THEN 0.7 WHEN 'companion' THEN 0.5 ELSE 0.3 END
        + CASE WHEN n.is_signature THEN 0.2 ELSE 0 END,
      'resonance'
    ) RETURNING id INTO ev_id;
  END IF;

  INSERT INTO public.resonance_encounters
    (node_id, user_id, character_id, session_id, band, node_frequency, tuned_frequency,
     signal_strength, signal_type, mode, geo_lat, geo_lng, memory_event_id)
  VALUES (
    n.id, p_user_id, ch, p_session_id, n.band, n.frequency, p_tuned_frequency,
    LEAST(1, GREATEST(0, p_signal_strength)), n.signal_type, COALESCE(p_mode, 'map'),
    round(p_geo_lat::numeric, 2), round(p_geo_lng::numeric, 2), ev_id
  ) RETURNING * INTO enc;

  RETURN jsonb_build_object('encounter', to_jsonb(enc), 'memory_event_id', ev_id, 'character_id', ch);
END $$;

-- Global ambient nodes (idempotent). Serenity's signature resolves to each
-- user's own Serenity Anima client-side (character_id NULL here).
INSERT INTO public.resonance_nodes
  (user_id, character_id, label, band, frequency, signal_type, is_signature, position, spawn_rules, created_by, seed_key)
VALUES
  (NULL, NULL, 'Serenity · signature', 'omega', 96.3, 'companion', true,
   '{"x":0,"y":0,"z":-6}', '{"persona_hint":"serenity"}', 'system', 'global:serenity-signature'),
  (NULL, NULL, 'Static Wraith', 'gamma', 77.7, 'hostile', false,
   '{"x":7,"y":0,"z":4}',
   '{"chance":0.6,"hours":[0,1,2,3,21,22,23],"persona":{"name":"Static Wraith","personality":"A corrupted signal fragment. Distrustful, cryptic, speaks in broken transmissions, but can be calmed.","greeting":"*kssh* ...who tuned... this frequency... *kssh*"}}',
   'system', 'global:static-wraith'),
  (NULL, NULL, 'Null Drift', 'delta', 6.6, 'noise', false,
   '{"x":-8,"y":0,"z":-3}', '{"chance":1}', 'system', 'global:null-drift'),
  (NULL, NULL, 'Lantern Echo', 'theta', 22.0, 'benign', false,
   '{"x":-4,"y":0,"z":7}',
   '{"persona":{"name":"Lantern Echo","personality":"A gentle archivist signal that keeps lost memories and offers them back kindly.","greeting":"Oh — a listener. I keep the small lights people forget."}}',
   'system', 'global:lantern-echo')
ON CONFLICT DO NOTHING;

ALTER TABLE public.resonance_bands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resonance_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resonance_encounters ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'resonance_bands_read') THEN
      CREATE POLICY resonance_bands_read ON public.resonance_bands FOR SELECT TO anon, authenticated USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'resonance_nodes_select') THEN
      CREATE POLICY resonance_nodes_select ON public.resonance_nodes FOR SELECT TO authenticated
        USING (user_id IS NULL OR user_id = (auth.jwt() ->> 'sub'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'resonance_encounters_select_own') THEN
      CREATE POLICY resonance_encounters_select_own ON public.resonance_encounters FOR SELECT TO authenticated
        USING (user_id = (auth.jwt() ->> 'sub'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'resonance_encounters_insert_own') THEN
      CREATE POLICY resonance_encounters_insert_own ON public.resonance_encounters FOR INSERT TO authenticated
        WITH CHECK (user_id = (auth.jwt() ->> 'sub'));
    END IF;
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.resonance_bands FROM anon, authenticated;
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.resonance_nodes FROM anon, authenticated;
    REVOKE UPDATE, DELETE, TRUNCATE ON public.resonance_encounters FROM anon, authenticated;
  END IF;
END $$;
