import { describe, expect, it } from "vitest";
import { mayHaveOlderMessages, mergeOlderMessages, oldestSeq } from "./olderMessages";

describe("older message paging", () => {
  it("finds the oldest numeric seq", () => {
    expect(oldestSeq([{ seq: 7 }, { seq: "4" }, { seq: 9 }])).toBe(4);
    expect(oldestSeq([{ content: "x" }])).toBeNull();
  });

  it("knows a thread starting at seq 0 is complete", () => {
    expect(mayHaveOlderMessages([{ seq: 0 }, { seq: 1 }])).toBe(false);
    expect(mayHaveOlderMessages([{ seq: 200 }, { seq: 201 }])).toBe(true);
    expect(mayHaveOlderMessages([{ content: "local" }])).toBe(false);
  });

  it("prepends without duplicating rows already loaded", () => {
    const cur = [{ id: "b", seq: 2 }, { id: "c", seq: 3 }];
    const merged = mergeOlderMessages(cur, [{ id: "a", seq: 1 }, { id: "b", seq: 2 }]);
    expect(merged.map((m) => m.id)).toEqual(["a", "b", "c"]);
    expect(mergeOlderMessages(cur, [{ id: "b", seq: 2 }])).toBe(cur);
  });
});
