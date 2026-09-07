import { describe, expect, it } from "vitest";
import {
  REQUIRED_TABLES,
  buildPresentTablesInspectQuery,
} from "../src/ensure-schema";

describe("buildPresentTablesInspectQuery", () => {
  it("uses scalar IN placeholders instead of ANY($1::text[])", () => {
    const { text, values } = buildPresentTablesInspectQuery(REQUIRED_TABLES);

    expect(text).not.toMatch(/ANY\s*\(\s*\$1\s*::\s*text\[\]\s*\)/i);
    expect(text).toMatch(/table_name IN \(/);
    expect(values).toEqual([...REQUIRED_TABLES]);
    expect(values).toHaveLength(REQUIRED_TABLES.length);

    for (let i = 0; i < values.length; i += 1) {
      expect(text).toContain(`$${i + 1}`);
      expect(typeof values[i]).toBe("string");
    }
    expect(text).not.toContain(`$${values.length + 1}`);
  });

  it("rejects names that are not safe identifiers", () => {
    expect(() =>
      buildPresentTablesInspectQuery(["user_entities; drop table x"]),
    ).toThrow(/Invalid table name/);
  });

  it("returns a no-row query when the name list is empty", () => {
    const { text, values } = buildPresentTablesInspectQuery([]);
    expect(values).toEqual([]);
    expect(text).toMatch(/WHERE false/i);
    expect(text).not.toMatch(/ANY\s*\(/i);
  });
});
