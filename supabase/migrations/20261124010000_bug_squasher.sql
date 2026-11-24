-- Bug Squasher: automatic + manual bug reports, grouped by fingerprint.
-- Non-destructive and re-runnable: only CREATE ... IF NOT EXISTS / CREATE OR
-- REPLACE on new objects. No existing table, row, policy or function changes.
--
-- Design: docs/bug-squasher.md.
-- * One row per (user_id, fingerprint). A repeat of the same bug for the same
--   user bumps `count` and `last_seen` instead of adding rows.
-- * The triage view groups rows by fingerprint across users. Status changes
--   from the triage screen apply to every row with that fingerprint.
-- * A fixed bug that happens again goes back to 'new' (reopen_count + 1).
-- * The API (Clerk-authenticated, server-side admin allowlist) is the only
--   writer in production. The policies below matter only for direct Supabase
--   access: a user can insert and read only their own rows; ids listed in
--   bug_report_admins can read and triage everything. They are created only
--   when the Supabase `authenticated` role and auth.jwt() exist (plain
--   Postgres skips them; RLS stays on with no policies there).

CREATE TABLE IF NOT EXISTS public.bug_reports (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           text NOT NULL CHECK (length(btrim(user_id)) BETWEEN 1 AND 120),  -- Clerk user id
  fingerprint       text NOT NULL CHECK (fingerprint ~ '^[a-z0-9_:-]{8,80}$'),
  kind              text NOT NULL
                      CHECK (kind IN ('window_error', 'unhandled_rejection', 'react_crash',
                                      'api_error', 'chat_failure', 'manual')),
  status            text NOT NULL DEFAULT 'new'
                      CHECK (status IN ('new', 'triaged', 'fixed', 'ignored')),
  title             text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 300),
  message           text CHECK (message IS NULL OR char_length(message) <= 2000),
  stack             text CHECK (stack IS NULL OR char_length(stack) <= 8000),
  route             text CHECK (route IS NULL OR char_length(route) <= 300),
  app_version       text CHECK (app_version IS NULL OR char_length(app_version) <= 64),
  user_agent        text CHECK (user_agent IS NULL OR char_length(user_agent) <= 300),
  description       text CHECK (description IS NULL OR char_length(description) <= 4000),
  context           jsonb NOT NULL DEFAULT '{}'::jsonb,
  screenshot        text CHECK (screenshot IS NULL OR (char_length(screenshot) <= 700000
                                 AND screenshot ~ '^data:image/(jpeg|png|webp);base64,')),
  count             integer NOT NULL DEFAULT 1 CHECK (count >= 1),
  reopen_count      integer NOT NULL DEFAULT 0 CHECK (reopen_count >= 0),
  first_seen        timestamptz NOT NULL DEFAULT now(),
  last_seen         timestamptz NOT NULL DEFAULT now(),
  reopened_at       timestamptz,
  fixed_at          timestamptz,
  status_changed_at timestamptz,
  status_changed_by text,
  admin_note        text CHECK (admin_note IS NULL OR char_length(admin_note) <= 2000),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bug_reports_user_fingerprint_key UNIQUE (user_id, fingerprint),
  CONSTRAINT bug_reports_seen_order CHECK (last_seen >= first_seen),
  CONSTRAINT bug_reports_context_size CHECK (pg_column_size(context) <= 65536)
);
CREATE INDEX IF NOT EXISTS bug_reports_fingerprint_idx ON public.bug_reports (fingerprint);
CREATE INDEX IF NOT EXISTS bug_reports_status_last_seen_idx ON public.bug_reports (status, last_seen DESC);
CREATE INDEX IF NOT EXISTS bug_reports_user_first_seen_idx ON public.bug_reports (user_id, first_seen DESC);

-- Optional allowlist for direct Supabase access (the API uses
-- ANIMA_ADMIN_USER_IDS / PROTOCOL_STEWARD_USER_IDS instead).
CREATE TABLE IF NOT EXISTS public.bug_report_admins (
  user_id  text PRIMARY KEY CHECK (length(btrim(user_id)) BETWEEN 1 AND 120),
  added_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.bug_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bug_report_admins ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- Supabase only: needs both the `authenticated` role and auth.jwt().
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
     AND to_regprocedure('auth.jwt()') IS NOT NULL THEN
    -- SECURITY DEFINER so a policy can consult the admin list without
    -- granting the caller any access to it.
    EXECUTE $fn$
      CREATE OR REPLACE FUNCTION public.bug_reports_is_admin()
      RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
      SET search_path = pg_catalog, public, pg_temp AS $body$
      BEGIN
        RETURN EXISTS (
          SELECT 1 FROM public.bug_report_admins a
           WHERE a.user_id = (auth.jwt() ->> 'sub')
        );
      END
      $body$
    $fn$;
    REVOKE ALL ON FUNCTION public.bug_reports_is_admin() FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.bug_reports_is_admin() TO authenticated;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'bug_reports' AND policyname = 'bug_reports_select_own') THEN
      CREATE POLICY bug_reports_select_own ON public.bug_reports
        FOR SELECT TO authenticated USING (user_id = (auth.jwt() ->> 'sub'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'bug_reports' AND policyname = 'bug_reports_insert_own') THEN
      CREATE POLICY bug_reports_insert_own ON public.bug_reports
        FOR INSERT TO authenticated
        WITH CHECK (user_id = (auth.jwt() ->> 'sub') AND status = 'new' AND count = 1
                    AND reopen_count = 0 AND admin_note IS NULL);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'bug_reports' AND policyname = 'bug_reports_select_admin') THEN
      CREATE POLICY bug_reports_select_admin ON public.bug_reports
        FOR SELECT TO authenticated USING (public.bug_reports_is_admin());
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'bug_reports' AND policyname = 'bug_reports_update_admin') THEN
      CREATE POLICY bug_reports_update_admin ON public.bug_reports
        FOR UPDATE TO authenticated
        USING (public.bug_reports_is_admin()) WITH CHECK (public.bug_reports_is_admin());
    END IF;

    REVOKE ALL ON public.bug_reports FROM anon;
    REVOKE ALL ON public.bug_reports FROM authenticated;
    GRANT SELECT, INSERT ON public.bug_reports TO authenticated;
    -- Triage may change only status and note fields.
    GRANT UPDATE (status, admin_note, status_changed_at, status_changed_by, fixed_at, updated_at)
      ON public.bug_reports TO authenticated;
    REVOKE ALL ON public.bug_report_admins FROM anon, authenticated;
  END IF;
END $$;
