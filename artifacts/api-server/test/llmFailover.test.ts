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
  isKimiStickySkipped,
  isOpenAIBlocked,
  isXaiBlocked,
  isProviderAuthError,
  extractXaiBillingUrl,
  isProviderUnusableError,
  resetLlmFailoverStateForTests,
  resolveGeminiModel,
  resolveKimiModel,
  resolveXaiModel,
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
  it("detects OpenAI credit / quota exhaustion (the screenshot 429)", () => {
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
    expect(isProviderUnusableError({ status: 402, message: "Payment required" })).toBe(true);
  });

  it("detects 401 / invalid API key (including SDK 'no body' message)", () => {
    expect(isProviderAuthError({ status: 401, message: "401 status code (no body)" })).toBe(
      true,
    );
    expect(isProviderUnusableError({ status: 401, message: "401 status code (no body)" })).toBe(
      true,
    );
    expect(
      isProviderUnusableError({
        status: 401,
        code: "invalid_api_key",
        message: "Incorrect API key provided",
      }),
    ).toBe(true);
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

  it("does not treat model-unavailable as provider-unusable", () => {
    expect(
      isProviderUnusableError({
        status: 404,
        message: "The model does not exist",
        code: "model_not_found",
      }),
    ).toBe(false);
    expect(isProviderUnusableError({ status: 500, message: "internal error" })).toBe(false);
  });
});

describe("sanitizeProviderEnv", () => {
  it("rejects Gemini AQ keys and other secrets pasted into ANIMA_LLM_PROVIDER", () => {
    expect(
      sanitizeProviderEnv("AQ.Ab8RN6LnPybKM8XuEVGP3i6PPJsaLJel5DeEfows_E_ZuL3_MQ"),
    ).toBeNull();
    expect(sanitizeProviderEnv("sk-proj-abcdef")).toBeNull();
    expect(sanitizeProviderEnv("xai-abc123")).toBeNull();
    expect(sanitizeProviderEnv("auto")).toBe("auto");
    expect(sanitizeProviderEnv("kimi")).toBe("kimi");
  });
});

describe("resolveXaiModel / resolveGeminiModel", () => {
  const SAVED = { ...process.env };
  afterEach(() => {
    process.env = { ...SAVED };
  });

  it("defaults per tier and honors env overrides for xAI", () => {
    delete process.env.ANIMA_XAI_MODEL;
    delete process.env.ANIMA_XAI_MODEL_LIGHT;
    delete process.env.ANIMA_XAI_MODEL_STANDARD;
    delete process.env.ANIMA_XAI_MODEL_HEAVY;
    expect(resolveXaiModel("light").model).toBe("grok-3-mini");
    expect(resolveXaiModel("standard").model).toBe("grok-3");
    expect(resolveXaiModel("heavy").model).toBe("grok-4");

    process.env.ANIMA_XAI_MODEL_HEAVY = "grok-4.5";
    expect(resolveXaiModel("heavy").model).toBe("grok-4.5");
  });

  it("marks Gemini models as retired for chat", () => {
    expect(resolveGeminiModel("standard").model).toBe("gemini-retired");
  });

  it("defaults per tier and honors env overrides for Kimi", () => {
    delete process.env.ANIMA_KIMI_MODEL;
    delete process.env.ANIMA_KIMI_MODEL_LIGHT;
    delete process.env.ANIMA_KIMI_MODEL_STANDARD;
    delete process.env.ANIMA_KIMI_MODEL_HEAVY;
    expect(resolveKimiModel("light").model).toBe("kimi-k2.6");
    expect(resolveKimiModel("standard").model).toBe("kimi-k2.6");
    expect(resolveKimiModel("heavy").model).toBe("kimi-k3");

    process.env.ANIMA_KIMI_MODEL_STANDARD = "kimi-k2.7-code";
    expect(resolveKimiModel("standard").model).toBe("kimi-k2.7-code");
  });
});

