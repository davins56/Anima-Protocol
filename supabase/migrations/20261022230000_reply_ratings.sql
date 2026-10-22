-- Reply ratings (thumbs up/down + optional better version). Append-only: a
-- changed mind is a new row; the latest row per (user, message) wins via the
-- reply_ratings_latest view. Exported as chosen/rejected preference pairs
-- (lib/llm PreferencePairExport, modelTutor DPO JSONL).
CREATE TABLE IF NOT EXISTS public.reply_ratings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       text NOT NULL,
  session_id    text NOT NULL,
  message_id    text NOT NULL,
  turn_id       text,
  character_id  text,
  character_name text,
  rating        smallint NOT NULL CHECK (rating IN (-1, 0, 1)),  -- 0 = rating withdrawn
  reply         text NOT NULL CHECK (char_length(reply) BETWEEN 1 AND 8000),
  better_reply  text CHECK (better_reply IS NULL OR char_length(better_reply) BETWEEN 1 AND 4000),
  context       jsonb NOT NULL DEFAULT '[]'::jsonb,               -- [{role, content}] up to 12 turns
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reply_ratings_user_msg_idx
  ON public.reply_ratings (user_id, message_id, created_at DESC);

DROP TRIGGER IF EXISTS reply_ratings_immutable ON public.reply_ratings;
CREATE TRIGGER reply_ratings_immutable
  BEFORE UPDATE OR DELETE ON public.reply_ratings
  FOR EACH ROW EXECUTE FUNCTION public.anima_forbid_mutation();
DROP TRIGGER IF EXISTS reply_ratings_no_truncate ON public.reply_ratings;
CREATE TRIGGER reply_ratings_no_truncate
  BEFORE TRUNCATE ON public.reply_ratings
  FOR EACH STATEMENT EXECUTE FUNCTION public.anima_forbid_mutation();

CREATE OR REPLACE VIEW public.reply_ratings_latest AS
SELECT DISTINCT ON (user_id, message_id) *
FROM public.reply_ratings
ORDER BY user_id, message_id, created_at DESC;

ALTER TABLE public.reply_ratings ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'reply_ratings_select_own') THEN
      CREATE POLICY reply_ratings_select_own ON public.reply_ratings
        FOR SELECT TO authenticated USING (user_id = (auth.jwt() ->> 'sub'));
    END IF;
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.reply_ratings FROM anon, authenticated;
    REVOKE ALL ON public.reply_ratings_latest FROM anon, authenticated;
  END IF;
END $$;
