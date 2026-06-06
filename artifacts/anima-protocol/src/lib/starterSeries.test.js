import { describe, it, expect } from "vitest";
import {
  getStarterSeriesCatalog,
  searchStarterSeries,
  getStarterSeriesById,
} from "@/lib/seedCharacters";

describe("starter series catalog", () => {
  it("lists four preloaded series", () => {
    const catalog = getStarterSeriesCatalog();
    expect(catalog).toHaveLength(4);
    expect(catalog.map((s) => s.id).sort()).toEqual([
      "guardians",
      "invincible",
      "korra",
      "marvel",
    ]);
  });

  it("each series character has a stable seed id", () => {
    for (const series of getStarterSeriesCatalog()) {
      expect(series.characters.length).toBeGreaterThan(0);
      for (const char of series.characters) {
        expect(char.id).toMatch(/^seed_/);
        expect(char.name).toBeTruthy();
      }
    }
  });

  it("finds series by name and nickname", () => {
    expect(searchStarterSeries("korra").some((s) => s.id === "korra")).toBe(true);
    expect(searchStarterSeries("mcu").some((s) => s.id === "marvel")).toBe(true);
    expect(searchStarterSeries("guardians").some((s) => s.id === "guardians")).toBe(
      true,
    );
    expect(searchStarterSeries("invincible").some((s) => s.id === "invincible")).toBe(
      true,
    );
    expect(searchStarterSeries("avatar").some((s) => s.id === "korra")).toBe(true);
  });

  it("returns empty for blank search", () => {
    expect(searchStarterSeries("")).toEqual([]);
    expect(searchStarterSeries("   ")).toEqual([]);
  });

  it("resolves series by id", () => {
    const korra = getStarterSeriesById("korra");
    expect(korra?.name).toContain("Korra");
    expect(korra?.characters.some((c) => c.name === "Korra")).toBe(true);
  });
});
