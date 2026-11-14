import { describe, expect, it } from "vitest";
import {
  REQUIRED_TABLES,
  ensureSchema,
  type SqlQueryable,
} from "../src/ensure-schema";

const IDENTITY = "character_identity_core";

/**
 * Fake Postgres that remembers which tables ensureSchema has created, so the
 * inspect query reflects the DDL already emitted. No real database needed.
 */
function fakeDb(startMissing: readonly string[] = [IDENTITY]) {
  const created = new Set(
    REQUIRED_TABLES.filter((table) => !startMissing.includes(table)),
  );
  const statements: string[] = [];
  const queryable: SqlQueryable = {
    async query(text: string) {
      statements.push(text);
      if (/information_schema\.tables/i.test(text)) {
        return { rows: [...created].map((table_name) => ({ table_name })) };
      }
      if (/pg_extension/i.test(text)) return { rows: [{ exists: true }] };
      const create = /CREATE TABLE IF NOT EXISTS "([a-z0-9_]+)"/i.exec(text);
      if (create) created.add(create[1]);
      return { rows: [] };
    },
  };
  return { queryable, statements, created };
}

describe("ensureSchema repairs the identity current view", () => {
  it("treats character_identity_core as a required table", () => {
    expect(REQUIRED_TABLES).toContain(IDENTITY);
  });

  it("creates the table, later columns, lookup index and current view when it is missing", async () => {
    const db = fakeDb();
    const result = await ensureSchema(db.queryable);

    expect(result.missingBefore).toContain(IDENTITY);
    expect(db.created.has(IDENTITY)).toBe(true);
    expect(result.ok).toBe(true);

    expect(
      db.statements.some((sql) =>
        /CREATE TABLE IF NOT EXISTS "character_identity_core"/i.test(sql),
      ),
    ).toBe(true);
    expect(
      db.statements.some((sql) =>
        /ADD COLUMN IF NOT EXISTS "vessel_version"/i.test(sql),
      ),
    ).toBe(true);
    expect(
      db.statements.some((sql) =>
        /ADD COLUMN IF NOT EXISTS "voice_version"/i.test(sql),
      ),
    ).toBe(true);
    expect(
      db.statements.some((sql) =>
        /CREATE INDEX IF NOT EXISTS "character_identity_core_lookup_idx"/i.test(sql),
      ),
    ).toBe(true);
    expect(
      db.statements.some((sql) =>
        /CREATE OR REPLACE VIEW "character_identity_current"/i.test(sql),
      ),
    ).toBe(true);
  });

  it("emits no identity DDL when the table already exists", async () => {
    const db = fakeDb([]);
    const result = await ensureSchema(db.queryable);

    expect(result.missingBefore).toEqual([]);
    expect(result.createdTables).toEqual([]);
    expect(
      db.statements.some((sql) => /character_identity/i.test(sql)),
    ).toBe(false);
  });
});
