import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createMock = vi.fn();
const geminiStreamMock = vi.fn();
const geminiCompletionMock = vi.fn();

vi.mock("../src/lib/openaiClient", () => {
  const client = {
    chat: { completions: { create: (...args: unknown[]) => createMock(...args) } },
  };
  return {
    hasOpenAIKey: () => Boolean(process.env.OPENAI_API_KEY?.trim()),
    hasXaiKey: () => Boolean(process.env.XAI_API_KEY?.trim()),
    hasGeminiKey: () =>
      Boolean(process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim()),
    hasKimiKey: () =>
      Boolean(process.env.KIMI_API_KEY?.trim() || process.env.MOONSHOT_API_KEY?.trim()),
    getOpenAIClient: () => client,
    getXaiClient: () => (process.env.XAI_API_KEY?.trim() ? client : null),
    getGeminiClient: () =>
      process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim()
        ? client
        : null,
    getKimiClient: () =>
      process.env.KIMI_API_KEY?.trim() || process.env.MOONSHOT_API_KEY?.trim()
        ? client
        : null,
    normalizeApiKey: (raw: string | undefined) => {
      if (!raw) return null;
      return raw.trim() || null;
    },
    resetLlmClientsForTests: () => {},
  };
});

vi.mock("../src/lib/geminiNative", () => ({
  createGeminiChatStream: (...args: unknown[]) => geminiStreamMock(...args),
  createGeminiChatCompletion: (...args: unknown[]) => geminiCompletionMock(...args),
}));

import {
  createChatCompletionWithFailover,
  createChatStreamWithFailover,
  getAnimaTierProviderOrder,
  getConfiguredProviderMode,
  getLlmRoutingStatus,
  getPreferredProvider,
  getProviderChain,
  isAnimaCustomMode,
  isGeminiStickySkipped,
  isKimiStickySkipped,
  isOpenAIBlocked,
  isOpenAIStickySkipped,
  isXaiBlocked,
  isXaiStickySkipped,
  isProviderAuthError,
  extractXaiBillingUrl,
  isProviderUnusableError,
  recordProviderFailure,
  resetLlmFailoverStateForTests,
  resolveGeminiModel,
  resolveKimiModel,
  resolveXaiModel,
  reviveStickySkippedProvidersIfNeeded,
  sanitizeProviderEnv,
} from "../src/lib/llmFailover";

function fakeStream(label = "ok") {
  return {
    async *[Symbol.asyncIterator]() {
      yield { choices: [{ delta: { content: label } }] };
    },
  };
}

function fakeCompletion(content = "ok") {
  return { choices: [{ message: { content } }] };
}

describe("isProviderUnusableError", () => {
  it("detects OpenAI credit / quota exhaustion", () => {
    expect(
      isProviderUnusableError({
        status: 429,
        message:
          "429 You have no credits remaining. Add credits to continue using the API at https://platform.openai.com/settings/organization/billing/",
      }),
    ).toBe(true);
    expect(
      isProviderUnusableError({ status: 429, code: "insufficient_quota" }),
    ).toBe(true);
  });

  it("detects 401 / invalid API key (including SDK 'no body' message)", () => {
    expect(isProviderAuthError({ status: 401, message: "401 status code (no body)" })).toBe(
      true,
    );
    expect(isProviderUnusableError({ status: 401, message: "401 status code (no body)" })).toBe(
      true,
    );
  });

  it("detects xAI team with no credits/licenses (403)", () => {
    const xaiTeamError = {
      status: 403,
      message:
        '403 "Your newly created team doesn\'t have any credits or licenses yet. You can purchase those on https://console.x.ai/team/dd82a210-6dbf-46a7-b5cf-c7cdffdd7374."',
    };
    expect(isProviderUnusableError(xaiTeamError)).toBe(true);
    expect(extractXaiBillingUrl(xaiTeamError)).toBe(
      "https://console.x.ai/team/dd82a210-6dbf-46a7-b5cf-c7cdffdd7374",
    );
  });
});

describe("sanitizeProviderEnv", () => {
  it("rejects Gemini AQ keys pasted into ANIMA_LLM_PROVIDER", () => {
    expect(
      sanitizeProviderEnv("AQ.Ab8RN6LnPybKM8XuEVGP3i6PPJsaLJel5DeEfows_E_ZuL3_MQ"),
    ).toBeNull();
    expect(sanitizeProviderEnv("auto")).toBe("auto");
    expect(sanitizeProviderEnv("gemini")).toBe("gemini");
  });
});

