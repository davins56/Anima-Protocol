import { describe, expect, it } from "vitest";
import {
  normalizeProactiveFrequency,
  sanitizeProactiveMessage,
} from "../src/lib/proactiveMessages";

describe("proactive message helpers", () => {
  it("accepts only supported, respectful cadences", () => {
    expect(normalizeProactiveFrequency(24)).toBe(24);
    expect(normalizeProactiveFrequency("72")).toBe(72);
    expect(normalizeProactiveFrequency(168)).toBe(168);
    expect(normalizeProactiveFrequency(1)).toBe(24);
  });

  it("removes model formatting and caps notification previews", () => {
    expect(sanitizeProactiveMessage('```text\n"Still thinking about our last adventure."\n```'))
      .toBe("Still thinking about our last adventure.");
    expect(sanitizeProactiveMessage("x".repeat(500))).toHaveLength(320);
    expect(sanitizeProactiveMessage("x".repeat(500))).toMatch(/…$/);
  });
});
