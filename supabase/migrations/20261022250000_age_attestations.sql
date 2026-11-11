-- Server-stored age attestation for adult mode. Append-only: attesting,
-- a failed check, and revoking are each a new row; the latest row per user
-- wins (age_attestation_latest). Data-minimised: the full date of birth is
-- checked in memory and never stored; only the birth year and the computed
-- age are kept. `method`/`provider` make room for a third-party age
-- verification provider later (docs/safety-gates.md).
CREATE TABLE IF NOT EXISTS public.age_attestations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      text NOT NULL,
  status       text NOT NULL CHECK (status IN ('attested', 'rejected', 'revoked')),
  method       text NOT NULL CHECK (method IN ('self_declared_dob', 'provider')),
  provider     text,
  provider_ref text,
  birth_year   smallint CHECK (birth_year IS NULL OR birth_year BETWEEN 1900 AND 2100),
  age_years    smallint CHECK (age_years IS NULL OR age_years BETWEEN 0 AND 150),
  min_age      smallint NOT NULL DEFAULT 18,
  attested_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS age_attestations_user_idx
  ON public.age_attestations (user_id, attested_at DESC);

DROP TRIGGER IF EXISTS age_attestations_immutable ON public.age_attestations;
CREATE TRIGGER age_attestations_immutable
  BEFORE UPDATE OR DELETE ON public.age_attestations
  FOR EACH ROW EXECUTE FUNCTION public.anima_forbid_mutation();
DROP TRIGGER IF EXISTS age_attestations_no_truncate ON public.age_attestations;
CREATE TRIGGER age_attestations_no_truncate
  BEFORE TRUNCATE ON public.age_attestations
  FOR EACH STATEMENT EXECUTE FUNCTION public.anima_forbid_mutation();

CREATE OR REPLACE VIEW public.age_attestation_latest AS
SELECT DISTINCT ON (user_id) *
FROM public.age_attestations
ORDER BY user_id, attested_at DESC, id DESC;

ALTER TABLE public.age_attestations ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'age_attestations_select_own') THEN
      CREATE POLICY age_attestations_select_own ON public.age_attestations
        FOR SELECT TO authenticated USING (user_id = (auth.jwt() ->> 'sub'));
    END IF;
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.age_attestations FROM anon, authenticated;
    REVOKE ALL ON public.age_attestation_latest FROM anon, authenticated;
  END IF;
END $$;
