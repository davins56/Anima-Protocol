-- Dream layer: after a quiet spell the companion "dreams" over recent memory.
-- Non-destructive: two new append-only tables + a view. Dreams never rewrite
-- memory_events; they reference source events by id and the identity core
-- version they were dreamt under.

CREATE TABLE IF NOT EXISTS public.dreams (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           text NOT NULL,
  character_id      text NOT NULL,
  identity_core_id  uuid,                    -- character_identity_core.id (soft ref)
  identity_version  integer,
  source_event_ids  uuid[] NOT NULL DEFAULT '{}',
  cluster_size      integer NOT NULL DEFAULT 0 CHECK (cluster_size >= 0),
  cohesion          real,                    -- mean cosine similarity inside the cluster
  themes            text[] NOT NULL DEFAULT '{}',
  mood              text,
  summary           text NOT NULL,           -- abstract, non-literal
  fragment          text NOT NULL,           -- one line she might let slip
  window_start      timestamptz,
  window_end        timestamptz,
  synthesizer       text NOT NULL DEFAULT 'llm' CHECK (synthesizer IN ('llm', 'template')),
  model             text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dreams_user_char_time_idx ON public.dreams (user_id, character_id, created_at DESC);

-- Every time a fragment is used as an ambient opener (keeps them rare and unrepeated).
CREATE TABLE IF NOT EXISTS public.dream_surfacings (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dream_id     uuid NOT NULL REFERENCES public.dreams(id),
  user_id      text NOT NULL,
  character_id text NOT NULL,
  surface      text NOT NULL DEFAULT 'proactive',
  session_id   text,
  surfaced_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dream_surfacings_dream_idx ON public.dream_surfacings (dream_id);
CREATE INDEX IF NOT EXISTS dream_surfacings_user_char_idx ON public.dream_surfacings (user_id, character_id, surfaced_at DESC);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['dreams', 'dream_surfacings'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t || '_immutable', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.anima_forbid_mutation()', t || '_immutable', t);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t || '_no_truncate', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.anima_forbid_mutation()', t || '_no_truncate', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'dreams_select_own') THEN
      CREATE POLICY dreams_select_own ON public.dreams FOR SELECT TO authenticated USING (user_id = (auth.jwt() ->> 'sub'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'dream_surfacings_select_own') THEN
      CREATE POLICY dream_surfacings_select_own ON public.dream_surfacings FOR SELECT TO authenticated USING (user_id = (auth.jwt() ->> 'sub'));
    END IF;
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.dreams, public.dream_surfacings FROM anon, authenticated;
  END IF;
END $$;

-- Latest dreams with surfacing counts (read model for openers / continuity).
CREATE OR REPLACE VIEW public.dream_recent AS
SELECT d.*,
       (SELECT count(*) FROM public.dream_surfacings s WHERE s.dream_id = d.id)::int AS surfaced_count
FROM public.dreams d
WHERE d.created_at > now() - interval '30 days';
