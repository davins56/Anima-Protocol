import { describe, expect, it } from "vitest";
import { isPersonalAnimaRecord } from "./listPersonalAnimas";

describe("isPersonalAnimaRecord", () => {
  it("accepts explicit Anima flags and construct categories", () => {
    expect(isPersonalAnimaRecord({ _isAnima: true, name: "Serenity" })).toBe(
      true,
    );
    expect(isPersonalAnimaRecord({ category: "anima-construct" })).toBe(true);
    expect(isPersonalAnimaRecord({ category: "Anima" })).toBe(true);
  });

  it("rejects roster characters and empty rows", () => {
    expect(isPersonalAnimaRecord(null)).toBe(false);
    expect(
      isPersonalAnimaRecord({ name: "Naruto", universe: "Naruto" }),
    ).toBe(false);
    expect(isPersonalAnimaRecord({ category: "warrior" })).toBe(false);
  });
});
