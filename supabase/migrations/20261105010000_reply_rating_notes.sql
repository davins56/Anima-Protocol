-- Steward corrections: a "what was wrong" note alongside a thumbs-down and the
-- better version. Nullable, additive; rows stay append-only (existing triggers).
ALTER TABLE public.reply_ratings
  ADD COLUMN IF NOT EXISTS note text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reply_ratings_note_len'
  ) THEN
    ALTER TABLE public.reply_ratings
      ADD CONSTRAINT reply_ratings_note_len
      CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 600);
  END IF;
END $$;

-- The view was created with SELECT *, which Postgres expands at creation;
-- re-create it so `note` is visible. New columns are appended, so this is a
-- valid CREATE OR REPLACE.
CREATE OR REPLACE VIEW public.reply_ratings_latest AS
SELECT DISTINCT ON (user_id, message_id) *
FROM public.reply_ratings
ORDER BY user_id, message_id, created_at DESC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON public.reply_ratings_latest FROM anon, authenticated;
  END IF;
END $$;

-- Corrections are read per companion at chat time.
CREATE INDEX IF NOT EXISTS reply_ratings_user_char_idx
  ON public.reply_ratings (user_id, character_id, created_at DESC)
  WHERE rating = -1;
