-- Migration S1: Aetherial Net / Shadow Lattice persistent progress (#769).
-- DRAFT. NOT applied. Needs Dàvīn's separate OK before anyone applies it by hand.
--
-- Non-destructive and re-runnable: CREATE ... IF NOT EXISTS on 7 NEW tables,
-- one new domain, one new function, guarded triggers, RLS and grants on those
-- tables only. No existing table, row, policy or function changes.
-- Rollback (empty tables only): supabase/rollback/20261115120000_aetherial_net.down.sql
--
-- The Aetherial Net is the cyberworld; Shadow Lattice is the hidden stratum
-- beneath it; The Forbidden Depths (later) is below that. Every table carries a
-- `stratum` typed by ONE domain, so adding a stratum is a single domain-constraint swap.
--
-- Rules the API enforces (SL-4, Backend Data):
-- * user_id comes only from the Clerk session. character_id comes only from the
--   resolver: the caller's own Character/Anima row, else 'builtin:<key>' from
--   lib/companions/builtIn.ts under the caller's user_id, else 403.
-- * Every mutation runs in ONE transaction under a PER-USER lock:
--   pg_advisory_xact_lock(hashtext('aetherial_net'), hashtext(user_id)).
--   Order: lock -> dedupe lookup (replay returns here, before caps) -> load
--   snapshot + replay -> cap increment -> event insert -> rev-checked updates ->
--   reward claim -> commit. Any rev or claim failure throws and rolls back the
--   whole transaction. 23505 on the dedupe key -> re-read and return the stored
--   result (or 409 dedupe_key_conflict if request_hash differs).
-- * `denied` access-log rows are written OUTSIDE the mutation transaction.
-- * Dissonance never reads or writes resonance, emotional state or memory.
-- * Append-only guards match public.anima_forbid_mutation(): no bypass. Account
--   erasure is designed later, once, for every append-only table, in its own
--   approved migration.

-- One stratum vocabulary everywhere.
DO $$
BEGIN
  -- to_regtype (not a literal 'public' schema check) so the CI pattern, which
  -- strips "public." and applies into a disposable schema, can re-run this file.
  IF to_regtype('public.aetherial_net_stratum') IS NULL THEN
    CREATE DOMAIN public.aetherial_net_stratum AS text
      CONSTRAINT aetherial_net_stratum_ck CHECK (VALUE IN ('shadow_lattice', 'forbidden_depths'));
  END IF;
END
$$;

-- Immutability: no UPDATE, DELETE or TRUNCATE for anyone (same behaviour as
-- public.anima_forbid_mutation; separate name so this file never redefines it).
CREATE OR REPLACE FUNCTION public.aetherial_net_forbid_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'aetherial_net: % on % is forbidden (append-only table)', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END $$;

-- 1. Access log (append-only). Replaces the app-log stub. Retention is an open
--    decision (see #769); until then rows are kept.
CREATE TABLE IF NOT EXISTS public.aetherial_net_access_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       text,                                   -- null only for signed-out denials
  character_id  text,
  stratum       public.aetherial_net_stratum NOT NULL DEFAULT 'shadow_lattice',
  action        text NOT NULL CHECK (action IN ('status', 'enter', 'exit', 'move', 'denied')),
  reason        text NOT NULL CHECK (length(reason) BETWEEN 1 AND 64),
  node_id       text CHECK (node_id IS NULL OR length(node_id) <= 128),
  route         text NOT NULL CHECK (length(route) <= 128),
  request_id    text CHECK (request_id IS NULL OR length(request_id) <= 128),
  created_at    timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS aetherial_net_access_log_user_idx
  ON public.aetherial_net_access_log (user_id, created_at DESC);

-- 2. Event ledger (append-only). One row per accepted mutation of ANY kind, so
--    every mutation has a stored result for idempotent replay (B2).
--    request_hash = sha256 hex of the canonical request body without dedupe_key;
--    same key + different hash -> 409 dedupe_key_conflict.
CREATE TABLE IF NOT EXISTS public.aetherial_net_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          text NOT NULL,
  character_id     text NOT NULL,
  stratum          public.aetherial_net_stratum NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('quest_step', 'move', 'encounter', 'reward', 'checkpoint', 'exit')),
  quest_id         text CHECK (quest_id IS NULL OR length(quest_id) <= 128),
  seq              integer CHECK (seq IS NULL OR seq >= 1),
  step             text CHECK (step IS NULL OR length(step) <= 64),
  payload          jsonb NOT NULL DEFAULT '{}'::jsonb,   -- server-computed step data
  result           jsonb NOT NULL DEFAULT '{}'::jsonb,   -- response returned on replay
  content_version  text NOT NULL CHECK (length(content_version) BETWEEN 1 AND 64),
  dedupe_key       text NOT NULL CHECK (length(dedupe_key) BETWEEN 8 AND 128),
  request_hash     text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  created_at       timestamptz NOT NULL DEFAULT clock_timestamp(),
  -- quest steps carry quest_id + seq + step; other kinds may name a quest but never a seq.
  CONSTRAINT aetherial_net_events_quest_ck CHECK (
    (kind <> 'quest_step' OR (quest_id IS NOT NULL AND seq IS NOT NULL AND step IS NOT NULL))
    AND (kind = 'quest_step' OR seq IS NULL)
  ),
  CONSTRAINT aetherial_net_events_dedupe_uq UNIQUE (user_id, dedupe_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS aetherial_net_events_quest_seq_uq
  ON public.aetherial_net_events (user_id, character_id, quest_id, seq)
  WHERE kind = 'quest_step';
CREATE INDEX IF NOT EXISTS aetherial_net_events_user_char_idx
  ON public.aetherial_net_events (user_id, character_id, stratum, created_at);

-- 3. World progress per user and stratum (mutable, rev-checked).
--    `checkpoint` doubles as the replay snapshot: {content_version, through_event_id, state}.
CREATE TABLE IF NOT EXISTS public.aetherial_net_progress (
  user_id              text NOT NULL,
  stratum              public.aetherial_net_stratum NOT NULL,
  current_sector       text CHECK (current_sector IS NULL OR length(current_sector) <= 128),
  current_node         text CHECK (current_node IS NULL OR length(current_node) <= 128),
  active_character_id  text CHECK (active_character_id IS NULL OR length(active_character_id) <= 160),
  sector_progress      jsonb NOT NULL DEFAULT '{}'::jsonb,
  unlock_flags         jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(unlock_flags) = 'array'),
  checkpoint           jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_version      text NOT NULL CHECK (length(content_version) BETWEEN 1 AND 64),
  rev                  integer NOT NULL DEFAULT 0 CHECK (rev >= 0),
  last_dedupe_key      text CHECK (last_dedupe_key IS NULL OR length(last_dedupe_key) BETWEEN 8 AND 128),
  last_request_hash    text CHECK (last_request_hash IS NULL OR last_request_hash ~ '^[0-9a-f]{64}$'),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, stratum)
);

