-- Guardrails for user-commanded companion tools (web search, page read,
-- registered webhooks, webpage actions). Schema only: no route or chat code.
-- Non-destructive: only CREATE ... IF NOT EXISTS / CREATE OR REPLACE on new
-- objects. No existing table, row, policy or function is changed.
--
-- Design: docs/tools-guardrails.md. Decisions in force:
-- * A tool runs only from an explicit command or button in a user-typed chat
--   turn, never from plain language, initiative, background or cron turns.
--   Every action-log row names that turn (turn_id, user_message_id =
--   turn_id || ':user', conversation_id = chat_sessions.id) and the trigger
--   kind ('command' | 'button'). The one exception is a webhook test from
--   Settings ('settings_test'), which has no chat turn and must say so.
-- * Permissions are per companion: (user_id, character_id, tool). No row means
--   not allowed.
-- * The global kill switch is the Worker setting ANIMA_TOOLS_KILL (no table).
--   The per-user kill switch is tool_user_settings.tools_killed.
-- * Outside fetches run on the Cloudflare Worker. target_host / resolved_ip
--   record what was checked; the Worker cannot pin the IP it connects to.

-- 1) Per-user kill switch. One mutable row per user; no row = not killed.
CREATE TABLE IF NOT EXISTS public.tool_user_settings (
  user_id      text PRIMARY KEY,                  -- Clerk user id
  tools_killed boolean NOT NULL DEFAULT false,
  killed_at    timestamptz,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tool_user_settings_killed_at CHECK (NOT tools_killed OR killed_at IS NOT NULL)
);

-- 2) Allow list per user, per companion, per tool. No row = not allowed.
CREATE TABLE IF NOT EXISTS public.tool_permissions (
  user_id      text NOT NULL,
  character_id text NOT NULL,                     -- user_entities.entity_id (Anima / Character)
  tool         text NOT NULL CHECK (tool IN ('web_search', 'web_read', 'webhook', 'browser')),
  allowed      boolean NOT NULL DEFAULT false,
  -- The server always requires confirmation for submit/purchase/post/send and
  -- webhook calls. confirm_all can only ADD confirmations, never remove them.
  confirm_all  boolean NOT NULL DEFAULT false,
  daily_limit  integer CHECK (daily_limit IS NULL OR daily_limit BETWEEN 0 AND 500),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, character_id, tool)
);

-- 3) Pending confirmations: one row per action that submits, buys, posts,
--    sends or calls a webhook. Changes once, from pending; never deleted.
CREATE TABLE IF NOT EXISTS public.tool_pending_confirmations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id        uuid NOT NULL UNIQUE,
  user_id          text NOT NULL,
  character_id     text NOT NULL,
  conversation_id  text NOT NULL,                 -- chat_sessions.id
  turn_id          text NOT NULL,                 -- chat_turns.id
  user_message_id  text NOT NULL,                 -- chat_turns.user_message_id
  tool             text NOT NULL CHECK (tool IN ('webhook', 'browser')),
  action_kind      text NOT NULL CHECK (action_kind IN ('submit', 'purchase', 'post', 'send', 'webhook_call')),
  target           text NOT NULL CHECK (length(btrim(target)) > 0),           -- domain or webhook name
  payload_summary  text NOT NULL CHECK (length(btrim(payload_summary)) > 0),  -- exactly what will be sent
  amount           numeric(14, 2) CHECK (amount IS NULL OR amount >= 0),
  currency         text CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),  -- ISO 4217
  request_hash     text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),     -- sha256 hex of the canonical request
  status           text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'confirmed', 'denied', 'expired', 'cancelled')),
  expires_at       timestamptz NOT NULL,
  decided_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tool_pending_user_message CHECK (user_message_id = turn_id || ':user'),
  CONSTRAINT tool_pending_amount_pair  CHECK ((amount IS NULL) = (currency IS NULL)),
  CONSTRAINT tool_pending_purchase_amount CHECK (action_kind <> 'purchase' OR amount IS NOT NULL),
  CONSTRAINT tool_pending_expiry       CHECK (expires_at > created_at),
  CONSTRAINT tool_pending_decided      CHECK ((status = 'pending') = (decided_at IS NULL))
);
CREATE INDEX IF NOT EXISTS tool_pending_user_status_idx
  ON public.tool_pending_confirmations (user_id, status, expires_at);