describe("ANIMA_LLM_PROVIDER / OpenAI block", () => {
  const SAVED = { ...process.env };

  beforeEach(() => {
    process.env = { ...SAVED };
    process.env.OPENAI_API_KEY = "sk-test-openai";
    process.env.XAI_API_KEY = "xai-test";
    process.env.GEMINI_API_KEY = "gemini-test";
    delete process.env.KIMI_API_KEY;
    delete process.env.MOONSHOT_API_KEY;
    delete process.env.ANIMA_LLM_PROVIDER;
    delete process.env.ANIMA_DISABLE_OPENAI;
    delete process.env.ANIMA_DISABLE_XAI;
    resetLlmFailoverStateForTests();
  });

  afterEach(() => {
    process.env = { ...SAVED };
    resetLlmFailoverStateForTests();
  });

  it("does not use Gemini for chat even when GEMINI_API_KEY is set", () => {
    delete process.env.ANIMA_LLM_PROVIDER;
    delete process.env.KIMI_API_KEY;
    expect(getConfiguredProviderMode()).toBe("auto");
    expect(getProviderChain()).toEqual(["xai", "openai"]);
    expect(getProviderChain()).not.toContain("gemini");
  });

  it("defaults to Kimi-first auto chain when KIMI_API_KEY is set", () => {
    process.env.KIMI_API_KEY = "kimi-test";
    delete process.env.ANIMA_LLM_PROVIDER;
    expect(getConfiguredProviderMode()).toBe("auto");
    expect(isOpenAIBlocked()).toBe(false);
    expect(isXaiBlocked()).toBe(false);
    expect(getProviderChain()).toEqual(["kimi", "xai", "openai"]);
    expect(getPreferredProvider()).toBe("kimi");
  });

  it("ignores Gemini key and ANIMA_LLM_PROVIDER=gemini — uses auto chain", () => {
    process.env.GEMINI_API_KEY = "gemini-test";
    process.env.KIMI_API_KEY = "kimi-test";
    process.env.ANIMA_LLM_PROVIDER = "gemini";
    expect(getConfiguredProviderMode()).toBe("auto");
    expect(getProviderChain()).toEqual(["kimi", "xai", "openai"]);
    expect(getPreferredProvider()).toBe("kimi");
  });

  it("honors ANIMA_LLM_PROVIDER=auto with Kimi key (Kimi → Grok → OpenAI)", () => {
    process.env.ANIMA_LLM_PROVIDER = "auto";
    process.env.KIMI_API_KEY = "kimi-test";
    expect(getConfiguredProviderMode()).toBe("auto");
    expect(getProviderChain()).toEqual(["kimi", "xai", "openai"]);
  });

  it("ignores API-key-like ANIMA_LLM_PROVIDER values", () => {
    process.env.KIMI_API_KEY = "kimi-test";
    process.env.ANIMA_LLM_PROVIDER =
      "AQ.Ab8RN6LnPybKM8XuEVGP3i6PPJsaLJel5DeEfows_E_ZuL3_MQ";
    expect(getConfiguredProviderMode()).toBe("auto");
    expect(getProviderChain()).toEqual(["kimi", "xai", "openai"]);
    const status = getLlmRoutingStatus();
    expect(status.rawProviderEnv).toBeNull();
    expect(status.note).toMatch(/looks like an API key/i);
  });

  it("auto without Kimi uses Grok then OpenAI (never Gemini)", () => {
    delete process.env.KIMI_API_KEY;
    delete process.env.MOONSHOT_API_KEY;
    process.env.ANIMA_LLM_PROVIDER = "auto";
    expect(getConfiguredProviderMode()).toBe("auto");
    expect(getProviderChain()).toEqual(["xai", "openai"]);
    expect(getProviderChain()).not.toContain("gemini");
  });

  it("auto uses OpenAI alone when no alt keys are configured", () => {
    delete process.env.XAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.KIMI_API_KEY;
    delete process.env.MOONSHOT_API_KEY;
    expect(getProviderChain()).toEqual(["openai"]);
    expect(getPreferredProvider()).toBe("openai");
  });

  it("forces OpenAI-first when ANIMA_LLM_PROVIDER=openai", () => {
    process.env.KIMI_API_KEY = "kimi-test";
    process.env.ANIMA_LLM_PROVIDER = "openai";
    expect(getProviderChain()).toEqual(["openai", "kimi", "xai"]);
    expect(getPreferredProvider()).toBe("openai");
  });

  it("blocks OpenAI when ANIMA_LLM_PROVIDER=xai", () => {
    process.env.KIMI_API_KEY = "kimi-test";
    process.env.ANIMA_LLM_PROVIDER = "xai";
    expect(getConfiguredProviderMode()).toBe("xai");
    expect(isOpenAIBlocked()).toBe(true);
    expect(getProviderChain()).toEqual(["xai", "kimi"]);
    expect(getPreferredProvider()).toBe("xai");
  });

  it("accepts grok as an alias for xai", () => {
    process.env.KIMI_API_KEY = "kimi-test";
    process.env.ANIMA_LLM_PROVIDER = "grok";
    expect(getConfiguredProviderMode()).toBe("xai");
    expect(getProviderChain()[0]).toBe("xai");
  });

  it("ignores ANIMA_LLM_PROVIDER=gemini (retired for chat)", () => {
    delete process.env.KIMI_API_KEY;
    process.env.ANIMA_LLM_PROVIDER = "gemini";
    expect(getConfiguredProviderMode()).toBe("auto");
    expect(getProviderChain()).not.toContain("gemini");
  });

  it("uses Kimi-only when ANIMA_LLM_PROVIDER=kimi", () => {
    process.env.ANIMA_LLM_PROVIDER = "kimi";
    process.env.KIMI_API_KEY = "kimi-test";
    expect(getConfiguredProviderMode()).toBe("kimi");
    expect(isOpenAIBlocked()).toBe(true);
    expect(getProviderChain()).toEqual(["kimi"]);
  });

  it("accepts moonshot as an alias that resolves to Kimi-only", () => {
    process.env.ANIMA_LLM_PROVIDER = "moonshot";
    process.env.MOONSHOT_API_KEY = "moon-test";
    expect(getConfiguredProviderMode()).toBe("kimi");
    expect(getProviderChain()).toEqual(["kimi"]);
  });

  it("treats anima/custom/ensemble as auto chain with brand chip", () => {
    process.env.KIMI_API_KEY = "kimi-test";
    process.env.ANIMA_LLM_PROVIDER = "anima";
    expect(getConfiguredProviderMode()).toBe("auto");
    expect(isAnimaCustomMode()).toBe(true);
    expect(getProviderChain()).toEqual(["kimi", "xai", "openai"]);
    expect(getAnimaTierProviderOrder("standard")).not.toContain("gemini");
  });

  it("blocks OpenAI under auto when ANIMA_DISABLE_OPENAI=true (no Gemini)", () => {
    delete process.env.KIMI_API_KEY;
    process.env.ANIMA_LLM_PROVIDER = "auto";
    process.env.ANIMA_DISABLE_OPENAI = "true";
    expect(isOpenAIBlocked()).toBe(true);
    expect(getProviderChain()).toEqual(["xai"]);
  });

  it("blocks Grok under auto when ANIMA_DISABLE_XAI=true (no Gemini)", () => {
    delete process.env.KIMI_API_KEY;
    process.env.ANIMA_LLM_PROVIDER = "auto";
    process.env.ANIMA_DISABLE_XAI = "true";
    expect(isXaiBlocked()).toBe(true);
    expect(getProviderChain()).toEqual(["openai"]);
  });

  it("routing status reports Kimi-first auto even when Gemini env is set", () => {
    process.env.KIMI_API_KEY = "kimi-test";
    process.env.GEMINI_API_KEY = "gemini-test";
    process.env.ANIMA_LLM_PROVIDER = "gemini";
    const status = getLlmRoutingStatus();
    expect(status.preferred).toBe("kimi");
    expect(status.chain).toEqual(["kimi", "xai", "openai"]);
    expect(status.chain).not.toContain("gemini");
    expect(status.keys.kimi).toBe(true);
    expect(status.keys.gemini).toBe(true);
    expect(status.geminiRetiredForChat).toBe(true);
    expect(status.rawProviderEnv).toBe("gemini");
    expect(status.note).toMatch(/fails over/i);
  });
});

