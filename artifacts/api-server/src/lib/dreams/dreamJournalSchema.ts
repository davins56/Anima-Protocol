/**
 * Self-heal for the dream journal tables.
 *
 * supabase/migrations/*.sql are applied by hand, so a deploy can ship
 * routes/dreams.ts before 20261022270000_dream_layer.sql or
 * 20261111030000_dream_journal.sql has run. The journal then answered 503
 * `dream_schema_missing` and the page said "not available yet" forever.
 *
 * This mirrors those two migrations idempotently (IF NOT EXISTS only, never a
 * DROP), so the first journal request on a database without them creates the
 * tables and carries on. Append-only triggers are attached when missing.
 * Names are unqualified so they resolve via search_path (public in production).
 */
import { getPool } from "@workspace/db";

/** One statement per entry: postgres.js on the Worker rejects multi-statement queries. */
export const DREAM_JOURNAL_DDL: readonly string[] = [
  `DO $$
BEGIN
  IF to_regprocedure('anima_forbid_mutation()') IS NULL THEN
    CREATE FUNCTION anima_forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $f$
    BEGIN
      RAISE EXCEPTION 'append-only table %: % is not allowed', TG_TABLE_NAME, TG_OP;
    END $f$;
  END IF;
END $$`,
  `CREATE TABLE IF NOT EXISTS dreams (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           text NOT NULL,
  character_id      text NOT NULL,
  identity_core_id  uuid,
  identity_version  integer,
  source_event_ids  uuid[] NOT NULL DEFAULT '{}',
  cluster_size      integer NOT NULL DEFAULT 0 CHECK (cluster_size >= 0),
  cohesion          real,
  themes            text[] NOT NULL DEFAULT '{}',
  mood              text,
  summary           text NOT NULL,
  fragment          text NOT NULL,
  window_start      timestamptz,
  window_end        timestamptz,
  synthesizer       text NOT NULL DEFAULT 'llm' CHECK (synthesizer IN ('llm', 'template')),
  model             text,
  created_at        timestamptz NOT NULL DEFAULT now()
)`,
  `CREATE INDEX IF NOT EXISTS dreams_user_char_time_idx ON dreams (user_id, character_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS dream_surfacings (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dream_id     uuid NOT NULL REFERENCES dreams(id),
  user_id      text NOT NULL,
  character_id text NOT NULL,
  surface      text NOT NULL DEFAULT 'proactive',
  session_id   text,
  surfaced_at  timestamptz NOT NULL DEFAULT now()
)`,
  `CREATE INDEX IF NOT EXISTS dream_surfacings_dream_idx ON dream_surfacings (dream_id)`,
  `CREATE INDEX IF NOT EXISTS dream_surfacings_user_char_idx ON dream_surfacings (user_id, character_id, surfaced_at DESC)`,
  `CREATE TABLE IF NOT EXISTS dream_reads (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dream_id     uuid NOT NULL REFERENCES dreams(id),
  user_id      text NOT NULL,
  character_id text NOT NULL,
  read_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, dream_id)
)`,
  `CREATE INDEX IF NOT EXISTS dream_reads_user_char_idx ON dream_reads (user_id, character_id)`,
  `CREATE TABLE IF NOT EXISTS dream_settings (
  user_id          text NOT NULL,
  character_id     text NOT NULL,
  dreaming_enabled boolean NOT NULL DEFAULT true,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, character_id)
)`,
  `DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['dreams', 'dream_surfacings', 'dream_reads'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = t || '_immutable' AND tgrelid = to_regclass(t)) THEN
      EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION anima_forbid_mutation()', t || '_immutable', t);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = t || '_no_truncate' AND tgrelid = to_regclass(t)) THEN
      EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION anima_forbid_mutation()', t || '_no_truncate', t);
    END IF;
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
  ALTER TABLE dream_settings ENABLE ROW LEVEL SECURITY;
END $$`,
  `DO $$
BEGIN
  IF to_regclass('dream_recent') IS NULL THEN
    CREATE VIEW dream_recent AS
    SELECT d.*,
           (SELECT count(*) FROM dream_surfacings s WHERE s.dream_id = d.id)::int AS surfaced_count
    FROM dreams d
    WHERE d.created_at > now() - interval '30 days';
  END IF;
END $$`,
];

let ensured = false;

/**
 * Create any missing dream journal table. Latched per isolate after success;
 * never shares an in-flight promise across requests (Workers bind sockets to
 * the request that opened them).
 */
export async function ensureDreamJournalSchema(): Promise<void> {
  if (ensured) return;
  const pool = getPool();
  for (const statement of DREAM_JOURNAL_DDL) await pool.query(statement);
  ensured = true;
}

/** Test helper. */
export function resetDreamJournalSchemaLatch(): void {
  ensured = false;
}
