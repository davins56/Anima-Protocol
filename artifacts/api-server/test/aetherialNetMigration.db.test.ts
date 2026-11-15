/**
 * Migration S1 (#769) against a REAL Postgres: the reproducible version of the
 * Revision 3 disposable-cluster checks (Serenity's delivery notes, item 3).
 *
 * Everything runs inside a brand-new throwaway DATABASE created and dropped by
 * this file (never the developer's working database, never the shared test
 * schema), so S1 can be applied exactly as written, `public.` and all:
 *   - apply twice in `public` and twice in an isolated schema (CI-style strip),
 *     with identical catalogs after each second run;
 *   - RLS + REVOKE for anon/authenticated (non-superuser roles, Supabase-style
 *     default grants present before the apply);
 *   - append-only ledgers for a NON-superuser app role (UPDATE/DELETE/TRUNCATE
 *     -> 42501, and it cannot switch triggers off via session_replication_role);
 *   - FK / TRUNCATE guards (plain TRUNCATE events -> 0A000, CASCADE -> 42501);
 *   - rollback: empty -> everything gone and re-apply works; non-empty -> refused
 *     with ALL state preserved; concurrent write during rollback -> blocked, no
 *     committed row silently dropped.
 *
 * Run: DATABASE_URL=postgres://… pnpm --filter @workspace/api-server exec vitest run test/aetherialNetMigration.db.test.ts
 * The role in DATABASE_URL must be a superuser (CI's service user is). Otherwise the
 * suite is skipped locally and FAILS under CI=true.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

const ROOT = join(__dirname, "../../..");
const UP = readFileSync(join(ROOT, "supabase/migrations/20261115120000_aetherial_net.sql"), "utf8");
const DOWN = readFileSync(join(ROOT, "supabase/rollback/20261115120000_aetherial_net.down.sql"), "utf8");
const CI_UP = UP.replace(/public\./g, "");

const TABLES = [
  "aetherial_net_access_log",
  "aetherial_net_events",
  "aetherial_net_progress",
  "aetherial_net_dissonance",
  "aetherial_net_inventory",
  "aetherial_net_reward_claims",
  "aetherial_net_cap_counters",
] as const;
const LEDGERS = ["aetherial_net_access_log", "aetherial_net_events", "aetherial_net_reward_claims"] as const;

const SUFFIX = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const DB_NAME = `s1_test_${SUFFIX}`;
const APP_ROLE = `s1_app_${SUFFIX}`;
const ISO_SCHEMA = "s1_iso";
const HASH = "a".repeat(64);

const BASE_URL = process.env.DATABASE_URL ?? "";
const createdRoles: string[] = [];

function urlFor(db: string): string {
  const u = new URL(BASE_URL);
  u.pathname = `/${db}`;
  return u.toString();
}
async function connect(db: string, searchPath = "public"): Promise<pg.Client> {
  // Explicit options: setup-db.ts sets PGOPTIONS to the shared test schema.
  const c = new pg.Client({ connectionString: urlFor(db), options: `-c search_path=${searchPath}` });
  await c.connect();
  return c;
}
async function code(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? "unknown";
  }
}
/** Runs a multi-statement script; leaves the session clean even if it fails mid-transaction. */
async function runScript(c: pg.Client, sql: string): Promise<string | null> {
  const err = await code(c.query(sql));
  if (err) await c.query("ROLLBACK").catch(() => {});
  return err;
}
async function catalog(c: pg.Client, schema: string): Promise<string> {
  const { rows } = await c.query(
    `SELECT 'rel' AS k, relname || ':' || relkind::text || ':' || relrowsecurity::text AS v
       FROM pg_class WHERE relnamespace = $1::regnamespace AND relname LIKE 'aetherial_net%'
     UNION ALL
     SELECT 'con', conrelid::regclass::text || ':' || conname || ':' || pg_get_constraintdef(oid)
       FROM pg_constraint WHERE connamespace = $1::regnamespace AND conname LIKE 'aetherial_net%'
     UNION ALL
     SELECT 'trg', tgrelid::regclass::text || ':' || tgname || ':' || tgenabled::text
       FROM pg_trigger t JOIN pg_class r ON r.oid = t.tgrelid
      WHERE r.relnamespace = $1::regnamespace AND NOT tgisinternal
     UNION ALL
     SELECT 'acl', relname || ':' || coalesce(relacl::text, '')
       FROM pg_class WHERE relnamespace = $1::regnamespace AND relname LIKE 'aetherial_net%'
     UNION ALL
     SELECT 'pol', polname FROM pg_policy p JOIN pg_class r ON r.oid = p.polrelid
      WHERE r.relnamespace = $1::regnamespace
     UNION ALL
     SELECT 'typ', typname FROM pg_type WHERE typnamespace = $1::regnamespace AND typname LIKE 'aetherial_net%'
     UNION ALL
     SELECT 'fn', proname || ':' || md5(prosrc) FROM pg_proc WHERE pronamespace = $1::regnamespace AND proname LIKE 'aetherial_net%'
     ORDER BY 1, 2`,
    [schema],
  );
  return rows.map((r) => `${r.k} ${r.v}`).join("\n");
}
async function countRelations(c: pg.Client, schema = "public"): Promise<number> {
  const { rows } = await c.query(
    `SELECT count(*)::int AS n FROM pg_class WHERE relnamespace = $1::regnamespace AND relname LIKE 'aetherial_net%' AND relkind = 'r'`,
    [schema],
  );
  return rows[0].n;
}
async function seedEvent(c: pg.Client, user = "user_a", key = "dedupe-key-1"): Promise<string> {
  const { rows } = await c.query(
    `INSERT INTO aetherial_net_events (user_id, character_id, stratum, kind, content_version, dedupe_key, request_hash)
     VALUES ($1::text, 'char_1', 'shadow_lattice', 'move', 'v1', $2::text, $3::text) RETURNING id`,
    [user, key, HASH],
  );
  return rows[0].id as string;
}

