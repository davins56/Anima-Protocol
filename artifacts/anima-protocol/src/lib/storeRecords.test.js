import { describe, expect, it } from "vitest";
import {
  hydrateStoreList,
  hydrateStoreRecord,
  isUsableEntityId,
  normalizeStoreList,
} from "./storeRecords";

describe("storeRecords", () => {
  it("accepts a bare array or a Worker/proxy items wrapper", () => {
    expect(normalizeStoreList([{ id: "a" }])).toEqual([{ id: "a" }]);
    expect(normalizeStoreList({ items: [{ id: "b" }] })).toEqual([{ id: "b" }]);
    expect(normalizeStoreList({ data: [{ id: "c" }] })).toEqual([{ id: "c" }]);
    expect(normalizeStoreList(null)).toEqual([]);
    expect(normalizeStoreList({ count: 3 })).toEqual([]);
  });

  it("hydrates a missing jsonb id from the table entityId", () => {
    expect(isUsableEntityId(null)).toBe(false);
    expect(isUsableEntityId("undefined")).toBe(false);
    expect(hydrateStoreRecord({ name: "Korra" }, "seed_korra")).toEqual({
      name: "Korra",
      id: "seed_korra",
    });
    expect(hydrateStoreRecord({ id: "keep", name: "Asami" }, "other")).toEqual({
      id: "keep",
      name: "Asami",
    });
    expect(hydrateStoreList([{ name: "Custom" }], ["char_1"])).toEqual([
      { name: "Custom", id: "char_1" },
    ]);
  });
});
