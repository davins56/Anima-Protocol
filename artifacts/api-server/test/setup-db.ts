import { afterAll } from "vitest";
import pg from "pg";

const { Client } = pg;

// The api-server tests exercise the REAL store router against a REAL Postgres.
// To keep them from ever writing to the developer's working data (the `public`
// schema), every run gets its own disposable schema inside the same database.
// All test reads/writes are redirected there via the connection search_path,
// and the schema is dropped at the end — so an interrupted run leaves only an
// orphan schema, never polluted real data.
const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;
if (!ORIGINAL_DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set to run the api-server tests (a dedicated, " +
      "disposable test schema is created inside this database).",
  );
}

// Unique per run so concurrent runs never collide. Always a valid unquoted
// identifier (lowercase letters, digits, underscore), so it needs no quoting
// when used in PGOPTIONS.
const TEST_SCHEMA = `test_run_${Date.now()}_${Math.random()
  .toString(36)
  .slice(2, 8)}`;

// An admin connection pinned to `public` (independent of the search_path we set
// for the test pool) used only to create and drop the disposable schema.
function adminClient() {
  return new Client({
    connectionString: ORIGINAL_DATABASE_URL,
    options: "-c search_path=public",
  });
}

async function createSchema() {
  const client = adminClient();
  await client.connect();
  try {
    // Fail fast with a clear message if the source tables aren't migrated yet
    // (the schema is cloned from them below). Run `pnpm --filter @workspace/db
    // run push` to create them.
    const { rows } = await client.query<{ regclass: string | null }>(
      `SELECT to_regclass('public.user_entities') AS regclass
       UNION ALL
       SELECT to_regclass('public.user_profiles')`,
    );
    if (rows.some((r) => r.regclass === null)) {
      throw new Error(
        "api-server tests require public.user_entities and public.user_profiles " +
          "to exist (they are cloned into a disposable test schema). Run " +
          "`pnpm --filter @workspace/db run push` to create them, then retry.",
      );
    }
    await client.query(`CREATE SCHEMA "${TEST_SCHEMA}"`);
    // Clone the live tables (columns, defaults, constraints, indexes) so the
    // test schema automatically tracks any future schema change — there is no
    // duplicated DDL to keep in sync.
    await client.query(
      `CREATE TABLE "${TEST_SCHEMA}".user_entities ` +
        `(LIKE public.user_entities INCLUDING ALL)`,
    );
    await client.query(
      `CREATE TABLE "${TEST_SCHEMA}".user_profiles ` +
        `(LIKE public.user_profiles INCLUDING ALL)`,
    );
    // `LIKE ... INCLUDING ALL` copies the serial id's default verbatim, which
    // still points at public's sequence. Re-point it to a schema-local sequence
    // so inserts don't even advance public's sequence.
    await client.query(
      `CREATE SEQUENCE "${TEST_SCHEMA}".user_entities_id_seq ` +
        `OWNED BY "${TEST_SCHEMA}".user_entities.id`,
    );
    await client.query(
      `ALTER TABLE "${TEST_SCHEMA}".user_entities ` +
        `ALTER COLUMN id SET DEFAULT nextval('"${TEST_SCHEMA}".user_entities_id_seq')`,
    );
  } catch (err) {
    // If creation fails partway, drop whatever was created so a failed run
    // never leaves an orphan schema behind (afterAll isn't registered yet).
    await client
      .query(`DROP SCHEMA IF EXISTS "${TEST_SCHEMA}" CASCADE`)
      .catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

async function dropSchema() {
  const client = adminClient();
  await client.connect();
  try {
    await client.query(`DROP SCHEMA IF EXISTS "${TEST_SCHEMA}" CASCADE`);
  } finally {
    await client.end();
  }
}

// This setup file runs (and its top-level await completes) before Vitest
// imports the test files, so the schema exists and PGOPTIONS is set before the
// test file imports `@workspace/db` and constructs its shared pool. The pool
// reads PGOPTIONS at construction, so its connections land on the test schema.
await createSchema();
process.env.PGOPTIONS = `-c search_path=${TEST_SCHEMA}`;

afterAll(async () => {
  await dropSchema();
});
