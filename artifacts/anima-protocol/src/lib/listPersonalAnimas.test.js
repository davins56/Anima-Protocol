import { describe, expect, it } from "vitest";
import { isPersonalAnimaRecord, selectPersonalAnima } from "./listPersonalAnimas";

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

describe("selectPersonalAnima", () => {
  const rows = [
    { id: "anima-1", name: "Lumen", assigned_user: "other@example.com" },
    { id: "anima-2", name: "Serenity", assigned_user: "operator@example.com" },
  ];

  it("honors a requested id, then assigned_user, then the first row", () => {
    expect(selectPersonalAnima(rows, "anima-1", { email: "operator@example.com" })?.id).toBe(
      "anima-1",
    );
    expect(selectPersonalAnima(rows, null, { email: "operator@example.com" })?.id).toBe(
      "anima-2",
    );
    expect(selectPersonalAnima(rows, null, { email: "nobody@example.com" })?.id).toBe(
      "anima-1",
    );
  });
});
