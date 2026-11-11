-- Immersive sim (4D net battle): sessions, append-only input log, arena
-- snapshots, and non-destructive memory corruption.
-- Non-destructive: new tables / functions / lookup rows only. memory_events is
-- never updated or deleted: corruption and restoration are *appended* events
-- (payload.target_event_id) that recall_memories reads as an overlay.

INSERT INTO public.memory_event_types (type, description) VALUES
  ('memory_corrupted', 'net-battle consequence: payload.target_event_id is obscured (temporary penalty, never destructive)'),
  ('memory_restored',  'Purify: payload.target_event_id is clear again'),
  ('battle_outcome',   'a validated net-battle result')
ON CONFLICT (type) DO NOTHING;

-- One row per battle. config (seed, enemies, memory pool) is fixed at creation
-- so client and server replays agree. Only the one-time finish transition
-- (outcome/ended_at/final_hash, NULL → value) is permitted afterwards.
CREATE TABLE IF NOT EXISTS public.sim_sessions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        text NOT NULL,
  character_id   text NOT NULL,              -- companion piloting the navi
  node_id        uuid,                       -- resonance_nodes.id that launched it (soft ref)
  engine_version integer NOT NULL DEFAULT 1,
  config         jsonb NOT NULL,
  outcome        text CHECK (outcome IN ('win', 'lose', 'abandoned')),
  final_tick     integer,
  final_hash     text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  ended_at       timestamptz
);
CREATE INDEX IF NOT EXISTS sim_sessions_user_time_idx ON public.sim_sessions (user_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.sim_sessions_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.outcome IS NULL AND NEW.outcome IS NOT NULL
     AND (to_jsonb(NEW) - 'outcome' - 'final_tick' - 'final_hash' - 'ended_at')
         = (to_jsonb(OLD) - 'outcome' - 'final_tick' - 'final_hash' - 'ended_at') THEN
    RETURN NEW;  -- one-time finish
  END IF;
  RAISE EXCEPTION 'anima: % on sim_sessions is forbidden (finish once only)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END $$;
DROP TRIGGER IF EXISTS sim_sessions_guarded ON public.sim_sessions;
CREATE TRIGGER sim_sessions_guarded
  BEFORE UPDATE OR DELETE ON public.sim_sessions
  FOR EACH ROW EXECUTE FUNCTION public.sim_sessions_guard();

-- Append-only input log: (session, idx) is the replay order.
CREATE TABLE IF NOT EXISTS public.sim_actions (
  session_id  uuid NOT NULL REFERENCES public.sim_sessions(id),
  idx         integer NOT NULL CHECK (idx >= 0),
  tick        integer NOT NULL CHECK (tick >= 0),
  action      jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, idx)
);
DROP TRIGGER IF EXISTS sim_actions_immutable ON public.sim_actions;
CREATE TRIGGER sim_actions_immutable
  BEFORE UPDATE OR DELETE ON public.sim_actions
  FOR EACH ROW EXECUTE FUNCTION public.anima_forbid_mutation();
DROP TRIGGER IF EXISTS sim_actions_no_truncate ON public.sim_actions;
CREATE TRIGGER sim_actions_no_truncate
  BEFORE TRUNCATE ON public.sim_actions
  FOR EACH STATEMENT EXECUTE FUNCTION public.anima_forbid_mutation();

