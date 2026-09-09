import { afterEach, describe, expect, it, vi } from "vitest";
import {
  REQUIRED_TABLES,
  ensureSchema,
  ensureSchemaOnce,
  resetEnsureSchemaLatch,
  type SqlQueryable,
} from "../src/ensure-schema";

afterEach(() => {
  resetEnsureSchemaLatch();
  vi.unstubAllGlobals();
});

function presentQueryable(
  onUnexpected?: (sql: string) => void,
): SqlQueryable {
  return {
    async query(text: string) {
      if (/information_schema\.tables/i.test(text)) {
        return {
          rows: REQUIRED_TABLES.map((table_name) => ({ table_name })),
        };
      }
      if (/pg_extension/i.test(text)) {
        return { rows: [{ exists: true }] };
      }
      onUnexpected?.(text);
      throw new Error(`unexpected SQL: ${text.slice(0, 120)}`);
    },
  };
}

describe("ensureSchema skips DDL when the schema is already present", () => {
  it("does not emit CREATE TABLE/INDEX/EXTENSION after a successful inspect", async () => {
    const statements: string[] = [];
    const result = await ensureSchema(
      presentQueryable((sql) => statements.push(sql)),
    );
    expect(result.ok).toBe(true);
    expect(result.createdTables).toEqual([]);
    expect(result.missingBefore).toEqual([]);
    expect(statements).toEqual([]);
  });

  it("still runs CREATE TABLE when required tables are missing", async () => {
    const statements: string[] = [];
    const queryable: SqlQueryable = {
      async query(text: string) {
        statements.push(text);
        if (/information_schema\.tables/i.test(text)) {
          return { rows: [] };
        }
        if (/pg_extension/i.test(text)) {
          return { rows: [{ exists: false }] };
        }
        return { rows: [] };
      },
    };
    await ensureSchema(queryable);
    expect(
      statements.some((sql) =>
        /CREATE TABLE IF NOT EXISTS "user_entities"/i.test(sql),
      ),
    ).toBe(true);
  });
});

describe("ensureSchemaOnce request isolation on Workers", () => {
  it("does not await another request's in-flight I/O", async () => {
    vi.stubGlobal("navigator", { userAgent: "Cloudflare-Workers" });
    resetEnsureSchemaLatch();

    const { beginDbRequest } = await import("../src/client");

    const hanging: SqlQueryable = {
      query: () => new Promise(() => {}),
    };

    beginDbRequest();
    const first = ensureSchemaOnce(hanging);

    beginDbRequest();
    const second = ensureSchemaOnce(presentQueryable());

    const result = await Promise.race([
      second,
      new Promise<never>((_, reject) => {
        setTimeout(
          () =>
            reject(
              new Error(
                "hung waiting on another request's ensureSchemaOnce promise",
              ),
            ),
          250,
        );
      }),
    ]);

    expect(result.ok).toBe(true);
    expect(result.createdTables).toEqual([]);
    void first;
  });
});
