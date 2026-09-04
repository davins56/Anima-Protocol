import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import {
  REQUIRED_TABLES,
  buildPresentTablesInspectQuery,
  createPostgresJsSql,
  ensureSchema,
  inspectSchema,
  postgresJsQueryable,
  resetEnsureSchemaLatch,
  resolveDbConfig,
  type SqlQueryable,
} from "@workspace/db";

const { Pool } = pg;

describe("ensureSchema recovers a blank database", () => {
  let pool: pg.Pool;
  const schemaName = `ensure_schema_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;

  beforeAll(async () => {
    const rawUrl = process.env.DATABASE_URL;
    if (!rawUrl) {
      throw new Error("DATABASE_URL is required for ensure-schema tests");
    }
    const { connectionString, ssl } = resolveDbConfig(rawUrl);
    const admin = new pg.Client({ connectionString, ssl });
    await admin.connect();
    try {
      await admin.query(`CREATE SCHEMA "${schemaName}"`);
    } finally {
      await admin.end();
    }

    pool = new Pool({
      connectionString,
      ssl,
      options: `-c search_path=${schemaName}`,
      max: 2,
    });
  });

  afterAll(async () => {
    await pool?.end().catch(() => {});
    const rawUrl = process.env.DATABASE_URL;
    if (!rawUrl) return;
    const { connectionString, ssl } = resolveDbConfig(rawUrl);
    const admin = new pg.Client({ connectionString, ssl });
    await admin.connect();
    try {
      await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    } finally {
      await admin.end();
    }
  });

  it("reports all required tables missing on a blank schema", async () => {
    resetEnsureSchemaLatch();
    const inspection = await inspectSchema(pool);
    expect(inspection.ok).toBe(false);
    expect(inspection.missingTables).toEqual([...REQUIRED_TABLES]);
  });

  it("creates missing tables and is idempotent on re-run", async () => {
    resetEnsureSchemaLatch();
    const first = await ensureSchema(pool);
    expect(first.ok).toBe(true);
    expect(first.createdTables.sort()).toEqual([...REQUIRED_TABLES].sort());
    expect(first.missingBefore.sort()).toEqual([...REQUIRED_TABLES].sort());

    const second = await ensureSchema(pool);
    expect(second.ok).toBe(true);
    expect(second.missingBefore).toEqual([]);
    expect(second.createdTables).toEqual([]);

    await pool.query(
      `INSERT INTO user_entities (user_id, entity_name, entity_id, data)
       VALUES ($1, $2, $3, $4::jsonb)`,
      ["u1", "Character", "c1", JSON.stringify({ id: "c1", name: "Korra" })],
    );
    const { rows } = await pool.query(
      `SELECT data->>'name' AS name FROM user_entities WHERE entity_id = $1`,
      ["c1"],
    );
    expect(rows[0]?.name).toBe("Korra");
  });

  it("still creates tables when the first inspect query throws", async () => {
    resetEnsureSchemaLatch();
    const blankName = `ensure_schema_fail_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    const rawUrl = process.env.DATABASE_URL;
    if (!rawUrl) throw new Error("DATABASE_URL is required");
    const { connectionString, ssl } = resolveDbConfig(rawUrl);
    const admin = new pg.Client({ connectionString, ssl });
    await admin.connect();
    try {
      await admin.query(`CREATE SCHEMA "${blankName}"`);
    } finally {
      await admin.end();
    }

    const blankPool = new pg.Pool({
      connectionString,
      ssl,
      options: `-c search_path=${blankName}`,
      max: 2,
    });
    let inspectCalls = 0;
    const wrapped: SqlQueryable = {
      async query(queryText, values) {
        if (/information_schema\.tables/i.test(queryText) && inspectCalls === 0) {
          inspectCalls += 1;
          throw Object.assign(
            new Error(
              'malformed array literal: "user_entities,user_profiles,conversations"',
            ),
            { code: "22P02", name: "PostgresError" },
          );
        }
        if (/information_schema\.tables/i.test(queryText)) inspectCalls += 1;
        return blankPool.query(queryText, values);
      },
    };

    try {
      const result = await ensureSchema(wrapped);
      expect(inspectCalls).toBeGreaterThanOrEqual(2);
      expect(result.ok).toBe(true);
      expect(result.createdTables.sort()).toEqual([...REQUIRED_TABLES].sort());
      expect(result.missingBefore.sort()).toEqual([...REQUIRED_TABLES].sort());
    } finally {
      await blankPool.end().catch(() => {});
      const cleanup = new pg.Client({ connectionString, ssl });
      await cleanup.connect();
      try {
        await cleanup.query(`DROP SCHEMA IF EXISTS "${blankName}" CASCADE`);
      } finally {
        await cleanup.end();
      }
    }
  });
});