-- Rows enter as pending. Only status may change (decided_at is stamped here),
-- once, from pending. 'confirmed' never after expiry; 'expired' only after it.
-- DELETE is forbidden. Uses clock_timestamp() so a long transaction cannot
-- confirm with a stale now().
CREATE OR REPLACE FUNCTION public.anima_tool_confirmation_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'pending' OR NEW.decided_at IS NOT NULL THEN
      RAISE EXCEPTION 'anima: confirmation must be created pending'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'anima: % on % is forbidden', TG_OP, TG_TABLE_NAME
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'anima: confirmation % already %', OLD.id, OLD.status
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.status = 'pending'
     OR (NEW.id, NEW.action_id, NEW.user_id, NEW.character_id, NEW.conversation_id, NEW.turn_id,
         NEW.user_message_id, NEW.tool, NEW.action_kind, NEW.target, NEW.payload_summary,
         NEW.amount, NEW.currency, NEW.request_hash, NEW.expires_at, NEW.created_at)
        IS DISTINCT FROM
        (OLD.id, OLD.action_id, OLD.user_id, OLD.character_id, OLD.conversation_id, OLD.turn_id,
         OLD.user_message_id, OLD.tool, OLD.action_kind, OLD.target, OLD.payload_summary,
         OLD.amount, OLD.currency, OLD.request_hash, OLD.expires_at, OLD.created_at) THEN
    RAISE EXCEPTION 'anima: only status may change, once, from pending'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.status = 'confirmed' AND clock_timestamp() >= OLD.expires_at THEN
    RAISE EXCEPTION 'anima: confirmation % expired', OLD.id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.status = 'expired' AND clock_timestamp() < OLD.expires_at THEN
    RAISE EXCEPTION 'anima: confirmation % has not expired yet', OLD.id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  NEW.decided_at := clock_timestamp();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS tool_pending_guard ON public.tool_pending_confirmations;
CREATE TRIGGER tool_pending_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.tool_pending_confirmations
  FOR EACH ROW EXECUTE FUNCTION public.anima_tool_confirmation_guard();
DROP TRIGGER IF EXISTS tool_pending_no_truncate ON public.tool_pending_confirmations;
CREATE TRIGGER tool_pending_no_truncate
  BEFORE TRUNCATE ON public.tool_pending_confirmations
  FOR EACH STATEMENT EXECUTE FUNCTION public.anima_forbid_mutation();

-- 4) Append-only action log. One row per event; action_id groups the events of
--    one tool call and seq orders them (1, 2, 3, ... per action).
CREATE TABLE IF NOT EXISTS public.tool_action_log (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id        uuid NOT NULL,
  seq              integer NOT NULL CHECK (seq >= 1),
  user_id          text NOT NULL,
  character_id     text NOT NULL,
  conversation_id  text,                          -- chat_sessions.id
  turn_id          text,                          -- chat_turns.id of the triggering user turn
  user_message_id  text,                          -- chat_turns.user_message_id ("<turn_id>:user")
  tool             text NOT NULL CHECK (tool IN ('web_search', 'web_read', 'webhook', 'browser')),
  event            text NOT NULL CHECK (event IN (
                     'started', 'confirmation_required', 'progress', 'succeeded',
                     'failed', 'denied', 'expired', 'stopped')),
  trigger_kind     text NOT NULL CHECK (trigger_kind IN ('command', 'button', 'settings_test')),
  reason           text,                          -- e.g. not_allowed, killed, user_denied, user_stop, ssrf_blocked, limit
  confirmation_id  uuid REFERENCES public.tool_pending_confirmations (id),
  request          jsonb NOT NULL DEFAULT '{}'::jsonb,  -- redacted args, never secrets
  result           jsonb NOT NULL DEFAULT '{}'::jsonb,  -- redacted summary, never secrets
  target_host      text,
  resolved_ip      inet,                          -- address the Worker checked; not pinned at connect
  search_audit_id  uuid,                          -- search_audit.id when tool = web_search
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tool_action_log_seq_uq UNIQUE (action_id, seq),
  -- Chat-triggered events must name the user-typed turn that triggered them.
  -- A Settings webhook test has no turn and may not pretend to have one.
  CONSTRAINT tool_action_log_needs_turn CHECK (
    (trigger_kind IN ('command', 'button')
      AND turn_id IS NOT NULL AND conversation_id IS NOT NULL
      AND user_message_id IS NOT NULL AND user_message_id = turn_id || ':user')
    OR
    (trigger_kind = 'settings_test' AND tool = 'webhook'
      AND turn_id IS NULL AND user_message_id IS NULL AND conversation_id IS NULL)
  ),
  CONSTRAINT tool_action_log_confirmation_link CHECK (
    event <> 'confirmation_required' OR confirmation_id IS NOT NULL
  )
);
CREATE INDEX IF NOT EXISTS tool_action_log_user_time_idx ON public.tool_action_log (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS tool_action_log_turn_idx      ON public.tool_action_log (user_id, turn_id);
CREATE INDEX IF NOT EXISTS tool_action_log_user_char_idx ON public.tool_action_log (user_id, character_id, created_at DESC);
-- An action is claimed (and run) at most once.
CREATE UNIQUE INDEX IF NOT EXISTS tool_action_log_started_once
  ON public.tool_action_log (action_id) WHERE event = 'started';

-- Insert guard: keeps each action's trace consistent.
-- * seq 1 opens the action with started, confirmation_required or denied.
-- * Later rows must be the next seq, repeat the opening row's user, companion,
--   conversation, turn, message, tool and trigger_kind, and cannot follow a
--   terminal event (succeeded, failed, denied, expired, stopped).
-- * A confirmation_id must belong to the same action, user and turn.
-- * 'started' after 'confirmation_required' needs that confirmation confirmed.
CREATE OR REPLACE FUNCTION public.anima_tool_action_log_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  first_row public.tool_action_log%ROWTYPE;
  last_seq  integer;
  finished  boolean;
  pending   public.tool_pending_confirmations%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('tool_action_log'), hashtext(NEW.action_id::text));

  IF NEW.confirmation_id IS NOT NULL THEN
    SELECT * INTO pending FROM public.tool_pending_confirmations WHERE id = NEW.confirmation_id;
    IF NOT FOUND
       OR pending.action_id <> NEW.action_id
       OR pending.user_id <> NEW.user_id
       OR pending.turn_id IS DISTINCT FROM NEW.turn_id THEN
      RAISE EXCEPTION 'anima: confirmation % does not belong to action %', NEW.confirmation_id, NEW.action_id
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  SELECT max(seq),
         bool_or(event IN ('succeeded', 'failed', 'denied', 'expired', 'stopped'))
    INTO last_seq, finished
    FROM public.tool_action_log WHERE action_id = NEW.action_id;

  IF last_seq IS NULL THEN
    IF NEW.seq <> 1 OR NEW.event NOT IN ('started', 'confirmation_required', 'denied') THEN
      RAISE EXCEPTION 'anima: action % must open with seq 1 and started, confirmation_required or denied', NEW.action_id
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF finished THEN
    RAISE EXCEPTION 'anima: action % already finished', NEW.action_id
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.seq <> last_seq + 1 THEN
    RAISE EXCEPTION 'anima: action % expects seq %, got %', NEW.action_id, last_seq + 1, NEW.seq
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO first_row FROM public.tool_action_log WHERE action_id = NEW.action_id AND seq = 1;
  IF (NEW.user_id, NEW.character_id, NEW.conversation_id, NEW.turn_id, NEW.user_message_id, NEW.tool, NEW.trigger_kind)
     IS DISTINCT FROM
     (first_row.user_id, first_row.character_id, first_row.conversation_id, first_row.turn_id,
      first_row.user_message_id, first_row.tool, first_row.trigger_kind) THEN
    RAISE EXCEPTION 'anima: action % events must keep the opening row''s user, turn and tool', NEW.action_id
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.event = 'started' THEN
    SELECT p.* INTO pending
      FROM public.tool_action_log l
      JOIN public.tool_pending_confirmations p ON p.id = l.confirmation_id
     WHERE l.action_id = NEW.action_id AND l.event = 'confirmation_required'
     ORDER BY l.seq DESC LIMIT 1;
    IF FOUND AND pending.status <> 'confirmed' THEN
      RAISE EXCEPTION 'anima: action % cannot start: confirmation is %', NEW.action_id, pending.status
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS tool_action_log_insert_guard ON public.tool_action_log;
CREATE TRIGGER tool_action_log_insert_guard
  BEFORE INSERT ON public.tool_action_log
  FOR EACH ROW EXECUTE FUNCTION public.anima_tool_action_log_guard();

