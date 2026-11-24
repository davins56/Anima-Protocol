-- Rollback for Migration S1 (supabase/migrations/20261115120000_aetherial_net.sql).
-- DRAFT. Run only by hand, with Dàvīn's OK, and only while every S1 table is EMPTY.
-- Once any row exists, the safe undo is: turn ANIMA_AETHERIAL_NET off and keep the tables.
-- Kept outside supabase/migrations/ on purpose (that folder is applied in order).
-- DROP TABLE is not blocked by the row/TRUNCATE guards, hence the emptiness check.
--
-- Atomic: one transaction. Each existing table is locked ACCESS EXCLUSIVE BEFORE
-- it is checked, so no row can commit between the emptiness check and the DROPs,
-- and a failure part-way leaves the schema untouched.
-- Locks are taken in the SL-4 write order (cap_counters before events), and
-- lock_timeout makes the run fail fast instead of queueing behind an open
-- transaction. Postgres's deadlock detector covers anything else; either way the
-- whole transaction rolls back and nothing is dropped.

BEGIN;
SET LOCAL lock_timeout = '10s';

DO $$
DECLARE
  t text;
  n bigint;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'aetherial_net_access_log', 'aetherial_net_cap_counters', 'aetherial_net_events',
    'aetherial_net_progress', 'aetherial_net_dissonance', 'aetherial_net_reward_claims',
    'aetherial_net_inventory'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('LOCK TABLE public.%I IN ACCESS EXCLUSIVE MODE', t);
      EXECUTE format('SELECT count(*) FROM (SELECT 1 FROM public.%I LIMIT 1) s', t) INTO n;
      IF n > 0 THEN
        RAISE EXCEPTION 'aetherial_net rollback refused: public.% is not empty', t;
      END IF;
    END IF;
  END LOOP;
END
$$;

-- Dependents first (FKs into aetherial_net_events).
DROP TABLE IF EXISTS public.aetherial_net_reward_claims;
DROP TABLE IF EXISTS public.aetherial_net_dissonance;
DROP TABLE IF EXISTS public.aetherial_net_cap_counters;
DROP TABLE IF EXISTS public.aetherial_net_inventory;
DROP TABLE IF EXISTS public.aetherial_net_progress;
DROP TABLE IF EXISTS public.aetherial_net_events;
DROP TABLE IF EXISTS public.aetherial_net_access_log;
DROP FUNCTION IF EXISTS public.aetherial_net_forbid_mutation();
DROP DOMAIN IF EXISTS public.aetherial_net_stratum;

COMMIT;
