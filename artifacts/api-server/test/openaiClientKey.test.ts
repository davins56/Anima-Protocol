import { afterEach, describe, expect, it } from "vitest";
import {
  JULES_FREE_MODEL,
  MINIMAX_FREE_MODEL,
  OPENROUTER_FREE_GEMMA4_26B_MODEL,
  OPENROUTER_FREE_GEMMA4_31B_MODEL,
  OPENROUTER_FREE_M27_MODEL,
  OPENROUTER_FREE_M3_MODEL,
  OPENROUTER_FREE_MODEL,
  OPENROUTER_FREE_MODEL_CANDIDATES,
  OPENROUTER_VENICE_UNCENSORED,
  getOpenRouterApiKey,
  getOpenRouterApiKeySource,
  getOpenRouterClient,
  hasOpenRouterKey,
  normalizeApiKey,
  openRouterKeyFingerprint,
  openRouterMaxRetries,
  resetLlmClientsForTests,
  getMinimaxApiKey,
  getMinimaxApiKeySource,
  hasMinimaxKey,
} from "../src/lib/openaiClient";

describe("OpenRouter catalog defaults", () => {
  it("keeps Venice as the paid default and a live :free slug for zero-credit fallback", () => {
    expect(OPENROUTER_VENICE_UNCENSORED).toBe(
      "cognitivecomputations/dolphin-mistral-24b-venice-edition",
    );
    expect(OPENROUTER_FREE_MODEL).toBe("minimax/minimax-m2.7:free");
    expect(OPENROUTER_FREE_MODEL).toBe(OPENROUTER_FREE_M27_MODEL);
    expect(OPENROUTER_FREE_MODEL.endsWith(":free")).toBe(true);
    expect(OPENROUTER_FREE_MODEL).not.toBe("openai/gpt-oss-20b:free");
    expect(OPENROUTER_FREE_MODEL).not.toBe("google/gemma-4-31b-it:free");
    expect(OPENROUTER_FREE_MODEL).not.toBe(OPENROUTER_FREE_M3_MODEL);
    expect(OPENROUTER_FREE_M3_MODEL).toBe("minimax/minimax-m3:free");
    expect(OPENROUTER_FREE_GEMMA4_26B_MODEL).toBe("google/gemma-4-26b-a4b-it:free");
    expect(OPENROUTER_FREE_GEMMA4_31B_MODEL).toBe("google/gemma-4-31b-it:free");
    expect(MINIMAX_FREE_MODEL).toBe(OPENROUTER_FREE_M3_MODEL);
    expect(JULES_FREE_MODEL).toBe(OPENROUTER_FREE_GEMMA4_26B_MODEL);
    expect(OPENROUTER_FREE_MODEL_CANDIDATES).toEqual([
      "minimax/minimax-m2.7:free",
      "minimax/minimax-m3:free",
      "google/gemma-4-26b-a4b-it:free",
      "google/gemma-4-31b-it:free",
    ]);
    expect(OPENROUTER_FREE_MODEL_CANDIDATES).not.toContain("google/gemma-3-12b-it:free");
    expect(OPENROUTER_FREE_MODEL_CANDIDATES).not.toContain("minimax/minimax-01:free");
    expect(OPENROUTER_FREE_MODEL_CANDIDATES.every((slug) => slug.endsWith(":free"))).toBe(true);
  });
});

describe("openRouterMaxRetries", () => {
  const SAVED = { ...process.env };

  afterEach(() => {
    process.env = { ...SAVED };
    resetLlmClientsForTests();
  });

  it("defaults to 2 so a single OpenRouter 502 does not kill the turn", () => {
    delete process.env.ANIMA_OPENROUTER_MAX_RETRIES;
    expect(openRouterMaxRetries()).toBe(2);
  });

  it("honors ANIMA_OPENROUTER_MAX_RETRIES", () => {
    process.env.ANIMA_OPENROUTER_MAX_RETRIES = "0";
    expect(openRouterMaxRetries()).toBe(0);
  });

  it("configures the OpenRouter SDK client with those retries", () => {
    delete process.env.ANIMA_OPENROUTER_MAX_RETRIES;
    process.env.OPENROUTER_API_KEY = "sk-or-v1-retry-test-zzzz";
    const client = getOpenRouterClient();
    expect(client).toBeTruthy();
    expect(client?.maxRetries).toBe(2);
  });
});

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

describe("MiniMax key env aliases", () => {
  const SAVED = { ...process.env };

  afterEach(() => {
    process.env = { ...SAVED };
    resetLlmClientsForTests();
  });

  it("reads MINIMAX_API_KEY and prefers it over the Anima alias", () => {
    process.env.MINIMAX_API_KEY = "  minimax-primary-key  ";
    process.env.ANIMA_MINIMAX_API_KEY = "minimax-alias-key";
    expect(hasMinimaxKey()).toBe(true);
    expect(getMinimaxApiKey()).toBe("minimax-primary-key");
    expect(getMinimaxApiKeySource()).toBe("MINIMAX_API_KEY");
  });
});
