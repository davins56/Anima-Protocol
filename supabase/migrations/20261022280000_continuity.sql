-- Continuity: one derived companion state read at session start on every
-- surface (chat / photo / vessel / resonance), plus append-only snapshots of
-- what was shown. Non-destructive: a view, one append-only table, and a
-- same-signature recall_memories v3 (recency floor, nothing is forgotten).

-- What each surface loaded and when (drives "unread" highlights). Append-only.
CREATE TABLE IF NOT EXISTS public.companion_state_snapshots (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       text NOT NULL,
  character_id  text NOT NULL,
  surface       text NOT NULL CHECK (surface IN ('chat', 'photo', 'vessel', 'resonance', 'home')),
  state         jsonb NOT NULL DEFAULT '{}'::jsonb,
  loaded_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS companion_state_snapshots_user_char_idx
  ON public.companion_state_snapshots (user_id, character_id, loaded_at DESC);
DROP TRIGGER IF EXISTS companion_state_snapshots_immutable ON public.companion_state_snapshots;
CREATE TRIGGER companion_state_snapshots_immutable
  BEFORE UPDATE OR DELETE ON public.companion_state_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.anima_forbid_mutation();
DROP TRIGGER IF EXISTS companion_state_snapshots_no_truncate ON public.companion_state_snapshots;
CREATE TRIGGER companion_state_snapshots_no_truncate
  BEFORE TRUNCATE ON public.companion_state_snapshots
  FOR EACH STATEMENT EXECUTE FUNCTION public.anima_forbid_mutation();
ALTER TABLE public.companion_state_snapshots ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'companion_state_snapshots_select_own') THEN
      CREATE POLICY companion_state_snapshots_select_own ON public.companion_state_snapshots
        FOR SELECT TO authenticated USING (user_id = (auth.jwt() ->> 'sub'));
    END IF;
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.companion_state_snapshots FROM anon, authenticated;
  END IF;
END $$;

-- Derived companion state (no stored copy to drift). Emotional tone lives on
-- the Drizzle-managed companion_memories table and is joined in the API
-- (lib/continuity/continuityStore.ts) so this migration has no runtime-table dependency.
-- Query with
-- WHERE user_id = $1 AND character_id = $2; every column is an indexed lookup.
CREATE OR REPLACE VIEW public.companion_state AS
WITH pairs AS (
  SELECT DISTINCT user_id, character_id FROM public.memory_events
)
SELECT
  p.user_id,
  p.character_id,
  (SELECT max(e.occurred_at) FROM public.memory_events e
    WHERE e.user_id = p.user_id AND e.character_id = p.character_id AND e.event_type = 'turn') AS last_interaction_at,
  (SELECT re.band FROM public.resonance_encounters re
    WHERE re.user_id = p.user_id AND re.character_id = p.character_id
    ORDER BY re.occurred_at DESC LIMIT 1) AS active_band,
  (SELECT max(v.version) FROM public.character_vessel v
    WHERE v.user_id = p.user_id AND v.character_id = p.character_id) AS vessel_version,
  (SELECT max(d.created_at) FROM public.dreams d
    WHERE d.user_id = p.user_id AND d.character_id = p.character_id) AS last_dream_at,
  COALESCE((SELECT jsonb_agg(jsonb_build_object('id', d.id, 'fragment', d.fragment, 'mood', d.mood,
                                                'themes', to_jsonb(d.themes), 'created_at', d.created_at)
                             ORDER BY d.created_at DESC)
            FROM (SELECT * FROM public.dreams d0
                  WHERE d0.user_id = p.user_id AND d0.character_id = p.character_id
                  ORDER BY d0.created_at DESC LIMIT 3) d), '[]'::jsonb) AS recent_dreams,
  (SELECT max(s.loaded_at) FROM public.companion_state_snapshots s
    WHERE s.user_id = p.user_id AND s.character_id = p.character_id) AS last_seen_at,
  COALESCE((SELECT jsonb_agg(jsonb_build_object('id', h.id, 'event_type', h.event_type,
                                                'content', left(h.content, 160), 'occurred_at', h.occurred_at)
                             ORDER BY h.occurred_at DESC)
            FROM (SELECT e.* FROM public.memory_events e
                  WHERE e.user_id = p.user_id AND e.character_id = p.character_id
                    AND e.emotional_weight >= 0.75
                    AND e.event_type IN ('emotional_beat', 'milestone', 'decision', 'image_generated', 'battle_outcome')
                    AND e.occurred_at > COALESCE((SELECT max(s.loaded_at) FROM public.companion_state_snapshots s
                                                  WHERE s.user_id = p.user_id AND s.character_id = p.character_id),
                                                 now() - interval '7 days')
                    AND NOT EXISTS (SELECT 1 FROM public.memory_events r
                                    WHERE r.event_type = 'retraction' AND r.user_id = e.user_id
                                      AND r.payload ->> 'target_event_id' = e.id::text)
                  ORDER BY e.occurred_at DESC LIMIT 5) h), '[]'::jsonb) AS unread_highlights
FROM pairs p;

-- recall_memories v3: same signature/return type as v2; only the recency term changes.
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
           -- v3: recency decays but never reaches zero (floor 0.12), so an
           -- old memory that is relevant still outranks a fresh irrelevant one.
           GREATEST(
             exp(-ln(2) * GREATEST(extract(epoch FROM now() - c.occurred_at), 0)
                 / (86400.0 * GREATEST(p_half_life_days, 0.1))),
             0.12)::real AS rec,
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
