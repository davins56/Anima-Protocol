-- Persistent memory · layer 3: retrieval (pgvector), recall log, session bootstrap.

CREATE INDEX IF NOT EXISTS memory_events_embedding_hnsw
  ON public.memory_events USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Every time a memory is surfaced into a prompt. Append-only.
CREATE TABLE IF NOT EXISTS public.memory_recalls (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      uuid NOT NULL REFERENCES public.memory_events(id),
  user_id       text NOT NULL,
  character_id  text NOT NULL,
  session_id    text,
  score         real NOT NULL,
  similarity    real,
  recency       real,
  event_age_s   double precision NOT NULL,   -- age of the memory when recalled
  recalled_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS memory_recalls_char_time_idx
  ON public.memory_recalls (user_id, character_id, recalled_at DESC);
CREATE INDEX IF NOT EXISTS memory_recalls_event_idx
  ON public.memory_recalls (event_id, recalled_at DESC);

DROP TRIGGER IF EXISTS memory_recalls_immutable ON public.memory_recalls;
CREATE TRIGGER memory_recalls_immutable
  BEFORE UPDATE OR DELETE ON public.memory_recalls
  FOR EACH ROW EXECUTE FUNCTION public.anima_forbid_mutation();
DROP TRIGGER IF EXISTS memory_recalls_no_truncate ON public.memory_recalls;
CREATE TRIGGER memory_recalls_no_truncate
  BEFORE TRUNCATE ON public.memory_recalls
  FOR EACH STATEMENT EXECUTE FUNCTION public.anima_forbid_mutation();

ALTER TABLE public.memory_recalls ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'memory_recalls_select_own') THEN
      CREATE POLICY memory_recalls_select_own ON public.memory_recalls
        FOR SELECT TO authenticated USING (user_id = (auth.jwt() ->> 'sub'));
    END IF;
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.memory_recalls FROM anon, authenticated;
  END IF;
END $$;

-- Blended ranking: similarity, recency decay (half-life), emotional weight.
-- Retracted events are excluded. Logs each returned memory to memory_recalls.
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
      AND e.event_type NOT IN ('recall', 'retraction')
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
               / (86400.0 * GREATEST(p_half_life_days, 0.1)))::real AS rec
    FROM candidates c
  ),
  ranked AS (
    SELECT s.*,
           (p_w_similarity * COALESCE(s.sim, 0.35)
            + p_w_recency * s.rec
            + p_w_emotion * s.emotional_weight)::real AS blended
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
  SELECT r.id, r.event_type, r.content, r.payload, r.conversation_id, r.occurred_at,
         r.emotional_weight, r.sim, r.rec, r.blended
  FROM ranked r
  ORDER BY r.blended DESC;
END $$;

-- Memory health per character (used by the chat header indicator).
CREATE OR REPLACE FUNCTION public.memory_health(p_user_id text, p_character_id text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'memory_count', (SELECT count(*) FROM public.memory_events
                      WHERE user_id = p_user_id AND character_id = p_character_id
                        AND event_type NOT IN ('recall','retraction')),
    'first_memory_at', (SELECT min(occurred_at) FROM public.memory_events
                         WHERE user_id = p_user_id AND character_id = p_character_id),
    'last_memory_at', (SELECT max(occurred_at) FROM public.memory_events
                        WHERE user_id = p_user_id AND character_id = p_character_id),
    'identity_version', (SELECT max(version) FROM public.character_identity_core
                          WHERE user_id = p_user_id AND character_id = p_character_id),
    'last_recall_at', (SELECT max(recalled_at) FROM public.memory_recalls
                        WHERE user_id = p_user_id AND character_id = p_character_id),
    -- Oldest memory surfaced in the last 7 days ("she remembered something from N days ago").
    'oldest_recent_recall', (
      SELECT jsonb_build_object('event_id', mr.event_id, 'age_s', mr.event_age_s,
                                'recalled_at', mr.recalled_at, 'content', left(me.content, 140))
      FROM public.memory_recalls mr JOIN public.memory_events me ON me.id = mr.event_id
      WHERE mr.user_id = p_user_id AND mr.character_id = p_character_id
        AND mr.recalled_at > now() - interval '7 days'
      ORDER BY mr.event_age_s DESC LIMIT 1)
  );
$$;

-- Session bootstrap: current identity core + ranked memory slice + health.
CREATE OR REPLACE FUNCTION public.bootstrap_session_context(
  p_user_id         text,
  p_character_id    text,
  p_query_embedding vector(768) DEFAULT NULL,
  p_limit           integer DEFAULT 12,
  p_session_id      text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  ident jsonb;
  mems  jsonb;
BEGIN
  SELECT to_jsonb(c) INTO ident FROM public.character_identity_current c
   WHERE c.user_id = p_user_id AND c.character_id = p_character_id;
  SELECT COALESCE(jsonb_agg(to_jsonb(m) ORDER BY m.score DESC), '[]'::jsonb) INTO mems
    FROM public.recall_memories(p_character_id, p_user_id, p_query_embedding, p_limit, p_session_id) m;
  RETURN jsonb_build_object(
    'identity', ident,
    'memories', mems,
    'health', public.memory_health(p_user_id, p_character_id)
  );
END $$;