-- 4. Dissonance: local risk meter per (user, character, stratum). Separate
--    from resonance by design.
CREATE TABLE IF NOT EXISTS public.aetherial_net_dissonance (
  user_id            text NOT NULL,
  character_id       text NOT NULL,
  stratum            public.aetherial_net_stratum NOT NULL,
  level              integer NOT NULL DEFAULT 0 CHECK (level BETWEEN 0 AND 100),
  peak               integer NOT NULL DEFAULT 0 CHECK (peak BETWEEN 0 AND 100),
  last_event_id      uuid REFERENCES public.aetherial_net_events (id),   -- NO ACTION
  rev                integer NOT NULL DEFAULT 0 CHECK (rev >= 0),
  last_dedupe_key    text CHECK (last_dedupe_key IS NULL OR length(last_dedupe_key) BETWEEN 8 AND 128),
  last_request_hash  text CHECK (last_request_hash IS NULL OR last_request_hash ~ '^[0-9a-f]{64}$'),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, character_id, stratum)
);

-- 5. Inventory per user and stratum. CHECK violation (23514) -> API 409.
CREATE TABLE IF NOT EXISTS public.aetherial_net_inventory (
  user_id            text NOT NULL,
  stratum            public.aetherial_net_stratum NOT NULL,
  item_id            text NOT NULL CHECK (length(item_id) BETWEEN 1 AND 128),
  quantity           integer NOT NULL DEFAULT 0,
  max_quantity       integer NOT NULL DEFAULT 1 CHECK (max_quantity >= 1),
  last_dedupe_key    text CHECK (last_dedupe_key IS NULL OR length(last_dedupe_key) BETWEEN 8 AND 128),
  last_request_hash  text CHECK (last_request_hash IS NULL OR last_request_hash ~ '^[0-9a-f]{64}$'),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, stratum, item_id),
  CONSTRAINT aetherial_net_inventory_qty_ck CHECK (quantity >= 0 AND quantity <= max_quantity)
);

-- 6. Reward claims (append-only). Grant inventory ONLY when
--    INSERT ... ON CONFLICT DO NOTHING RETURNING id returned a row.
CREATE TABLE IF NOT EXISTS public.aetherial_net_reward_claims (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          text NOT NULL,
  character_id     text,
  stratum          public.aetherial_net_stratum NOT NULL,
  reward_id        text NOT NULL CHECK (length(reward_id) BETWEEN 1 AND 128),
  claim_key        text NOT NULL CHECK (length(claim_key) BETWEEN 1 AND 200),
  source_event_id  uuid NOT NULL REFERENCES public.aetherial_net_events (id),   -- NO ACTION
  quantity         integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  dedupe_key       text NOT NULL CHECK (length(dedupe_key) BETWEEN 8 AND 128),
  request_hash     text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  created_at       timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT aetherial_net_reward_claims_uq UNIQUE (user_id, stratum, claim_key)
);
CREATE INDEX IF NOT EXISTS aetherial_net_reward_claims_event_idx
  ON public.aetherial_net_reward_claims (source_event_id);

