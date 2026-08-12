import { describe, expect, it } from "vitest";
import {
  CUSTOMISE_ANIMA_TABS,
  normalizeCustomiseAnimaTab,
} from "./customiseAnimaTabs";

describe("normalizeCustomiseAnimaTab", () => {
  it("accepts known tabs", () => {
    for (const tab of CUSTOMISE_ANIMA_TABS) {
      expect(normalizeCustomiseAnimaTab(tab)).toBe(tab);
      expect(normalizeCustomiseAnimaTab(tab.toUpperCase())).toBe(tab);
    }
  });

  it("falls back to look for unknown or empty values", () => {
    expect(normalizeCustomiseAnimaTab(undefined)).toBe("look");
    expect(normalizeCustomiseAnimaTab("")).toBe("look");
    expect(normalizeCustomiseAnimaTab("avatar")).toBe("look");
  });
});
