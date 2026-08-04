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
  it("labels Gemini, Kimi, Grok, OpenAI, and AI Gateway", () => {
    expect(llmProviderShortLabel("anima")).toBe("Anima");
    expect(llmProviderShortLabel("kimi")).toBe("Kimi");
    expect(llmProviderShortLabel("xai")).toBe("Grok");
    expect(llmProviderShortLabel("openai")).toBe("OpenAI");
    expect(llmProviderShortLabel("gemini")).toBe("Gemini");
    expect(llmProviderShortLabel("gateway")).toBe("Gateway");
    expect(llmProviderShortLabel(null)).toBeNull();
  });

  it("shows Anima when brand is set, even if a concrete backend provider is present", () => {
    expect(llmDisplayLabel("kimi", "anima")).toBe("Anima");
    expect(llmDisplayLabel("kimi", null)).toBe("Kimi");
    expect(llmDisplayTitle("kimi", "anima")).toMatch(/Anima/);
    expect(llmDisplayTitle("kimi", "anima")).toMatch(/Kimi/);
    expect(llmDisplayBadgeClass("openai", "anima")).toMatch(/rose/);
  });

  it("lists Gemini-first auto chain providers including AI Gateway", () => {
    expect(CONFIGURED_LLM_PROVIDERS.map((p) => p.id)).toEqual([
      "gemini",
      "kimi",
      "xai",
      "openai",
      "gateway",
    ]);
  });

  it("returns distinct badge classes", () => {
    expect(llmProviderBadgeClass("anima")).toMatch(/rose/);
    expect(llmProviderBadgeClass("kimi")).toMatch(/emerald/);
    expect(llmProviderBadgeClass("xai")).toMatch(/amber/);
    expect(llmProviderBadgeClass("gateway")).toMatch(/violet/);
    expect(llmProviderTitle("kimi")).toMatch(/Kimi/i);
    expect(llmProviderTitle("gateway")).toMatch(/Gateway/i);
  });
});