describe("resolve models", () => {
  const SAVED = { ...process.env };
  afterEach(() => {
    process.env = { ...SAVED };
  });

  it("defaults Gemini / Kimi / xAI models per tier", () => {
    delete process.env.ANIMA_GEMINI_MODEL;
    delete process.env.ANIMA_KIMI_MODEL;
    delete process.env.ANIMA_XAI_MODEL;
    expect(resolveGeminiModel("standard").model).toBe("gemini-2.5-flash");
    expect(resolveKimiModel("standard").model).toBe("kimi-k2.6");
    expect(resolveXaiModel("standard").model).toBe("grok-3");
  });
});

describe("ANIMA_LLM_PROVIDER / provider chain", () => {
  const SAVED = { ...process.env };

  beforeEach(() => {
    process.env = { ...SAVED };
    process.env.OPENAI_API_KEY = "sk-test-openai";
    process.env.XAI_API_KEY = "xai-test";
    process.env.GEMINI_API_KEY = "gemini-test";
    process.env.KIMI_API_KEY = "kimi-test";
    delete process.env.ANIMA_LLM_PROVIDER;
    delete process.env.ANIMA_DISABLE_OPENAI;
    delete process.env.ANIMA_DISABLE_XAI;
    resetLlmFailoverStateForTests();
  });

  afterEach(() => {
    process.env = { ...SAVED };
    resetLlmFailoverStateForTests();
  });

  it("defaults to Gemini-first auto chain (the last working unpaid path)", () => {
    delete process.env.ANIMA_LLM_PROVIDER;
    expect(getConfiguredProviderMode()).toBe("auto");
    expect(getProviderChain()).toEqual(["gemini", "kimi", "xai", "openai"]);
    expect(getPreferredProvider()).toBe("gemini");
  });

  it("honors ANIMA_LLM_PROVIDER=gemini as Gemini-only", () => {
    process.env.ANIMA_LLM_PROVIDER = "gemini";
    expect(getConfiguredProviderMode()).toBe("gemini");
    expect(isOpenAIBlocked()).toBe(true);
    expect(isXaiBlocked()).toBe(true);
    expect(getProviderChain()).toEqual(["gemini"]);
  });

  it("uses Kimi-only when ANIMA_LLM_PROVIDER=kimi", () => {
    process.env.ANIMA_LLM_PROVIDER = "kimi";
    expect(getProviderChain()).toEqual(["kimi"]);
  });

  it("ignores API-key-like ANIMA_LLM_PROVIDER and still prefers Gemini", () => {
    process.env.ANIMA_LLM_PROVIDER =
      "AQ.Ab8RN6LnPybKM8XuEVGP3i6PPJsaLJel5DeEfows_E_ZuL3_MQ";
    expect(getConfiguredProviderMode()).toBe("auto");
    expect(getProviderChain()[0]).toBe("gemini");
    const status = getLlmRoutingStatus();
    expect(status.rawProviderEnv).toBeNull();
    expect(status.geminiRetiredForChat).toBe(false);
    expect(status.note).toMatch(/Gemini/i);
  });

  it("auto without Gemini uses Kimi → Grok → OpenAI", () => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    expect(getProviderChain()).toEqual(["kimi", "xai", "openai"]);
  });

  it("treats anima mode as auto chain with brand chip", () => {
    process.env.ANIMA_LLM_PROVIDER = "anima";
    expect(getConfiguredProviderMode()).toBe("auto");
    expect(isAnimaCustomMode()).toBe(true);
    expect(getProviderChain()[0]).toBe("gemini");
    expect(getAnimaTierProviderOrder("standard")).toContain("gemini");
  });
});