-- Append-only: same guard as memory_recalls / search_audit
-- (public.anima_forbid_mutation, 20261022160000_memory_identity_core.sql).
DROP TRIGGER IF EXISTS tool_action_log_immutable ON public.tool_action_log;
CREATE TRIGGER tool_action_log_immutable
  BEFORE UPDATE OR DELETE ON public.tool_action_log
  FOR EACH ROW EXECUTE FUNCTION public.anima_forbid_mutation();
DROP TRIGGER IF EXISTS tool_action_log_no_truncate ON public.tool_action_log;
CREATE TRIGGER tool_action_log_no_truncate
  BEFORE TRUNCATE ON public.tool_action_log
  FOR EACH STATEMENT EXECUTE FUNCTION public.anima_forbid_mutation();

-- 5) RLS + revokes, same block shape as search_audit (20261022290000_web_search.sql).
--    The API writes through its own DB role; Supabase clients may only read
--    their own action log rows and nothing else.
ALTER TABLE public.tool_user_settings         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tool_permissions           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tool_pending_confirmations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tool_action_log            ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'tool_action_log_select_own') THEN
      CREATE POLICY tool_action_log_select_own ON public.tool_action_log
        FOR SELECT TO authenticated USING (user_id = (auth.jwt() ->> 'sub'));
    END IF;
    -- Tighter than search_audit: also drops TRIGGER / REFERENCES / MAINTAIN
    -- that Supabase's default privileges hand to authenticated.
    REVOKE ALL ON public.tool_action_log, public.tool_pending_confirmations,
      public.tool_permissions, public.tool_user_settings FROM authenticated;
    GRANT SELECT ON public.tool_action_log TO authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.tool_action_log, public.tool_pending_confirmations,
      public.tool_permissions, public.tool_user_settings FROM anon;
  END IF;
END $$;