-- Validated arena snapshots (resume + audit). Append-only.
CREATE TABLE IF NOT EXISTS public.sim_arena_snapshots (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  uuid NOT NULL REFERENCES public.sim_sessions(id),
  tick        integer NOT NULL,
  action_count integer NOT NULL,
  state_hash  text NOT NULL,
  state       jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sim_arena_snapshots_session_idx ON public.sim_arena_snapshots (session_id, tick DESC);
DROP TRIGGER IF EXISTS sim_arena_snapshots_immutable ON public.sim_arena_snapshots;
CREATE TRIGGER sim_arena_snapshots_immutable
  BEFORE UPDATE OR DELETE ON public.sim_arena_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.anima_forbid_mutation();
DROP TRIGGER IF EXISTS sim_arena_snapshots_no_truncate ON public.sim_arena_snapshots;
CREATE TRIGGER sim_arena_snapshots_no_truncate
  BEFORE TRUNCATE ON public.sim_arena_snapshots
  FOR EACH STATEMENT EXECUTE FUNCTION public.anima_forbid_mutation();

ALTER TABLE public.sim_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sim_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sim_arena_snapshots ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'sim_sessions_select_own') THEN
      CREATE POLICY sim_sessions_select_own ON public.sim_sessions
        FOR SELECT TO authenticated USING (user_id = (auth.jwt() ->> 'sub'));
    END IF;
    -- Writes go through the API (service role) only: it replays and validates.
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.sim_sessions, public.sim_actions, public.sim_arena_snapshots
      FROM anon, authenticated;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS memory_events_corruption_target_idx
  ON public.memory_events ((payload ->> 'target_event_id'))
  WHERE event_type IN ('memory_corrupted', 'memory_restored');

-- Active corruption overlay: latest corruption for a target with no later
-- restore and not yet expired (payload.expires_at; default 7 days).
CREATE OR REPLACE VIEW public.memory_corruption_active AS
SELECT DISTINCT ON (c.user_id, c.payload ->> 'target_event_id')
       c.user_id,
       c.character_id,
       (c.payload ->> 'target_event_id')::uuid AS target_event_id,
       c.id AS corruption_event_id,
       LEAST(GREATEST(COALESCE((c.payload ->> 'severity')::real, 0.5), 0.05), 1)::real AS severity,
       c.payload ->> 'band' AS band,
       c.occurred_at AS corrupted_at,
       COALESCE((c.payload ->> 'expires_at')::timestamptz, c.occurred_at + interval '7 days') AS expires_at
FROM public.memory_events c
WHERE c.event_type = 'memory_corrupted'
  AND c.payload ? 'target_event_id'
  AND COALESCE((c.payload ->> 'expires_at')::timestamptz, c.occurred_at + interval '7 days') > now()
  AND NOT EXISTS (
    SELECT 1 FROM public.memory_events r
    WHERE r.event_type = 'memory_restored'
      AND r.user_id = c.user_id
      AND r.payload ->> 'target_event_id' = c.payload ->> 'target_event_id'
      AND r.occurred_at >= c.occurred_at
  )
ORDER BY c.user_id, c.payload ->> 'target_event_id', c.occurred_at DESC;