let admin: pg.Client | null = null; // connected to the base database (create/drop the throwaway DB)
let db: pg.Client | null = null; // superuser-ish connection inside the throwaway DB
let ready = false;
let skipReason = "";

beforeAll(async () => {
  if (!BASE_URL) {
    skipReason = "DATABASE_URL not set";
    return;
  }
  admin = new pg.Client({ connectionString: BASE_URL, options: "-c search_path=public" });
  await admin.connect();
  const { rows } = await admin.query(`SELECT rolsuper FROM pg_roles WHERE rolname = current_user`);
  if (!rows[0]?.rolsuper) {
    skipReason = "DATABASE_URL role is not a superuser (needed to create the throwaway database and BYPASSRLS test role)";
    return;
  }
  await admin.query(`CREATE DATABASE ${DB_NAME}`);
  // Supabase-style client roles (cluster-wide). Created only if missing, dropped
  // at the end only if this file created them.
  for (const r of ["anon", "authenticated"]) {
    const exists = await admin.query(`SELECT 1 FROM pg_roles WHERE rolname = $1`, [r]);
    if (exists.rowCount === 0) {
      await admin.query(`CREATE ROLE ${r} NOLOGIN NOSUPERUSER`);
      createdRoles.push(r);
    }
  }
  await admin.query(`CREATE ROLE ${APP_ROLE} NOLOGIN NOSUPERUSER BYPASSRLS`);
  createdRoles.push(APP_ROLE);
  db = await connect(DB_NAME);
  // Before S1: default privileges grant everything to the client roles, so the
  // migration's REVOKE has real grants to remove (as on Supabase).
  await db.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated`);
  await db.query(`GRANT USAGE ON SCHEMA public TO anon, authenticated, ${APP_ROLE}`);
  ready = true;
});

afterAll(async () => {
  await db?.end().catch(() => {});
  if (admin) {
    await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`).catch(() => {});
    for (const r of createdRoles) await admin.query(`DROP ROLE IF EXISTS ${r}`).catch(() => {});
    await admin.end().catch(() => {});
  }
});

