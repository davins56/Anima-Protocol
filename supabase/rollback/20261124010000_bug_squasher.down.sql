-- Rollback for supabase/migrations/20261124010000_bug_squasher.sql.
-- Run only by hand, with the owner's OK. Bug reports are diagnostics, not
-- companion memory, but this still refuses to drop a non-empty table: export
-- or triage first, then empty it deliberately.
-- Kept outside supabase/migrations/ on purpose (that folder is applied in order).

BEGIN;

DO $$
DECLARE
  n bigint;
BEGIN
  IF to_regclass('public.bug_reports') IS NOT NULL THEN
    LOCK TABLE public.bug_reports IN ACCESS EXCLUSIVE MODE;
    SELECT count(*) INTO n FROM (SELECT 1 FROM public.bug_reports LIMIT 1) s;
    IF n > 0 THEN
      RAISE EXCEPTION 'bug_squasher rollback refused: public.bug_reports is not empty';
    END IF;
  END IF;
END
$$;

DROP TABLE IF EXISTS public.bug_reports;
DROP FUNCTION IF EXISTS public.bug_reports_is_admin();
DROP TABLE IF EXISTS public.bug_report_admins;

COMMIT;
