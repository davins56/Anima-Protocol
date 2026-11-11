-- Paid add-ons via Stripe Checkout (test mode). Text chat stays free.
-- Both tables are append-only: a purchase, a use, or a refund is a new row;
-- balances are sums. Non-destructive: new objects only.

-- One row per Stripe webhook event we have handled. The primary key is the
-- idempotency guard: a redelivered event conflicts and is skipped.
CREATE TABLE IF NOT EXISTS public.billing_stripe_events (
  event_id     text PRIMARY KEY,
  event_type   text NOT NULL,
  livemode     boolean NOT NULL DEFAULT false,
  user_id      text,
  checkout_session_id text,
  received_at  timestamptz NOT NULL DEFAULT now()
);

-- Credit / entitlement ledger.
--   photo_credits, voice_minutes: delta is units (+ purchase, − use)
--   deep_mode: delta is days; active_until carries the resulting expiry
CREATE TABLE IF NOT EXISTS public.entitlement_ledger (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         text NOT NULL,
  entitlement     text NOT NULL CHECK (entitlement IN ('photo_credits', 'voice_minutes', 'deep_mode')),
  delta           integer NOT NULL CHECK (delta <> 0),
  reason          text NOT NULL CHECK (reason IN ('purchase', 'use', 'refund', 'grant')),
  active_until    timestamptz,
  stripe_event_id text,
  checkout_session_id text,
  idempotency_key text NOT NULL UNIQUE,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS entitlement_ledger_user_idx
  ON public.entitlement_ledger (user_id, entitlement, created_at DESC);

DROP TRIGGER IF EXISTS billing_stripe_events_immutable ON public.billing_stripe_events;
CREATE TRIGGER billing_stripe_events_immutable
  BEFORE UPDATE OR DELETE ON public.billing_stripe_events
  FOR EACH ROW EXECUTE FUNCTION public.anima_forbid_mutation();
DROP TRIGGER IF EXISTS billing_stripe_events_no_truncate ON public.billing_stripe_events;
CREATE TRIGGER billing_stripe_events_no_truncate
  BEFORE TRUNCATE ON public.billing_stripe_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.anima_forbid_mutation();
DROP TRIGGER IF EXISTS entitlement_ledger_immutable ON public.entitlement_ledger;
CREATE TRIGGER entitlement_ledger_immutable
  BEFORE UPDATE OR DELETE ON public.entitlement_ledger
  FOR EACH ROW EXECUTE FUNCTION public.anima_forbid_mutation();
DROP TRIGGER IF EXISTS entitlement_ledger_no_truncate ON public.entitlement_ledger;
CREATE TRIGGER entitlement_ledger_no_truncate
  BEFORE TRUNCATE ON public.entitlement_ledger
  FOR EACH STATEMENT EXECUTE FUNCTION public.anima_forbid_mutation();

CREATE OR REPLACE VIEW public.entitlement_balances AS
SELECT
  user_id,
  entitlement,
  COALESCE(SUM(delta), 0)::integer AS balance,
  MAX(active_until) AS active_until
FROM public.entitlement_ledger
GROUP BY user_id, entitlement;

ALTER TABLE public.billing_stripe_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entitlement_ledger ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'entitlement_ledger_select_own') THEN
      CREATE POLICY entitlement_ledger_select_own ON public.entitlement_ledger
        FOR SELECT TO authenticated USING (user_id = (auth.jwt() ->> 'sub'));
    END IF;
    REVOKE ALL ON public.billing_stripe_events FROM anon, authenticated;
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.entitlement_ledger FROM anon, authenticated;
    REVOKE ALL ON public.entitlement_balances FROM anon, authenticated;
  END IF;
END $$;