function requireReady() {
  if (!ready) {
    if (process.env.CI) throw new Error(`S1 DB tests cannot run under CI: ${skipReason}`);
    return false;
  }
  return true;
}

describe("Migration S1 on a real Postgres (throwaway database)", () => {
  it("applies twice in public with an identical catalog", async (ctx) => {
    if (!requireReady()) return ctx.skip();
    expect(await runScript(db!, UP)).toBeNull();
    const first = await catalog(db!, "public");
    expect(await runScript(db!, UP)).toBeNull();
    expect(await catalog(db!, "public")).toBe(first);
    expect(await countRelations(db!)).toBe(7);
  });

  it("applies twice in an isolated schema (CI pattern: public. stripped)", async (ctx) => {
    if (!requireReady()) return ctx.skip();
    await db!.query(`CREATE SCHEMA ${ISO_SCHEMA}`);
    const iso = await connect(DB_NAME, ISO_SCHEMA);
    try {
      expect(await runScript(iso, CI_UP)).toBeNull();
      const first = await catalog(iso, ISO_SCHEMA);
      expect(await runScript(iso, CI_UP)).toBeNull();
      expect(await catalog(iso, ISO_SCHEMA)).toBe(first);
      expect(await countRelations(iso, ISO_SCHEMA)).toBe(7);
    } finally {
      await iso.end();
    }
    await db!.query(`DROP SCHEMA ${ISO_SCHEMA} CASCADE`);
  });

  it("enables RLS with no policies and revokes anon/authenticated (non-superuser roles)", async (ctx) => {
    if (!requireReady()) return ctx.skip();
    for (const t of TABLES) {
      const { rows } = await db!.query(
        `SELECT c.relrowsecurity AS rls,
                (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS policies,
                has_table_privilege('anon', c.oid, 'SELECT') OR has_table_privilege('anon', c.oid, 'INSERT') AS anon_priv,
                has_table_privilege('authenticated', c.oid, 'SELECT') OR has_table_privilege('authenticated', c.oid, 'INSERT') AS auth_priv
           FROM pg_class c WHERE c.oid = $1::regclass`,
        [`public.${t}`],
      );
      expect(rows[0], t).toEqual({ rls: true, policies: 0, anon_priv: false, auth_priv: false });
    }
    await seedEvent(db!, "user_rls", "dedupe-rls-1");
    await db!.query("BEGIN");
    try {
      await db!.query("SET LOCAL ROLE authenticated");
      expect(await code(db!.query("SELECT 1 FROM aetherial_net_events"))).toBe("42501");
    } finally {
      await db!.query("ROLLBACK");
    }
    // Even with SELECT granted back, RLS (no policies) shows authenticated nothing.
    await db!.query("BEGIN");
    try {
      await db!.query("GRANT SELECT ON aetherial_net_events TO authenticated");
      await db!.query("SET LOCAL ROLE authenticated");
      const { rows } = await db!.query("SELECT count(*)::int AS n FROM aetherial_net_events");
      expect(rows[0].n).toBe(0);
    } finally {
      await db!.query("ROLLBACK");
    }
  });

  it("blocks UPDATE/DELETE/TRUNCATE on the ledgers for a non-superuser app role, with no bypass", async (ctx) => {
    if (!requireReady()) return ctx.skip();
    const eventId = await seedEvent(db!, "user_ledger", "dedupe-ledger-1");
    await db!.query(
      `INSERT INTO aetherial_net_access_log (user_id, action, reason, route) VALUES ('user_ledger', 'enter', 'ok', 'POST /enter')`,
    );
    await db!.query(
      `INSERT INTO aetherial_net_reward_claims (user_id, stratum, reward_id, claim_key, source_event_id, dedupe_key, request_hash)
       VALUES ('user_ledger', 'shadow_lattice', 'echo_shard', 'quest:grey-corridor:resolved', $1::uuid, 'dedupe-ledger-1', $2::text)`,
      [eventId, HASH],
    );
    // The API's role bypasses RLS (like this BYPASSRLS, NON-superuser app role).
    // Give it full table rights so only the triggers stand in the way.
    await db!.query(`GRANT ALL ON ALL TABLES IN SCHEMA public TO ${APP_ROLE}`);
    const before = await db!.query(
      `SELECT (SELECT count(*) FROM aetherial_net_events) e, (SELECT count(*) FROM aetherial_net_access_log) a, (SELECT count(*) FROM aetherial_net_reward_claims) r`,
    );
    for (const t of LEDGERS) {
      for (const stmt of [`UPDATE ${t} SET user_id = user_id`, `DELETE FROM ${t}`]) {
        await db!.query("BEGIN");
        await db!.query(`SET LOCAL ROLE ${APP_ROLE}`);
        expect(await code(db!.query(stmt)), `${t}: ${stmt}`).toBe("42501");
        await db!.query("ROLLBACK");
      }
    }
    for (const t of ["aetherial_net_access_log", "aetherial_net_reward_claims"]) {
      await db!.query("BEGIN");
      await db!.query(`SET LOCAL ROLE ${APP_ROLE}`);
      expect(await code(db!.query(`TRUNCATE ${t}`)), t).toBe("42501");
      await db!.query("ROLLBACK");
    }
    // The app role cannot disable the guards.
    await db!.query("BEGIN");
    await db!.query(`SET LOCAL ROLE ${APP_ROLE}`);
    expect(await code(db!.query("SET LOCAL session_replication_role = replica"))).toBe("42501");
    await db!.query("ROLLBACK");
    const after = await db!.query(
      `SELECT (SELECT count(*) FROM aetherial_net_events) e, (SELECT count(*) FROM aetherial_net_access_log) a, (SELECT count(*) FROM aetherial_net_reward_claims) r`,
    );
    expect(after.rows[0]).toEqual(before.rows[0]);
  });

  it("guards FKs and TRUNCATE on events: plain -> 0A000, CASCADE -> 42501", async (ctx) => {
    if (!requireReady()) return ctx.skip();
    expect(await code(db!.query("TRUNCATE aetherial_net_events"))).toBe("0A000");
    expect(await code(db!.query("TRUNCATE aetherial_net_events CASCADE"))).toBe("42501");
    // A claim must point at a real event; dissonance's last_event_id too.
    expect(
      await code(
        db!.query(
          `INSERT INTO aetherial_net_reward_claims (user_id, stratum, reward_id, claim_key, source_event_id, dedupe_key, request_hash)
           VALUES ('u', 'shadow_lattice', 'r', 'k-missing', gen_random_uuid(), 'dedupe-missing', $1::text)`,
          [HASH],
        ),
      ),
    ).toBe("23503");
    expect(
      await code(
        db!.query(
          `INSERT INTO aetherial_net_dissonance (user_id, character_id, stratum, last_event_id) VALUES ('u', 'c', 'shadow_lattice', gen_random_uuid())`,
        ),
      ),
    ).toBe("23503");
    // Constraint spot checks: bad stratum, dedupe conflict, inventory cap.
    expect(
      await code(db!.query(`INSERT INTO aetherial_net_access_log (action, reason, route, stratum) VALUES ('enter', 'ok', 'r', 'bogus')`)),
    ).toBe("23514");
    expect(await code(seedEvent(db!, "user_ledger", "dedupe-ledger-1"))).toBe("23505");
    expect(
      await code(
        db!.query(`INSERT INTO aetherial_net_inventory (user_id, stratum, item_id, quantity, max_quantity) VALUES ('u', 'shadow_lattice', 'i', 2, 1)`),
      ),
    ).toBe("23514");
  });

  it("rollback refuses a non-empty table and preserves ALL state (tables, rows, domain, function)", async (ctx) => {
    if (!requireReady()) return ctx.skip();
    // Rows exist in the ledgers from the earlier tests; also put one in the LAST
    // table checked, so earlier tables are locked and checked before the refusal.
    await db!.query(
      `INSERT INTO aetherial_net_cap_counters (user_id, stratum, cap_key, window_start, count) VALUES ('u', 'shadow_lattice', 'k', date_trunc('day', now()), 1)`,
    );
    const before = await catalog(db!, "public");
    const rowsBefore = await db!.query(
      `SELECT ${TABLES.map((t) => `(SELECT count(*) FROM ${t}) AS ${t}`).join(", ")}`,
    );
    const err = await runScript(db!, DOWN);
    expect(err).toBe("P0001"); // RAISE EXCEPTION: rollback refused
    expect(await catalog(db!, "public")).toBe(before);
    const rowsAfter = await db!.query(`SELECT ${TABLES.map((t) => `(SELECT count(*) FROM ${t}) AS ${t}`).join(", ")}`);
    expect(rowsAfter.rows[0]).toEqual(rowsBefore.rows[0]);
  });

  it("rollback on empty tables removes everything, re-runs cleanly, and S1 re-applies", async (ctx) => {
    if (!requireReady()) return ctx.skip();
    // Start from a clean apply (the ledgers above can't be emptied by design).
    await db!.query(
      `DROP TABLE aetherial_net_reward_claims, aetherial_net_dissonance, aetherial_net_cap_counters,
                  aetherial_net_inventory, aetherial_net_progress, aetherial_net_events, aetherial_net_access_log`,
    );
    expect(await runScript(db!, UP)).toBeNull();
    expect(await runScript(db!, DOWN)).toBeNull();
    const { rows } = await db!.query(
      `SELECT (SELECT count(*)::int FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname LIKE 'aetherial_net%') AS rels,
              (SELECT count(*)::int FROM pg_type WHERE typnamespace = 'public'::regnamespace AND typname LIKE 'aetherial_net%') AS types,
              (SELECT count(*)::int FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname LIKE 'aetherial_net%') AS fns`,
    );
    expect(rows[0]).toEqual({ rels: 0, types: 0, fns: 0 });
    expect(await runScript(db!, DOWN)).toBeNull();
    expect(await runScript(db!, UP)).toBeNull();
    expect(await countRelations(db!)).toBe(7);
  });

  it("a write racing the rollback is blocked and never silently dropped", async (ctx) => {
    if (!requireReady()) return ctx.skip();
    // Same file, with a pause injected after the lock+check to widen the window.
    const slowDown = DOWN.replace(/\$\$;\s*\n\s*-- Dependents first/, "$$$$;\nSELECT pg_sleep(1.5);\n-- Dependents first");
    expect(slowDown).toContain("pg_sleep(1.5)");
    const roller = await connect(DB_NAME);
    const writer = await connect(DB_NAME);
    try {
      const rollback = runScript(roller, slowDown);
      await new Promise((r) => setTimeout(r, 400));
      const write = code(
        writer.query(`INSERT INTO aetherial_net_access_log (user_id, action, reason, route) VALUES ('race', 'enter', 'ok', 'r')`),
      );
      const [rbErr, writeErr] = await Promise.all([rollback, write]);
      // Either the write lost (blocked, then the table was gone) and the rollback
      // succeeded, or the write won and the rollback refused. Never both succeed.
      if (rbErr === null) {
        expect(writeErr).toBe("42P01");
        expect(await countRelations(db!)).toBe(0);
      } else {
        expect(rbErr).toBe("P0001");
        expect(writeErr).toBeNull();
        expect(await countRelations(db!)).toBe(7);
      }
      // With the 400 ms head start the rollback holds the lock first.
      expect(rbErr).toBeNull();
    } finally {
      await roller.end();
      await writer.end();
    }
  });
});
