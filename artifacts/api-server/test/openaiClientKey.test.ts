import { afterEach, describe, expect, it } from "vitest";
import {
  getOpenRouterApiKey,
  getOpenRouterApiKeySource,
  hasOpenRouterKey,
  normalizeApiKey,
  openRouterKeyFingerprint,
  resetLlmClientsForTests,
} from "../src/lib/openaiClient";

describe("normalizeApiKey", () => {
  it("trims whitespace and surrounding quotes", () => {
    expect(normalizeApiKey('  "sk-or-abc"  ')).toBe("sk-or-abc");
    expect(normalizeApiKey("'sk-or-abc'")).toBe("sk-or-abc");
  });

  it("strips a Bearer prefix from dashboard / curl pastes", () => {
    expect(normalizeApiKey("Bearer sk-or-abc")).toBe("sk-or-abc");
    expect(normalizeApiKey("bearer sk-or-abc")).toBe("sk-or-abc");
  });

  it("returns null for empty values", () => {
    expect(normalizeApiKey(undefined)).toBeNull();
    expect(normalizeApiKey("   ")).toBeNull();
    expect(normalizeApiKey('""')).toBeNull();
  });
});

describe("OpenRouter key env aliases", () => {
  const SAVED = { ...process.env };

  afterEach(() => {
    process.env = { ...SAVED };
    resetLlmClientsForTests();
  });

  it("reads OPENROUTER_API_KEY", () => {
    process.env.OPENROUTER_API_KEY = "sk-or-v1-primary-key-zzzz";
    delete process.env.ANIMA_OPENROUTER_API_KEY;
    delete process.env.OPEN_ROUTER_API_KEY;
    expect(hasOpenRouterKey()).toBe(true);
    expect(getOpenRouterApiKey()).toBe("sk-or-v1-primary-key-zzzz");
    expect(getOpenRouterApiKeySource()).toBe("OPENROUTER_API_KEY");
    expect(openRouterKeyFingerprint()).toBe("zzzz");
  });

  it("reads OPEN_ROUTER_API_KEY when the canonical name is unset", () => {
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.ANIMA_OPENROUTER_API_KEY;
    process.env.OPEN_ROUTER_API_KEY = "sk-or-v1-alias-key-yyyy";
    expect(hasOpenRouterKey()).toBe(true);
    expect(getOpenRouterApiKey()).toBe("sk-or-v1-alias-key-yyyy");
    expect(getOpenRouterApiKeySource()).toBe("OPEN_ROUTER_API_KEY");
  });

  it("prefers OPENROUTER_API_KEY over aliases", () => {
    process.env.OPENROUTER_API_KEY = "sk-or-v1-canonical-xxxx";
    process.env.OPEN_ROUTER_API_KEY = "sk-or-v1-alias-yyyy";
    expect(getOpenRouterApiKey()).toBe("sk-or-v1-canonical-xxxx");
    expect(getOpenRouterApiKeySource()).toBe("OPENROUTER_API_KEY");
  });
});