describe("createChatStreamWithFailover", () => {
  const SAVED = { ...process.env };

  beforeEach(() => {
    process.env = { ...SAVED };
    process.env.OPENAI_API_KEY = "sk-test-openai";
    process.env.XAI_API_KEY = "xai-test";
    process.env.GEMINI_API_KEY = "gemini-test";
    process.env.KIMI_API_KEY = "kimi-test";
    delete process.env.ANIMA_LLM_PROVIDER;
    delete process.env.ANIMA_DISABLE_OPENAI;
    resetLlmFailoverStateForTests();
    createMock.mockReset();
    geminiStreamMock.mockReset();
    geminiCompletionMock.mockReset();
  });

  afterEach(() => {
    process.env = { ...SAVED };
    resetLlmFailoverStateForTests();
  });

  it("uses Gemini first under auto (restored working path)", async () => {
    geminiStreamMock.mockResolvedValueOnce(fakeStream("gemini"));
    const result = await createChatStreamWithFailover({
      tier: "standard",
      model: "gpt-4o",
      maxTokens: 8192,
      messages: [{ role: "user", content: "hello" }],
    });
    expect(result.provider).toBe("gemini");
    expect(result.model).toBe("gemini-2.5-flash");
    expect(geminiStreamMock).toHaveBeenCalledTimes(1);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("fails over from exhausted Kimi to next provider when Gemini is absent", async () => {
    delete process.env.GEMINI_API_KEY;
    process.env.ANIMA_LLM_PROVIDER = "auto";
    createMock
      .mockRejectedValueOnce({ status: 429, message: "quota exhausted" })
      .mockResolvedValueOnce(fakeStream("grok-backup"));

    const result = await createChatStreamWithFailover({
      tier: "standard",
      model: "gpt-4o",
      maxTokens: 8192,
      messages: [{ role: "user", content: "hello" }],
    });

    expect(result.provider).toBe("xai");
    expect(result.failedOver).toBe(true);
    expect(isKimiStickySkipped()).toBe(true);
  });

  it("fails over from Gemini quota to Kimi", async () => {
    geminiStreamMock.mockRejectedValueOnce({
      status: 429,
      message: "quota exhausted",
    });
    createMock.mockResolvedValueOnce(fakeStream("kimi-backup"));

    const result = await createChatStreamWithFailover({
      tier: "standard",
      model: "gpt-4o",
      maxTokens: 8192,
      messages: [{ role: "user", content: "hello" }],
    });

    expect(result.provider).toBe("kimi");
    expect(result.failedOver).toBe(true);
    expect(result.previousProvider).toBe("gemini");
    expect(isGeminiStickySkipped()).toBe(true);
  });

  it("revives sticky skips when every provider was marked unusable", async () => {
    recordProviderFailure("gemini", { status: 429, message: "quota exhausted" });
    recordProviderFailure("kimi", { status: 429, message: "quota exhausted" });
    recordProviderFailure("xai", {
      status: 403,
      message:
        '403 "Your newly created team doesn\'t have any credits or licenses yet. You can purchase those on https://console.x.ai/team/abc."',
    });
    recordProviderFailure("openai", {
      status: 429,
      message: "You have no credits remaining",
    });

    expect(isGeminiStickySkipped()).toBe(true);
    expect(isKimiStickySkipped()).toBe(true);
    expect(isXaiStickySkipped()).toBe(true);
    expect(isOpenAIStickySkipped()).toBe(true);
    expect(getProviderChain()[0]).toBe("gemini");
    expect(reviveStickySkippedProvidersIfNeeded()).toBe(false); // already cleared by getProviderChain
  });

  it("retries Kimi standard model on model-unavailable", async () => {
    delete process.env.GEMINI_API_KEY;
    process.env.ANIMA_LLM_PROVIDER = "kimi";
    createMock
      .mockRejectedValueOnce({
        status: 404,
        code: "model_not_found",
        message: "The model does not exist",
      })
      .mockResolvedValueOnce(fakeStream("standard"));

    const result = await createChatStreamWithFailover({
      tier: "heavy",
      model: "gpt-4.1",
      maxTokens: 8192,
      messages: [{ role: "user", content: "hi" }],
    });

    expect(result.provider).toBe("kimi");
    expect(result.model).toBe("kimi-k2.6");
    expect(createMock).toHaveBeenCalledTimes(2);
  });
});

describe("createChatCompletionWithFailover", () => {
  const SAVED = { ...process.env };

  beforeEach(() => {
    process.env = { ...SAVED };
    process.env.OPENAI_API_KEY = "sk-test-openai";
    process.env.XAI_API_KEY = "xai-test";
    process.env.GEMINI_API_KEY = "gemini-test";
    process.env.KIMI_API_KEY = "kimi-test";
    delete process.env.ANIMA_LLM_PROVIDER;
    resetLlmFailoverStateForTests();
    createMock.mockReset();
    geminiStreamMock.mockReset();
    geminiCompletionMock.mockReset();
  });

  afterEach(() => {
    process.env = { ...SAVED };
    resetLlmFailoverStateForTests();
  });

  it("uses Gemini completion under auto", async () => {
    geminiCompletionMock.mockResolvedValueOnce(fakeCompletion("gemini reply"));
    const result = await createChatCompletionWithFailover({
      tier: "standard",
      maxTokens: 1024,
      messages: [{ role: "system", content: "You are Serenity." }],
    });
    expect(result.content).toBe("gemini reply");
    expect(result.provider).toBe("gemini");
    expect(createMock).not.toHaveBeenCalled();
  });
});