describe("createChatStreamWithFailover", () => {
  const SAVED = { ...process.env };

  beforeEach(() => {
    process.env = { ...SAVED };
    process.env.OPENAI_API_KEY = "sk-test-openai";
    process.env.XAI_API_KEY = "xai-test";
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.KIMI_API_KEY;
    delete process.env.MOONSHOT_API_KEY;
    delete process.env.ANIMA_LLM_PROVIDER;
    delete process.env.ANIMA_DISABLE_OPENAI;
    delete process.env.ANIMA_XAI_MODEL;
    delete process.env.ANIMA_XAI_MODEL_LIGHT;
    delete process.env.ANIMA_XAI_MODEL_STANDARD;
    delete process.env.ANIMA_XAI_MODEL_HEAVY;
    resetLlmFailoverStateForTests();
    createMock.mockReset();
    geminiStreamMock.mockReset();
    geminiCompletionMock.mockReset();
  });

  afterEach(() => {
    process.env = { ...SAVED };
    resetLlmFailoverStateForTests();
  });

  it("works without Kimi when Grok/OpenAI are configured (never Gemini)", async () => {
    process.env.ANIMA_LLM_PROVIDER = "gemini";
    process.env.GEMINI_API_KEY = "gemini-test";
    delete process.env.KIMI_API_KEY;
    createMock.mockResolvedValueOnce(fakeStream("grok"));

    const result = await createChatStreamWithFailover({
      tier: "standard",
      model: "gpt-4o",
      maxTokens: 8192,
      messages: [{ role: "user", content: "hello" }],
    });

    expect(result.provider).toBe("xai");
    expect(geminiStreamMock).not.toHaveBeenCalled();
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("uses Kimi first even when ANIMA_LLM_PROVIDER=gemini and GEMINI_API_KEY are set", async () => {
    process.env.GEMINI_API_KEY = "gemini-test";
    process.env.KIMI_API_KEY = "kimi-test";
    process.env.ANIMA_LLM_PROVIDER = "gemini";
    createMock.mockResolvedValueOnce(fakeStream("kimi"));
    const result = await createChatStreamWithFailover({
      tier: "standard",
      model: "gpt-4o",
      maxTokens: 8192,
      messages: [{ role: "user", content: "hello" }],
    });
    expect(result.provider).toBe("kimi");
    expect(result.model).toBe("kimi-k2.6");
    expect(result.failedOver).toBe(false);
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createMock.mock.calls[0][0].model).toBe("kimi-k2.6");
    expect(geminiStreamMock).not.toHaveBeenCalled();
  });

  it("fails over from exhausted Kimi to Grok (never Gemini)", async () => {
    process.env.KIMI_API_KEY = "kimi-test";
    process.env.GEMINI_API_KEY = "gemini-test";
    process.env.ANIMA_LLM_PROVIDER = "auto";
    createMock
      .mockRejectedValueOnce({
        status: 429,
        message: "quota exhausted",
      })
      .mockResolvedValueOnce(fakeStream("grok-backup"));

    const result = await createChatStreamWithFailover({
      tier: "standard",
      model: "gpt-4o",
      maxTokens: 8192,
      messages: [{ role: "user", content: "hello" }],
    });

    expect(result.provider).toBe("xai");
    expect(result.failedOver).toBe(true);
    expect(result.previousProvider).toBe("kimi");
    expect(isKimiStickySkipped()).toBe(true);
    expect(createMock).toHaveBeenCalledTimes(2);
    expect(geminiStreamMock).not.toHaveBeenCalled();
  });

  it("surfaces a Kimi-only quota error when no backup keys exist", async () => {
    process.env.KIMI_API_KEY = "kimi-test";
    process.env.ANIMA_LLM_PROVIDER = "kimi";
    delete process.env.XAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    createMock.mockRejectedValueOnce({
      status: 429,
      message: "quota exhausted",
    });

    const err = await createChatStreamWithFailover({
      tier: "standard",
      model: "gpt-4o",
      maxTokens: 8192,
      messages: [{ role: "user", content: "hello" }],
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/Kimi \(Moonshot\) credits\/quota exhausted/i);
    expect((err as Error).message).not.toMatch(/tried Gemini/i);
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(geminiStreamMock).not.toHaveBeenCalled();
  });

  it("fails over on rejected Kimi key instead of hard-failing", async () => {
    process.env.KIMI_API_KEY = "kimi-test";
    process.env.ANIMA_LLM_PROVIDER = "auto";
    createMock
      .mockRejectedValueOnce({
        status: 401,
        message: "401 status code (no body)",
      })
      .mockResolvedValueOnce(fakeStream("grok"));

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

  it("Anima custom mode tags brand and uses Kimi-first chain", async () => {
    process.env.ANIMA_LLM_PROVIDER = "anima";
    process.env.GEMINI_API_KEY = "gemini-test";
    process.env.KIMI_API_KEY = "kimi-test";
    createMock.mockResolvedValueOnce(fakeStream("anima-kimi"));

    const result = await createChatStreamWithFailover({
      tier: "standard",
      model: "gpt-4o",
      maxTokens: 8192,
      messages: [{ role: "user", content: "hello" }],
    });

    expect(result.brand).toBe("anima");
    expect(result.provider).toBe("kimi");
    expect(result.model).toBe("kimi-k2.6");
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(geminiStreamMock).not.toHaveBeenCalled();
  });

  it("heavy tier prefers Kimi then can fail over to Grok", async () => {
    process.env.ANIMA_LLM_PROVIDER = "auto";
    process.env.GEMINI_API_KEY = "gemini-test";
    process.env.XAI_API_KEY = "xai-test";
    process.env.KIMI_API_KEY = "kimi-test";
    createMock.mockResolvedValueOnce(fakeStream("anima-kimi-heavy"));

    const result = await createChatStreamWithFailover({
      tier: "heavy",
      model: "gpt-4.1",
      maxTokens: 8192,
      messages: [{ role: "user", content: "why do I feel this way?" }],
    });

    expect(result.provider).toBe("kimi");
    expect(result.model).toBe("kimi-k3");
    expect(geminiStreamMock).not.toHaveBeenCalled();
  });

  it("retries Kimi standard model on model-unavailable before giving up", async () => {
    process.env.KIMI_API_KEY = "kimi-test";
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
      messages: [{ role: "user", content: "hi there friend" }],
    });

    expect(result.provider).toBe("kimi");
    expect(result.model).toBe("kimi-k2.6");
    expect(result.failedOver).toBe(false);
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it("skips sticky-failed Kimi on the next turn", async () => {
    process.env.KIMI_API_KEY = "kimi-test";
    process.env.ANIMA_LLM_PROVIDER = "auto";
    createMock
      .mockRejectedValueOnce({ status: 429, message: "quota exhausted" })
      .mockResolvedValueOnce(fakeStream("grok-1"))
      .mockResolvedValueOnce(fakeStream("grok-2"));

    await createChatStreamWithFailover({
      tier: "standard",
      model: "gpt-4o",
      maxTokens: 8192,
      messages: [{ role: "user", content: "one" }],
    });
    expect(isKimiStickySkipped()).toBe(true);

    const second = await createChatStreamWithFailover({
      tier: "standard",
      model: "gpt-4o",
      maxTokens: 8192,
      messages: [{ role: "user", content: "two" }],
    });
    expect(second.provider).toBe("xai");
    expect(second.failedOver).toBe(false);
    // First turn: kimi fail + grok ok. Second turn: grok only (kimi sticky-skipped).
    expect(createMock).toHaveBeenCalledTimes(3);
  });
});

describe("createChatCompletionWithFailover", () => {
  const SAVED = { ...process.env };

  beforeEach(() => {
    process.env = { ...SAVED };
    process.env.OPENAI_API_KEY = "sk-test-openai";
    process.env.XAI_API_KEY = "xai-test";
    delete process.env.GEMINI_API_KEY;
    delete process.env.KIMI_API_KEY;
    delete process.env.MOONSHOT_API_KEY;
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

  it("uses Grok when Kimi is missing (never Gemini)", async () => {
    process.env.ANIMA_LLM_PROVIDER = "gemini";
    process.env.GEMINI_API_KEY = "AQ.test-key";
    createMock.mockResolvedValueOnce(fakeCompletion("grok reply"));

    const result = await createChatCompletionWithFailover({
      tier: "standard",
      maxTokens: 1024,
      messages: [{ role: "user", content: "make a character" }],
    });

    expect(result.content).toBe("grok reply");
    expect(result.provider).toBe("xai");
    expect(geminiCompletionMock).not.toHaveBeenCalled();
  });

  it("uses Kimi completion even when ANIMA_LLM_PROVIDER=gemini", async () => {
    process.env.ANIMA_LLM_PROVIDER = "gemini";
    process.env.GEMINI_API_KEY = "AQ.test-key";
    process.env.KIMI_API_KEY = "kimi-test";
    createMock.mockResolvedValueOnce(fakeCompletion("kimi reply"));

    const result = await createChatCompletionWithFailover({
      tier: "standard",
      maxTokens: 1024,
      messages: [{ role: "system", content: "You are Serenity." }],
    });

    expect(result.content).toBe("kimi reply");
    expect(result.provider).toBe("kimi");
    expect(geminiCompletionMock).not.toHaveBeenCalled();
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("fails over Kimi completion quota errors to Grok", async () => {
    process.env.KIMI_API_KEY = "kimi-test";
    process.env.ANIMA_LLM_PROVIDER = "auto";
    createMock
      .mockRejectedValueOnce({ status: 429, message: "quota exhausted" })
      .mockResolvedValueOnce(fakeCompletion("grok reply"));

    const result = await createChatCompletionWithFailover({
      tier: "standard",
      maxTokens: 1024,
      messages: [{ role: "user", content: "hi" }],
    });

    expect(result.content).toBe("grok reply");
    expect(result.provider).toBe("xai");
    expect(result.failedOver).toBe(true);
  });
});