-- 7. Atomic caps (mutable; old windows may be pruned). window_start is computed
--    in SQL (date_trunc), never taken from the client. Increment ONLY via:
--      INSERT INTO aetherial_net_cap_counters (..., count)
--      SELECT ..., 1 WHERE $limit >= 1
--      ON CONFLICT (user_id, character_id, stratum, cap_key, window_start)
--      DO UPDATE SET count = aetherial_net_cap_counters.count + 1, updated_at = now(), ...
--      WHERE aetherial_net_cap_counters.count < $limit
--      RETURNING count;      -- no row back = cap reached
CREATE TABLE IF NOT EXISTS public.aetherial_net_cap_counters (
  user_id            text NOT NULL,
  character_id       text NOT NULL DEFAULT '',          -- '' = user-level cap
  stratum            public.aetherial_net_stratum NOT NULL,
  cap_key            text NOT NULL CHECK (length(cap_key) BETWEEN 1 AND 128),
  window_start       timestamptz NOT NULL,
  count              integer NOT NULL CHECK (count >= 1),
  last_dedupe_key    text CHECK (last_dedupe_key IS NULL OR length(last_dedupe_key) BETWEEN 8 AND 128),
  last_request_hash  text CHECK (last_request_hash IS NULL OR last_request_hash ~ '^[0-9a-f]{64}$'),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, character_id, stratum, cap_key, window_start)
);

-- Append-only guards (UPDATE/DELETE per row, TRUNCATE per statement) on the 3 ledgers.
-- Note: a plain TRUNCATE of aetherial_net_events fails earlier with 0A000
-- (referenced by FKs from dissonance and reward_claims); TRUNCATE ... CASCADE
-- reaches the trigger and gets 42501. Either way it is blocked.
DROP TRIGGER IF EXISTS aetherial_net_access_log_no_update ON public.aetherial_net_access_log;
CREATE TRIGGER aetherial_net_access_log_no_update
  BEFORE UPDATE OR DELETE ON public.aetherial_net_access_log
  FOR EACH ROW EXECUTE FUNCTION public.aetherial_net_forbid_mutation();

DROP TRIGGER IF EXISTS aetherial_net_access_log_no_truncate ON public.aetherial_net_access_log;
CREATE TRIGGER aetherial_net_access_log_no_truncate
  BEFORE TRUNCATE ON public.aetherial_net_access_log
  FOR EACH STATEMENT EXECUTE FUNCTION public.aetherial_net_forbid_mutation();

DROP TRIGGER IF EXISTS aetherial_net_events_no_update ON public.aetherial_net_events;
CREATE TRIGGER aetherial_net_events_no_update
  BEFORE UPDATE OR DELETE ON public.aetherial_net_events
  FOR EACH ROW EXECUTE FUNCTION public.aetherial_net_forbid_mutation();

DROP TRIGGER IF EXISTS aetherial_net_events_no_truncate ON public.aetherial_net_events;
CREATE TRIGGER aetherial_net_events_no_truncate
  BEFORE TRUNCATE ON public.aetherial_net_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.aetherial_net_forbid_mutation();

DROP TRIGGER IF EXISTS aetherial_net_reward_claims_no_update ON public.aetherial_net_reward_claims;
CREATE TRIGGER aetherial_net_reward_claims_no_update
  BEFORE UPDATE OR DELETE ON public.aetherial_net_reward_claims
  FOR EACH ROW EXECUTE FUNCTION public.aetherial_net_forbid_mutation();

DROP TRIGGER IF EXISTS aetherial_net_reward_claims_no_truncate ON public.aetherial_net_reward_claims;
CREATE TRIGGER aetherial_net_reward_claims_no_truncate
  BEFORE TRUNCATE ON public.aetherial_net_reward_claims
  FOR EACH STATEMENT EXECUTE FUNCTION public.aetherial_net_forbid_mutation();

-- Server-only tables: the API's DB role bypasses RLS. No policies, so Supabase
-- client roles can read or write nothing (same as calendar_connections).
ALTER TABLE public.aetherial_net_access_log    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aetherial_net_events        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aetherial_net_progress      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aetherial_net_dissonance    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aetherial_net_inventory     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aetherial_net_reward_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aetherial_net_cap_counters  ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'aetherial_net_access_log', 'aetherial_net_events', 'aetherial_net_progress',
    'aetherial_net_dissonance', 'aetherial_net_inventory', 'aetherial_net_reward_claims',
    'aetherial_net_cap_counters'
  ] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM authenticated', t);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    END IF;
  END LOOP;
END
$$;
