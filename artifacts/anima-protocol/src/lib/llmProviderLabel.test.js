import { describe, expect, it } from "vitest";
import {
  CONFIGURED_LLM_PROVIDERS,
  llmProviderBadgeClass,
  llmProviderShortLabel,
  llmProviderTitle,
} from "./llmProviderLabel";

describe("llmProviderLabel", () => {
  it("labels Gemini, Grok, and OpenAI", () => {
    expect(llmProviderShortLabel("gemini")).toBe("Gemini");
    expect(llmProviderShortLabel("xai")).toBe("Grok");
    expect(llmProviderShortLabel("openai")).toBe("OpenAI");
    expect(llmProviderShortLabel(null)).toBeNull();
  });

  it("includes Gemini in the configured provider list", () => {
    expect(CONFIGURED_LLM_PROVIDERS.map((p) => p.id)).toEqual([
      "gemini",
      "xai",
      "openai",
    ]);
  });

  it("returns distinct badge classes", () => {
    expect(llmProviderBadgeClass("gemini")).toMatch(/sky/);
    expect(llmProviderBadgeClass("xai")).toMatch(/amber/);
    expect(llmProviderTitle("gemini")).toMatch(/Gemini/i);
  });
});