-- recall_memories v2 (same signature and return type as v1): corrupted
-- memories rank lower (score × (1 − 0.6·severity)) and come back with
-- payload.corrupted = {severity, band, corruption_event_id, expires_at} so the
-- UI shows them glitched and the prompt gets an obscured fragment. Corruption
-- bookkeeping events themselves are never recalled.
CREATE OR REPLACE FUNCTION public.recall_memories(
  p_character_id    text,
  p_user_id         text,
  p_query_embedding vector(768) DEFAULT NULL,
  p_limit           integer DEFAULT 12,
  p_session_id      text DEFAULT NULL,
  p_half_life_days  real DEFAULT 30,
  p_w_similarity    real DEFAULT 0.6,
  p_w_recency       real DEFAULT 0.25,
  p_w_emotion       real DEFAULT 0.15,
  p_log             boolean DEFAULT true
) RETURNS TABLE (
  id               uuid,
  event_type       text,
  content          text,
  payload          jsonb,
  conversation_id  text,
  occurred_at      timestamptz,
  emotional_weight real,
  similarity       real,
  recency          real,
  score            real
)
LANGUAGE plpgsql AS $$
DECLARE
  lim integer := LEAST(GREATEST(COALESCE(p_limit, 12), 1), 50);
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT e.*,
           CASE WHEN p_query_embedding IS NULL OR e.embedding IS NULL THEN NULL
                ELSE (1 - (e.embedding <=> p_query_embedding))::real END AS sim
    FROM public.memory_events e
    WHERE e.user_id = p_user_id
      AND e.character_id = p_character_id
      AND e.event_type NOT IN ('recall', 'retraction', 'memory_corrupted', 'memory_restored')
      AND NOT EXISTS (
        SELECT 1 FROM public.memory_events r
        WHERE r.event_type = 'retraction'
          AND r.user_id = p_user_id
          AND r.payload ->> 'target_event_id' = e.id::text
      )
    ORDER BY
      CASE WHEN p_query_embedding IS NULL OR e.embedding IS NULL THEN NULL
           ELSE e.embedding <=> p_query_embedding END ASC NULLS LAST,
      e.occurred_at DESC
    LIMIT lim * 8
  ),
  scored AS (
    SELECT c.*,
           exp(-ln(2) * GREATEST(extract(epoch FROM now() - c.occurred_at), 0)
               / (86400.0 * GREATEST(p_half_life_days, 0.1)))::real AS rec,
           mc.severity AS corrupt_severity,
           mc.band AS corrupt_band,
           mc.corruption_event_id,
           mc.expires_at AS corrupt_expires_at
    FROM candidates c
    LEFT JOIN public.memory_corruption_active mc
      ON mc.user_id = p_user_id AND mc.target_event_id = c.id
  ),
  ranked AS (
    SELECT s.*,
           ((p_w_similarity * COALESCE(s.sim, 0.35)
             + p_w_recency * s.rec
             + p_w_emotion * s.emotional_weight)
            * (1 - 0.6 * COALESCE(s.corrupt_severity, 0)))::real AS blended
    FROM scored s
    ORDER BY blended DESC
    LIMIT lim
  ),
  logged AS (
    INSERT INTO public.memory_recalls
      (event_id, user_id, character_id, session_id, score, similarity, recency, event_age_s)
    SELECT r.id, p_user_id, p_character_id, p_session_id, r.blended, r.sim, r.rec,
           extract(epoch FROM now() - r.occurred_at)
    FROM ranked r
    WHERE p_log
    RETURNING 1
  )
  SELECT r.id, r.event_type, r.content,
         CASE WHEN r.corrupt_severity IS NULL THEN r.payload
              ELSE r.payload || jsonb_build_object('corrupted', jsonb_build_object(
                     'severity', r.corrupt_severity, 'band', r.corrupt_band,
                     'corruption_event_id', r.corruption_event_id, 'expires_at', r.corrupt_expires_at))
         END,
         r.conversation_id, r.occurred_at, r.emotional_weight, r.sim, r.rec, r.blended
  FROM ranked r
  ORDER BY r.blended DESC;
END $$;

-- Memory health v2: same signature; memory_count excludes corruption
-- bookkeeping, plus a corrupted_count for the header indicator.
CREATE OR REPLACE FUNCTION public.memory_health(p_user_id text, p_character_id text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'memory_count', (SELECT count(*) FROM public.memory_events
                      WHERE user_id = p_user_id AND character_id = p_character_id
                        AND event_type NOT IN ('recall','retraction','memory_corrupted','memory_restored')),
    'first_memory_at', (SELECT min(occurred_at) FROM public.memory_events
                         WHERE user_id = p_user_id AND character_id = p_character_id),
    'last_memory_at', (SELECT max(occurred_at) FROM public.memory_events
                        WHERE user_id = p_user_id AND character_id = p_character_id),
    'identity_version', (SELECT max(version) FROM public.character_identity_core
                          WHERE user_id = p_user_id AND character_id = p_character_id),
    'last_recall_at', (SELECT max(recalled_at) FROM public.memory_recalls
                        WHERE user_id = p_user_id AND character_id = p_character_id),
    'corrupted_count', (SELECT count(*) FROM public.memory_corruption_active
                         WHERE user_id = p_user_id AND character_id = p_character_id),
    'oldest_recent_recall', (
      SELECT jsonb_build_object('event_id', mr.event_id, 'age_s', mr.event_age_s,
                                'recalled_at', mr.recalled_at, 'content', left(me.content, 140))
      FROM public.memory_recalls mr JOIN public.memory_events me ON me.id = mr.event_id
      WHERE mr.user_id = p_user_id AND mr.character_id = p_character_id
        AND mr.recalled_at > now() - interval '7 days'
      ORDER BY mr.event_age_s DESC LIMIT 1)
  );
$$;
