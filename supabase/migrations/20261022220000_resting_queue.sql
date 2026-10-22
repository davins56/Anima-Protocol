-- Resting mode: when the local model / Ollama tunnel is down, the user's
-- message is queued server-side and answered once the model is back (the
-- hourly proactive cron drains it). Additive and append-only:
--   chat_resting_queue       one immutable row per queued user turn
--   chat_resting_deliveries  one immutable row per delivery attempt outcome
--   chat_resting_pending     view: queued rows with no 'delivered'/'expired' outcome
CREATE TABLE IF NOT EXISTS public.chat_resting_queue (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       text NOT NULL,
  session_id    text NOT NULL,
  character_id  text NOT NULL,
  turn_id       text,
  content       text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 8000),
  reason        text NOT NULL DEFAULT 'model_unavailable',
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS chat_resting_queue_turn_uq
  ON public.chat_resting_queue (user_id, turn_id) WHERE turn_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS chat_resting_queue_created_idx
  ON public.chat_resting_queue (created_at);

CREATE TABLE IF NOT EXISTS public.chat_resting_deliveries (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_id      uuid NOT NULL REFERENCES public.chat_resting_queue(id),
  status        text NOT NULL CHECK (status IN ('delivered', 'failed', 'expired')),
  message_id    text,
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chat_resting_deliveries_queue_idx
  ON public.chat_resting_deliveries (queue_id, status);
-- At most one terminal outcome per queued turn.
CREATE UNIQUE INDEX IF NOT EXISTS chat_resting_deliveries_terminal_uq
  ON public.chat_resting_deliveries (queue_id) WHERE status IN ('delivered', 'expired');

DROP TRIGGER IF EXISTS chat_resting_queue_immutable ON public.chat_resting_queue;
CREATE TRIGGER chat_resting_queue_immutable
  BEFORE UPDATE OR DELETE ON public.chat_resting_queue
  FOR EACH ROW EXECUTE FUNCTION public.anima_forbid_mutation();
DROP TRIGGER IF EXISTS chat_resting_queue_no_truncate ON public.chat_resting_queue;
CREATE TRIGGER chat_resting_queue_no_truncate
  BEFORE TRUNCATE ON public.chat_resting_queue
  FOR EACH STATEMENT EXECUTE FUNCTION public.anima_forbid_mutation();
DROP TRIGGER IF EXISTS chat_resting_deliveries_immutable ON public.chat_resting_deliveries;
CREATE TRIGGER chat_resting_deliveries_immutable
  BEFORE UPDATE OR DELETE ON public.chat_resting_deliveries
  FOR EACH ROW EXECUTE FUNCTION public.anima_forbid_mutation();
DROP TRIGGER IF EXISTS chat_resting_deliveries_no_truncate ON public.chat_resting_deliveries;
CREATE TRIGGER chat_resting_deliveries_no_truncate
  BEFORE TRUNCATE ON public.chat_resting_deliveries
  FOR EACH STATEMENT EXECUTE FUNCTION public.anima_forbid_mutation();

CREATE OR REPLACE VIEW public.chat_resting_pending AS
SELECT q.*,
       (SELECT count(*) FROM public.chat_resting_deliveries d WHERE d.queue_id = q.id AND d.status = 'failed') AS failed_attempts
FROM public.chat_resting_queue q
WHERE NOT EXISTS (
  SELECT 1 FROM public.chat_resting_deliveries d
  WHERE d.queue_id = q.id AND d.status IN ('delivered', 'expired')
);

ALTER TABLE public.chat_resting_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_resting_deliveries ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'chat_resting_queue_select_own') THEN
      CREATE POLICY chat_resting_queue_select_own ON public.chat_resting_queue
        FOR SELECT TO authenticated USING (user_id = (auth.jwt() ->> 'sub'));
    END IF;
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.chat_resting_queue, public.chat_resting_deliveries
      FROM anon, authenticated;
    REVOKE ALL ON public.chat_resting_pending FROM anon, authenticated;
  END IF;
END $$;
