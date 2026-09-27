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

  it("creates only the PDF tables when those are the only ones missing", async () => {
    const statements: string[] = [];
    let pdfCreated = false;
    const queryable: SqlQueryable = {
      async query(text: string) {
        statements.push(text);
        if (/CREATE TABLE IF NOT EXISTS "pdf_documents"/i.test(text)) {
          pdfCreated = true;
        }
        if (/information_schema\.tables/i.test(text)) {
          const names = pdfCreated
            ? REQUIRED_TABLES
            : REQUIRED_TABLES.filter(
                (name) => name !== "pdf_documents" && name !== "pdf_chunks",
              );
          return { rows: names.map((table_name) => ({ table_name })) };
        }
        if (/pg_extension/i.test(text)) {
          return { rows: [{ exists: true }] };
        }
        return { rows: [] };
      },
    };
    const result = await ensureSchema(queryable);
    expect(result.ok).toBe(true);
    expect(result.missingBefore.sort()).toEqual(["pdf_chunks", "pdf_documents"]);
    const creates = statements.filter((sql) => /CREATE /i.test(sql));
    expect(creates.some((sql) => /"pdf_documents"/i.test(sql))).toBe(true);
    expect(creates.some((sql) => /"pdf_chunks"/i.test(sql))).toBe(true);
    expect(creates.some((sql) => /"user_entities"/i.test(sql))).toBe(false);
    expect(creates.some((sql) => /pg_trgm/i.test(sql))).toBe(false);
  });

  it("skips PDF DDL when those tables already exist", async () => {
    const statements: string[] = [];
    let inspects = 0;
    const queryable: SqlQueryable = {
      async query(text: string) {
        statements.push(text);
        if (/information_schema\.tables/i.test(text)) {
          inspects += 1;
          const names =
            inspects === 1
              ? REQUIRED_TABLES.filter((name) => name !== "user_entities")
              : REQUIRED_TABLES;
          return { rows: names.map((table_name) => ({ table_name })) };
        }
        if (/pg_extension/i.test(text)) {
          return { rows: [{ exists: true }] };
        }
        return { rows: [] };
      },
    };
    const result = await ensureSchema(queryable);
    expect(result.ok).toBe(true);
    expect(
      statements.some((sql) => /CREATE TABLE IF NOT EXISTS "user_entities"/i.test(sql)),
    ).toBe(true);
    expect(
      statements.some((sql) => /CREATE TABLE IF NOT EXISTS "pdf_documents"/i.test(sql)),
    ).toBe(false);
    expect(
      statements.some((sql) => /CREATE INDEX IF NOT EXISTS "pdf_chunks_search_idx"/i.test(sql)),
    ).toBe(false);
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
