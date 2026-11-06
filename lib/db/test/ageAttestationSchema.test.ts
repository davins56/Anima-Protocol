import { describe, expect, it } from "vitest";
import {
  REQUIRED_TABLES,
  ensureSchema,
  type SqlQueryable,
} from "../src/ensure-schema";

const AGE = "age_attestations";

/**
 * Fake Postgres that remembers which tables ensureSchema has created, so the
 * inspect query reflects the DDL already emitted. No real database needed.
 */
function fakeDb(startMissing: readonly string[] = [AGE]) {
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

describe("ensureSchema repairs the adult-mode age gate", () => {
  it("treats age_attestations as a required table", () => {
    expect(REQUIRED_TABLES).toContain(AGE);
  });

  it("creates the table, index, latest view and guard trigger when it is missing", async () => {
    const db = fakeDb();
    const result = await ensureSchema(db.queryable);

    expect(result.missingBefore).toContain(AGE);
    expect(db.created.has(AGE)).toBe(true);
    expect(result.ok).toBe(true);

    expect(
      db.statements.some((sql) =>
        /CREATE TABLE IF NOT EXISTS "age_attestations"/i.test(sql),
      ),
    ).toBe(true);
    expect(
      db.statements.some((sql) =>
        /CREATE INDEX IF NOT EXISTS "age_attestations_user_idx"/i.test(sql),
      ),
    ).toBe(true);
    expect(
      db.statements.some((sql) =>
        /CREATE OR REPLACE VIEW "age_attestation_latest"/i.test(sql),
      ),
    ).toBe(true);
    // The immutability trigger is only meaningful once its function exists.
    expect(
      db.statements.some((sql) => /age_attestations_immutable/i.test(sql)),
    ).toBe(true);
  });

  it("emits no age DDL when the table already exists", async () => {
    const db = fakeDb([]);
    const result = await ensureSchema(db.queryable);

    expect(result.missingBefore).toEqual([]);
    expect(result.createdTables).toEqual([]);
    expect(
      db.statements.some((sql) => /age_attestations/i.test(sql)),
    ).toBe(false);
  });
});
