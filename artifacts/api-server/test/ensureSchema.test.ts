import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import {
  REQUIRED_TABLES,
  ensureSchema,
  inspectSchema,
  resetEnsureSchemaLatch,
  resolveDbConfig,
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
});
