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
  it("labels Anima/local and Venice/OpenRouter", () => {
    expect(llmProviderShortLabel("anima")).toBe("Anima");
    expect(llmProviderShortLabel("local")).toBe("Anima");
    expect(llmProviderShortLabel("openrouter")).toBe("Venice");
    expect(llmProviderShortLabel("kimi")).toBeNull();
    expect(llmProviderShortLabel(null)).toBeNull();
  });

  it("shows Anima or Venice when brand is set", () => {
    expect(llmDisplayLabel("local", "anima")).toBe("Anima");
    expect(llmDisplayLabel("local", null)).toBe("Anima");
    expect(llmDisplayLabel("openrouter", "openrouter")).toBe("Venice");
    expect(llmDisplayTitle("local", "anima")).toMatch(/Anima LLM/);
    expect(llmDisplayTitle("openrouter", "openrouter")).toMatch(/Venice Uncensored/);
    expect(llmDisplayBadgeClass("local", "anima")).toMatch(/rose/);
    expect(llmDisplayBadgeClass("openrouter", "openrouter")).toMatch(/amber/);
  });

  it("lists self-hosted Anima and OpenRouter Venice backends", () => {
    expect(CONFIGURED_LLM_PROVIDERS.map((p) => p.id)).toEqual([
      "local",
      "openrouter",
    ]);
  });

  it("returns the Anima / OpenRouter badge class and title", () => {
    expect(llmProviderBadgeClass("anima")).toMatch(/rose/);
    expect(llmProviderBadgeClass("local")).toMatch(/rose/);
    expect(llmProviderBadgeClass("openrouter")).toMatch(/amber/);
    expect(llmProviderTitle("local")).toMatch(/Anima LLM/i);
    expect(llmProviderTitle("openrouter")).toMatch(/Venice Uncensored/i);
  });
});
