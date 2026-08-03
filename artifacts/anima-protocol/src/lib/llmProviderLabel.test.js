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
  it("labels Anima, Gemini, Kimi, Grok, and OpenAI", () => {
    expect(llmProviderShortLabel("anima")).toBe("Anima");
    expect(llmProviderShortLabel("gemini")).toBe("Gemini");
    expect(llmProviderShortLabel("kimi")).toBe("Kimi");
    expect(llmProviderShortLabel("xai")).toBe("Grok");
    expect(llmProviderShortLabel("openai")).toBe("OpenAI");
    expect(llmProviderShortLabel(null)).toBeNull();
  });

  it("shows Anima when brand is set, even if a concrete backend provider is present", () => {
    expect(llmDisplayLabel("gemini", "anima")).toBe("Anima");
    expect(llmDisplayLabel("kimi", null)).toBe("Kimi");
    expect(llmDisplayTitle("xai", "anima")).toMatch(/Anima custom LLM/);
    expect(llmDisplayTitle("xai", "anima")).toMatch(/Grok/);
    expect(llmDisplayBadgeClass("openai", "anima")).toMatch(/rose/);
  });

  it("lists Anima plus the four backend families", () => {
    expect(CONFIGURED_LLM_PROVIDERS.map((p) => p.id)).toEqual([
      "anima",
      "kimi",
      "gemini",
      "xai",
      "openai",
    ]);
  });

  it("returns distinct badge classes", () => {
    expect(llmProviderBadgeClass("anima")).toMatch(/rose/);
    expect(llmProviderBadgeClass("gemini")).toMatch(/sky/);
    expect(llmProviderBadgeClass("kimi")).toMatch(/emerald/);
    expect(llmProviderBadgeClass("xai")).toMatch(/amber/);
    expect(llmProviderTitle("kimi")).toMatch(/Kimi/i);
    expect(llmProviderTitle("gemini")).toMatch(/Gemini/i);
  });
});
