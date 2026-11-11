-- Dream journal (docs/dream-journal-frontend-contract.md).
-- Non-destructive: two new tables. public.dreams is never touched.
--  * dream_reads    : append-only log of dreams the owner opened in the journal
--                     (independent of dream_surfacings, which means "used as opener").
--  * dream_settings : one mutable row per (user, companion); no row = dreaming enabled.

CREATE TABLE IF NOT EXISTS public.dream_reads (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dream_id     uuid NOT NULL REFERENCES public.dreams(id),
  user_id      text NOT NULL,
  character_id text NOT NULL,
  read_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, dream_id)
);
CREATE INDEX IF NOT EXISTS dream_reads_user_char_idx ON public.dream_reads (user_id, character_id);

DO $$
BEGIN
  EXECUTE 'DROP TRIGGER IF EXISTS dream_reads_immutable ON public.dream_reads';
  EXECUTE 'CREATE TRIGGER dream_reads_immutable BEFORE UPDATE OR DELETE ON public.dream_reads FOR EACH ROW EXECUTE FUNCTION public.anima_forbid_mutation()';
  EXECUTE 'DROP TRIGGER IF EXISTS dream_reads_no_truncate ON public.dream_reads';
  EXECUTE 'CREATE TRIGGER dream_reads_no_truncate BEFORE TRUNCATE ON public.dream_reads FOR EACH STATEMENT EXECUTE FUNCTION public.anima_forbid_mutation()';
  ALTER TABLE public.dream_reads ENABLE ROW LEVEL SECURITY;
END $$;

CREATE TABLE IF NOT EXISTS public.dream_settings (
  user_id          text NOT NULL,
  character_id     text NOT NULL,
  dreaming_enabled boolean NOT NULL DEFAULT true,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, character_id)
);
ALTER TABLE public.dream_settings ENABLE ROW LEVEL SECURITY;