describe("inspectSchema on the Worker postgres.js path", () => {
  it("does not emit ANY($1::text[])", () => {
    const { text, values } = buildPresentTablesInspectQuery(REQUIRED_TABLES);
    expect(text).not.toMatch(/ANY\s*\(\s*\$1\s*::\s*text\[\]\s*\)/i);
    expect(values).toEqual([...REQUIRED_TABLES]);
  });

  it("inspects and ensures a blank schema without array binds", async () => {
    const rawUrl = process.env.DATABASE_URL;
    if (!rawUrl) throw new Error("DATABASE_URL is required");
    const { connectionString, ssl } = resolveDbConfig(rawUrl);
    const schemaName = `ensure_schema_pjs_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 8)}`;

    const admin = new pg.Client({ connectionString, ssl });
    await admin.connect();
    try {
      await admin.query(`CREATE SCHEMA "${schemaName}"`);
    } finally {
      await admin.end();
    }

    const sql = createPostgresJsSql(rawUrl, connectionString, ssl);
    const queryable = postgresJsQueryable(sql);
    resetEnsureSchemaLatch();
    try {
      await queryable.query(`SET search_path TO "${schemaName}"`);
      const before = await inspectSchema(queryable);
      expect(before.ok).toBe(false);
      expect(before.missingTables).toEqual([...REQUIRED_TABLES]);

      const ensured = await ensureSchema(queryable);
      expect(ensured.ok).toBe(true);
      expect(ensured.createdTables.sort()).toEqual([...REQUIRED_TABLES].sort());

      const after = await inspectSchema(queryable);
      expect(after.ok).toBe(true);
      expect(after.missingTables).toEqual([]);
    } finally {
      await sql.end({ timeout: 2 }).catch(() => {});
      const cleanup = new pg.Client({ connectionString, ssl });
      await cleanup.connect();
      try {
        await cleanup.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      } finally {
        await cleanup.end();
      }
    }
  });

  it("documents that ANY($1::text[]) throws 22P02 on postgres.js", async () => {
    const { classifyDbError } = await import("../src/lib/dbErrors");
    const rawUrl = process.env.DATABASE_URL;
    if (!rawUrl) throw new Error("DATABASE_URL is required");
    const { connectionString, ssl } = resolveDbConfig(rawUrl);
    const sql = createPostgresJsSql(rawUrl, connectionString, ssl);
    const queryable = postgresJsQueryable(sql);
    try {
      await queryable.query(
        `SELECT table_name
         FROM information_schema.tables
         WHERE table_schema = current_schema()
           AND table_type = 'BASE TABLE'
           AND table_name = ANY($1::text[])`,
        [REQUIRED_TABLES],
      );
      throw new Error("expected ANY($1::text[]) to fail");
    } catch (err) {
      if (err instanceof Error && err.message === "expected ANY($1::text[]) to fail") {
        throw err;
      }
      expect(err).toMatchObject({
        code: "22P02",
        message: expect.stringMatching(/malformed array literal/i),
      });
      expect(classifyDbError(err)).toMatchObject({
        isDbError: true,
        reason: "unavailable",
        safeMessage: "Database query failed",
        code: "22P02",
      });
    } finally {
      await sql.end({ timeout: 2 }).catch(() => {});
    }
  });
});

