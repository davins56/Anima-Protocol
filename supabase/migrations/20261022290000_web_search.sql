-- Web search for companions: per-identity-core flag + append-only audit.
-- Non-destructive: one nullable column (no default, no row rewrite), one new
-- append-only table, one memory event type. No stored row is changed.

-- NULL = use the default rule in the API (on for built-in Serenity, off for
-- user-created companions). Set explicitly by appending an identity version.
-- The resolver reads the newest version with a non-NULL value, so the flag
-- carries forward across later versions.
ALTER TABLE public.character_identity_core ADD COLUMN IF NOT EXISTS search_enabled boolean;

INSERT INTO public.memory_event_types (type, description) VALUES
  ('web_result', 'a web search result the user chose to save: payload {audit_id, url, title}')
ON CONFLICT (type) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.search_audit (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          text NOT NULL,
  character_id     text NOT NULL,
  query            text NOT NULL,
  provider         text,                     -- brave | serper | NULL when not reached
  status           text NOT NULL CHECK (status IN ('ok', 'empty', 'query_blocked', 'rate_limited', 'disabled', 'not_configured', 'error')),
  results          jsonb NOT NULL DEFAULT '[]'::jsonb,   -- kept results passed to the prompt
  filter_decisions jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{url, verdict, reasons}] incl. dropped
  result_count     integer NOT NULL DEFAULT 0,
  dropped_count    integer NOT NULL DEFAULT 0,
  saved_as_memory  boolean NOT NULL DEFAULT false,
  latency_ms       integer,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS search_audit_user_day_idx ON public.search_audit (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS search_audit_user_char_idx ON public.search_audit (user_id, character_id, created_at DESC);

DROP TRIGGER IF EXISTS search_audit_immutable ON public.search_audit;
CREATE TRIGGER search_audit_immutable
  BEFORE UPDATE OR DELETE ON public.search_audit
  FOR EACH ROW EXECUTE FUNCTION public.anima_forbid_mutation();
DROP TRIGGER IF EXISTS search_audit_no_truncate ON public.search_audit;
CREATE TRIGGER search_audit_no_truncate
  BEFORE TRUNCATE ON public.search_audit
  FOR EACH STATEMENT EXECUTE FUNCTION public.anima_forbid_mutation();
ALTER TABLE public.search_audit ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'search_audit_select_own') THEN
      CREATE POLICY search_audit_select_own ON public.search_audit
        FOR SELECT TO authenticated USING (user_id = (auth.jwt() ->> 'sub'));
    END IF;
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.search_audit FROM anon, authenticated;
  END IF;
END $$;
