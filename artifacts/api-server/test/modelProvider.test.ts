import { afterEach, describe, expect, it, vi } from "vitest";
import { createModelProvider, getProviderFallbackChain } from "../src/lib/modelProvider";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("createModelProvider", () => {
  it("returns a mock provider by default", async () => {
    const provider = createModelProvider();
    const response = await provider.generate({ prompt: "hello" });

    expect(response.provider).toBe("mock");
    expect(response.text).toContain("Mock reply");
  });

  it("always appends a mock fallback when the configured list omits it", () => {
    vi.stubEnv("ANIMA_LLM_PROVIDER", "openai");
    vi.stubEnv("ANIMA_LLM_FALLBACKS", "groq,openai");

    const chain = getProviderFallbackChain();

    expect(chain.providers).toEqual(["groq", "openai", "mock"]);
  });
});
