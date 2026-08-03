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
  it("labels Kimi, Grok, and OpenAI (Gemini kept only as legacy)", () => {
    expect(llmProviderShortLabel("anima")).toBe("Anima");
    expect(llmProviderShortLabel("kimi")).toBe("Kimi");
    expect(llmProviderShortLabel("xai")).toBe("Grok");
    expect(llmProviderShortLabel("openai")).toBe("OpenAI");
    expect(llmProviderShortLabel("gemini")).toBe("Gemini");
    expect(llmProviderShortLabel(null)).toBeNull();
  });

  it("shows Anima when brand is set, even if a concrete backend provider is present", () => {
    expect(llmDisplayLabel("kimi", "anima")).toBe("Anima");
    expect(llmDisplayLabel("kimi", null)).toBe("Kimi");
    expect(llmDisplayTitle("kimi", "anima")).toMatch(/Anima/);
    expect(llmDisplayTitle("kimi", "anima")).toMatch(/Kimi/);
    expect(llmDisplayBadgeClass("openai", "anima")).toMatch(/rose/);
  });

  it("lists Kimi as the sole chat LLM (no Gemini)", () => {
    expect(CONFIGURED_LLM_PROVIDERS.map((p) => p.id)).toEqual(["kimi"]);
  });

  it("returns distinct badge classes", () => {
    expect(llmProviderBadgeClass("anima")).toMatch(/rose/);
    expect(llmProviderBadgeClass("kimi")).toMatch(/emerald/);
    expect(llmProviderBadgeClass("xai")).toMatch(/amber/);
    expect(llmProviderTitle("kimi")).toMatch(/Kimi/i);
  });
});
