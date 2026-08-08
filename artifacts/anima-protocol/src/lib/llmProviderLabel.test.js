import { describe, expect, it } from "vitest";
import {
  CONFIGURED_LLM_PROVIDERS,
  llmDisplayBadgeClass,
  llmDisplayLabel,
  llmDisplayTitle,
  llmProviderBadgeClass,
  llmProviderShortLabel,
  llmProviderTitle,
} from "./llmProviderLabel";

describe("llmProviderLabel", () => {
  it("labels Anima/local and returns null for anything else", () => {
    expect(llmProviderShortLabel("anima")).toBe("Anima");
    expect(llmProviderShortLabel("local")).toBe("Anima");
    expect(llmProviderShortLabel("kimi")).toBeNull();
    expect(llmProviderShortLabel(null)).toBeNull();
  });

  it("shows Anima when brand is set", () => {
    expect(llmDisplayLabel("local", "anima")).toBe("Anima");
    expect(llmDisplayLabel("local", null)).toBe("Anima");
    expect(llmDisplayTitle("local", "anima")).toMatch(/Anima LLM/);
    expect(llmDisplayTitle("local", "anima")).toMatch(/never switches/);
    expect(llmDisplayBadgeClass("local", "anima")).toMatch(/rose/);
  });

  it("lists only the self-hosted Anima LLM — no cloud BYOK backends", () => {
    expect(CONFIGURED_LLM_PROVIDERS.map((p) => p.id)).toEqual(["local"]);
  });

  it("returns the Anima badge class and title", () => {
    expect(llmProviderBadgeClass("anima")).toMatch(/rose/);
    expect(llmProviderBadgeClass("local")).toMatch(/rose/);
    expect(llmProviderTitle("local")).toMatch(/Anima LLM/i);
  });
});
