-- Calendar awareness (Settings > Day Rhythm): one OAuth connection per user
-- per provider, used only to read busy/free time on the Cloudflare Worker.
-- Non-destructive: only CREATE ... IF NOT EXISTS on a new table, plus RLS and
-- grants on that table. No existing table, row, policy or function changes.
--
-- Privacy rules in force:
-- * Opt-in only: a row exists only after the user connects a calendar.
-- * Tokens at rest are AES-256-GCM ciphertext ("v1.<iv>.<ct>") sealed with the
--   Worker secret ANIMA_CALENDAR_TOKEN_KEY and bound to user+provider. No
--   access token, email address, calendar id or event data is stored here.
-- * Busy blocks themselves are NOT stored in this table. Only the latest set
--   lives on user_profiles.data.calendar_busy (start/end only, no titles) and
--   is ignored after 6 hours, like the device snapshot.
-- * Disconnect deletes the row (and revokes at Google). "Forget my rhythm
--   data" deletes every row for the user.

CREATE TABLE IF NOT EXISTS public.calendar_connections (
  user_id            text NOT NULL,                 -- Clerk user id
  provider           text NOT NULL CHECK (provider IN ('google', 'microsoft')),
  refresh_token_enc  text NOT NULL CHECK (refresh_token_enc ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'),
  scopes             text NOT NULL CHECK (length(scopes) BETWEEN 1 AND 500),
  status             text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'reauth_required')),
  last_synced_at     timestamptz,
  last_error         text CHECK (last_error IS NULL OR length(last_error) <= 200),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, provider)
);

-- Server-only table: the API's DB role bypasses RLS. No policies, so Supabase
-- client roles can read or write nothing.
ALTER TABLE public.calendar_connections ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON public.calendar_connections FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.calendar_connections FROM anon;
  END IF;
END
$$;
