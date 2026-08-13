import { describe, it, expect, vi, afterEach } from "vitest";
import {
  sanitizeRegionField,
  collectRegionHints,
  formatUserRegionPromptBlock,
  messageNeedsWorldKnowledge,
} from "./userRegion";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("userRegion", () => {
  it("strips prompt-breakers from free-text fields", () => {
    expect(sanitizeRegionField("  Kyoto <<<INJECT>>> ")).toBe("Kyoto INJECT");
  });

  it("collects browser timezone and profile city", () => {
    vi.stubGlobal("Intl", {
      DateTimeFormat: function DateTimeFormat() {
        return {
          resolvedOptions: () => ({ timeZone: "Pacific/Auckland", locale: "en-NZ" }),
          format: () => "Friday",
        };
      },
    });
    vi.stubGlobal("navigator", { language: "en-NZ" });
    const hints = collectRegionHints({
      city: "Auckland",
      country: "New Zealand",
      share_region: true,
    });
    expect(hints.timezone).toBe("Pacific/Auckland");
    expect(hints.city).toBe("Auckland");
    expect(hints.country).toBe("New Zealand");
    expect(hints.share_region).toBe(true);
  });

  it("honors share_region false", () => {
    vi.stubGlobal("navigator", { language: "fr-FR" });
    const hints = collectRegionHints({
      share_region: false,
      city: "Paris",
      country: "France",
      timezone: "Europe/Paris",
      locale: "fr-FR",
    });
    expect(hints).toEqual({ share_region: false });
    expect(formatUserRegionPromptBlock(hints)).toBe("");
  });

  it("formats a USER_REGION prompt block", () => {
    const block = formatUserRegionPromptBlock(
      {
        timezone: "America/Chicago",
        locale: "en-US",
        city: "Chicago",
        country: "United States",
        share_region: true,
      },
      "Thursday, August 13, 2026 at 12:04 AM CDT",
    );
    expect(block).toContain("<<<USER_REGION>>>");
    expect(block).toContain("Chicago");
    expect(block).toContain("America/Chicago");
    expect(block).toContain("Do not invent a more specific address");
  });

  it("detects region-dependent questions", () => {
    expect(messageNeedsWorldKnowledge("what's the weather like?")).toBe(true);
    expect(messageNeedsWorldKnowledge("what time is it there")).toBe(true);
    expect(messageNeedsWorldKnowledge("hello")).toBe(false);
  });
});
