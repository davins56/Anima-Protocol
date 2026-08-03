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
  getLlmDiagnostics,
  getPreferredProvider,
  getProviderChain,
  isAnimaCustomMode,
  isOpenAIBlocked,
  isXaiBlocked,
  isProviderAuthError,
  extractXaiBillingUrl,
  isProviderUnusableError,
  resetLlmFailoverStateForTests,
  resolveGeminiModel,
  resolveKimiModel,
  resolveXaiModel,
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

  it("defaults per tier and honors env overrides for Gemini", () => {
    delete process.env.ANIMA_GEMINI_MODEL;
    delete process.env.ANIMA_GEMINI_MODEL_LIGHT;
    delete process.env.ANIMA_GEMINI_MODEL_STANDARD;
    delete process.env.ANIMA_GEMINI_MODEL_HEAVY;
    expect(resolveGeminiModel("light").model).toBe("gemini-2.5-flash-lite");
    expect(resolveGeminiModel("standard").model).toBe("gemini-2.5-flash");
    expect(resolveGeminiModel("heavy").model).toBe("gemini-2.5-pro");

    process.env.ANIMA_GEMINI_MODEL_STANDARD = "gemini-3.6-flash";
    expect(resolveGeminiModel("standard").model).toBe("gemini-3.6-flash");
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
    delete process.env.ANIMA_FORCE_GEMINI;
    resetLlmFailoverStateForTests();
  });

  afterEach(() => {
    process.env = { ...SAVED };
    resetLlmFailoverStateForTests();
  });

  it("defaults to Gemini-only when GEMINI_API_KEY is set and provider is unset", () => {
    delete process.env.ANIMA_LLM_PROVIDER;
    expect(getConfiguredProviderMode()).toBe("gemini");
    expect(isOpenAIBlocked()).toBe(true);
    expect(isXaiBlocked()).toBe(true);
    expect(getProviderChain()).toEqual(["gemini"]);
    expect(getPreferredProvider()).toBe("gemini");
  });

  it("defaults to Kimi-only when only KIMI_API_KEY is set", () => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.XAI_API_KEY;
    process.env.KIMI_API_KEY = "kimi-test";
    delete process.env.ANIMA_LLM_PROVIDER;
    expect(getConfiguredProviderMode()).toBe("kimi");
    expect(isOpenAIBlocked()).toBe(true);
    expect(getProviderChain()).toEqual(["kimi"]);
    expect(getPreferredProvider()).toBe("kimi");
  });

  it("prefers Kimi over Gemini when both keys are set and provider is unset", () => {
    process.env.GEMINI_API_KEY = "gemini-test";
    process.env.KIMI_API_KEY = "kimi-test";
    delete process.env.ANIMA_LLM_PROVIDER;
    expect(getConfiguredProviderMode()).toBe("kimi");
    expect(getProviderChain()).toEqual(["kimi"]);
    expect(getPreferredProvider()).toBe("kimi");
  });

  it("auto prefers Kimi/Gemini/Grok over OpenAI when alt keys exist", () => {
    process.env.ANIMA_LLM_PROVIDER = "auto";
    process.env.KIMI_API_KEY = "kimi-test";
    expect(getConfiguredProviderMode()).toBe("auto");
    expect(isOpenAIBlocked()).toBe(false);
    expect(getProviderChain()).toEqual(["kimi", "gemini", "xai", "openai"]);
    expect(getPreferredProvider()).toBe("kimi");
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
    process.env.ANIMA_LLM_PROVIDER = "openai";
    expect(getProviderChain()).toEqual(["openai", "xai", "gemini"]);
    expect(getPreferredProvider()).toBe("openai");
  });

  it("blocks OpenAI when ANIMA_LLM_PROVIDER=xai", () => {
    process.env.ANIMA_LLM_PROVIDER = "xai";
    expect(getConfiguredProviderMode()).toBe("xai");
    expect(isOpenAIBlocked()).toBe(true);
    expect(getProviderChain()).toEqual(["xai", "gemini"]);
    expect(getPreferredProvider()).toBe("xai");
  });

  it("accepts grok as an alias for xai", () => {
    process.env.ANIMA_LLM_PROVIDER = "grok";
    expect(getConfiguredProviderMode()).toBe("xai");
    expect(getProviderChain()[0]).toBe("xai");
  });

  it("uses Gemini-only when ANIMA_LLM_PROVIDER=gemini", () => {
    process.env.ANIMA_LLM_PROVIDER = "gemini";
    expect(isOpenAIBlocked()).toBe(true);
    expect(isXaiBlocked()).toBe(true);
    expect(getProviderChain()).toEqual(["gemini"]);
  });

  it("overrides leftover ANIMA_LLM_PROVIDER=gemini when KIMI_API_KEY is present", () => {
    process.env.ANIMA_LLM_PROVIDER = "gemini";
    process.env.KIMI_API_KEY = "kimi-test";
    expect(getConfiguredProviderMode()).toBe("kimi");
    expect(getProviderChain()).toEqual(["kimi"]);
    expect(getPreferredProvider()).toBe("kimi");
    expect(getLlmDiagnostics().preferred).toBe("kimi");
    expect(getLlmDiagnostics().keys.kimi).toBe(true);
  });

  it("keeps Gemini-only when ANIMA_FORCE_GEMINI=true even if Kimi key exists", () => {
    process.env.ANIMA_LLM_PROVIDER = "gemini";
    process.env.KIMI_API_KEY = "kimi-test";
    process.env.ANIMA_FORCE_GEMINI = "true";
    expect(getConfiguredProviderMode()).toBe("gemini");
    expect(getProviderChain()).toEqual(["gemini"]);
  });

  it("uses Kimi-only when ANIMA_LLM_PROVIDER=kimi", () => {
    process.env.ANIMA_LLM_PROVIDER = "kimi";
    process.env.KIMI_API_KEY = "kimi-test";
    expect(getConfiguredProviderMode()).toBe("kimi");
    expect(isOpenAIBlocked()).toBe(true);
    expect(getProviderChain()).toEqual(["kimi"]);
  });

  it("accepts moonshot as an alias for kimi", () => {
    process.env.ANIMA_LLM_PROVIDER = "moonshot";
    process.env.MOONSHOT_API_KEY = "moon-test";
    expect(getConfiguredProviderMode()).toBe("kimi");
    expect(getProviderChain()).toEqual(["kimi"]);
  });

  it("enables Anima custom multi-model mode with tier-aware routing", () => {
    process.env.ANIMA_LLM_PROVIDER = "anima";
    process.env.KIMI_API_KEY = "kimi-test";
    expect(getConfiguredProviderMode()).toBe("anima");
    expect(isAnimaCustomMode()).toBe(true);
    expect(isOpenAIBlocked()).toBe(false);
    expect(isXaiBlocked()).toBe(false);
    expect(getAnimaTierProviderOrder("light")).toEqual([
      "kimi",
      "gemini",
      "xai",
      "openai",
    ]);
    expect(getAnimaTierProviderOrder("standard")).toEqual([
      "kimi",
      "gemini",
      "xai",
      "openai",
    ]);
    expect(getAnimaTierProviderOrder("heavy")).toEqual([
      "xai",
      "kimi",
      "openai",
      "gemini",
    ]);
    expect(getProviderChain("light")).toEqual(["kimi", "gemini", "xai", "openai"]);
    expect(getProviderChain("standard")).toEqual([
      "kimi",
      "gemini",
      "xai",
      "openai",
    ]);
    expect(getProviderChain("heavy")).toEqual(["xai", "kimi", "openai", "gemini"]);
    expect(getPreferredProvider("standard")).toBe("kimi");
    expect(getPreferredProvider("heavy")).toBe("xai");
  });

  it("Anima mode cannot try Kimi when KIMI_API_KEY is missing (skips to Gemini)", () => {
    process.env.ANIMA_LLM_PROVIDER = "anima";
    delete process.env.KIMI_API_KEY;
    delete process.env.MOONSHOT_API_KEY;
    expect(getProviderChain("standard")).toEqual(["gemini", "xai", "openai"]);
    expect(getPreferredProvider("standard")).toBe("gemini");
  });

  it("accepts custom and ensemble aliases for anima mode", () => {
    process.env.ANIMA_LLM_PROVIDER = "custom";
    expect(getConfiguredProviderMode()).toBe("anima");
    process.env.ANIMA_LLM_PROVIDER = "ensemble";
    expect(getConfiguredProviderMode()).toBe("anima");
  });

  it("blocks OpenAI under auto when ANIMA_DISABLE_OPENAI=true", () => {
    process.env.ANIMA_LLM_PROVIDER = "auto";
    process.env.ANIMA_DISABLE_OPENAI = "true";
    expect(isOpenAIBlocked()).toBe(true);
    expect(getProviderChain()).toEqual(["gemini", "xai"]);
  });

  it("blocks Grok under auto when ANIMA_DISABLE_XAI=true", () => {
    process.env.ANIMA_LLM_PROVIDER = "auto";
    process.env.ANIMA_DISABLE_XAI = "true";
    expect(isXaiBlocked()).toBe(true);
    expect(getProviderChain()).toEqual(["gemini", "openai"]);
  });

  it("auto with Kimi key and OpenAI blocked prefers Kimi then Gemini", () => {
    process.env.ANIMA_LLM_PROVIDER = "auto";
    process.env.ANIMA_DISABLE_OPENAI = "true";
    process.env.KIMI_API_KEY = "kimi-test";
    expect(getProviderChain()).toEqual(["kimi", "gemini", "xai"]);
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

  it("uses Grok under auto when only XAI_API_KEY is set (skips dead OpenAI)", async () => {
    process.env.ANIMA_LLM_PROVIDER = "auto";
    createMock.mockResolvedValueOnce(fakeStream("grok"));
    const result = await createChatStreamWithFailover({
      tier: "standard",
      model: "gpt-4o",
      maxTokens: 8192,
      messages: [{ role: "user", content: "hello" }],
    });
    expect(result.provider).toBe("xai");
    expect(result.model).toBe("grok-3");
    expect(result.failedOver).toBe(false);
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createMock.mock.calls[0][0].model).toBe("grok-3");
  });

  it("uses Gemini by default when GEMINI_API_KEY is set", async () => {
    process.env.GEMINI_API_KEY = "gemini-test";
    delete process.env.ANIMA_LLM_PROVIDER;
    geminiStreamMock.mockResolvedValueOnce(fakeStream("gemini"));
    const result = await createChatStreamWithFailover({
      tier: "standard",
      model: "gpt-4o",
      maxTokens: 8192,
      messages: [{ role: "user", content: "hello" }],
    });
    expect(result.provider).toBe("gemini");
    expect(result.failedOver).toBe(false);
    expect(geminiStreamMock).toHaveBeenCalledTimes(1);
    expect(createMock).not.toHaveBeenCalled();
    expect(geminiStreamMock.mock.calls[0][0].model).toBe("gemini-2.5-flash");
  });

  it("returns OpenAI stream when ANIMA_LLM_PROVIDER=openai", async () => {
    process.env.ANIMA_LLM_PROVIDER = "openai";
    createMock.mockResolvedValueOnce(fakeStream("hi"));
    const result = await createChatStreamWithFailover({
      tier: "standard",
      model: "gpt-4o",
      maxTokens: 8192,
      messages: [{ role: "user", content: "hello" }],
    });
    expect(result.provider).toBe("openai");
    expect(result.model).toBe("gpt-4o");
    expect(result.failedOver).toBe(false);
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to Grok when OpenAI reports no credits", async () => {
    process.env.ANIMA_LLM_PROVIDER = "openai";
    createMock
      .mockRejectedValueOnce({
        status: 429,
        message:
          "429 You have no credits remaining. Add credits to continue using the API at https://platform.openai.com/settings/organization/billing/",
      })
      .mockResolvedValueOnce(fakeStream("grok"));

    const result = await createChatStreamWithFailover({
      tier: "heavy",
      model: "gpt-4.1",
      maxTokens: 8192,
      messages: [{ role: "user", content: "continue" }],
    });

    expect(result.provider).toBe("xai");
    expect(result.model).toBe("grok-4");
    expect(result.failedOver).toBe(true);
    expect(result.previousProvider).toBe("openai");
    expect(createMock).toHaveBeenCalledTimes(2);
    expect(createMock.mock.calls[1][0].model).toBe("grok-4");
  });

  it("falls back from xAI team-no-credits 403 to Gemini", async () => {
    process.env.ANIMA_LLM_PROVIDER = "xai";
    process.env.GEMINI_API_KEY = "gemini-test";
    createMock.mockRejectedValueOnce({
      status: 403,
      message:
        '403 "Your newly created team doesn\'t have any credits or licenses yet. You can purchase those on https://console.x.ai/team/dd82a210-6dbf-46a7-b5cf-c7cdffdd7374."',
    });
    geminiStreamMock.mockResolvedValueOnce(fakeStream("gemini"));

    const result = await createChatStreamWithFailover({
      tier: "standard",
      model: "gpt-4o",
      maxTokens: 8192,
      messages: [{ role: "user", content: "hello" }],
    });

    expect(result.provider).toBe("gemini");
    expect(result.failedOver).toBe(true);
    expect(result.previousProvider).toBe("xai");
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(geminiStreamMock).toHaveBeenCalledTimes(1);
  });

  it("points at the xAI console when Grok has no team credits and no backup", async () => {
    process.env.ANIMA_LLM_PROVIDER = "xai";
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    createMock.mockRejectedValueOnce({
      status: 403,
      message:
        '403 "Your newly created team doesn\'t have any credits or licenses yet. You can purchase those on https://console.x.ai/team/dd82a210-6dbf-46a7-b5cf-c7cdffdd7374."',
    });

    await expect(
      createChatStreamWithFailover({
        tier: "standard",
        model: "gpt-4o",
        maxTokens: 8192,
        messages: [{ role: "user", content: "hello" }],
      }),
    ).rejects.toThrow(/console\.x\.ai\/team\/dd82a210-6dbf-46a7-b5cf-c7cdffdd7374/i);
  });

  it("surfaces a Gemini-only quota error without mentioning Grok when mode is gemini", async () => {
    process.env.ANIMA_LLM_PROVIDER = "gemini";
    process.env.GEMINI_API_KEY = "gemini-test";
    geminiStreamMock.mockRejectedValueOnce({
      status: 429,
      message: "RESOURCE_EXHAUSTED: Quota exceeded",
    });

    const err = await createChatStreamWithFailover({
      tier: "standard",
      model: "gpt-4o",
      maxTokens: 8192,
      messages: [{ role: "user", content: "hello" }],
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/Gemini credits\/quota exhausted/i);
    expect((err as Error).message).not.toMatch(/Grok|console\.x\.ai|ANIMA_LLM_PROVIDER=gemini/i);
    expect(geminiStreamMock).toHaveBeenCalledTimes(1);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("does not suggest ANIMA_LLM_PROVIDER=gemini when Gemini already failed before Grok credits under auto", async () => {
    process.env.ANIMA_LLM_PROVIDER = "auto";
    process.env.ANIMA_DISABLE_OPENAI = "true";
    process.env.GEMINI_API_KEY = "gemini-test";
    geminiStreamMock.mockRejectedValueOnce({
      status: 429,
      message: "RESOURCE_EXHAUSTED: Quota exceeded",
    });
    createMock.mockRejectedValueOnce({
      status: 403,
      message:
        '403 "Your newly created team doesn\'t have any credits or licenses yet. You can purchase those on https://console.x.ai/team/dd82a210-6dbf-46a7-b5cf-c7cdffdd7374."',
    });

    const err = await createChatStreamWithFailover({
      tier: "standard",
      model: "gpt-4o",
      maxTokens: 8192,
      messages: [{ role: "user", content: "hello" }],
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(
      /Gemini was unavailable[\s\S]*console\.x\.ai\/team\/dd82a210-6dbf-46a7-b5cf-c7cdffdd7374/i,
    );
    expect((err as Error).message).not.toMatch(/ANIMA_LLM_PROVIDER=gemini/);
    expect(geminiStreamMock).toHaveBeenCalledTimes(1);
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("skips Grok on later turns after a no-credits failure under auto", async () => {
    process.env.ANIMA_LLM_PROVIDER = "auto";
    process.env.ANIMA_DISABLE_OPENAI = "true";
    process.env.GEMINI_API_KEY = "gemini-test";
    geminiStreamMock
      .mockRejectedValueOnce({
        status: 429,
        message: "RESOURCE_EXHAUSTED: Quota exceeded",
      })
      .mockResolvedValueOnce(fakeStream("gemini-retry"));
    createMock.mockRejectedValueOnce({
      status: 403,
      message:
        '403 "Your newly created team doesn\'t have any credits or licenses yet. You can purchase those on https://console.x.ai/team/dd82a210-6dbf-46a7-b5cf-c7cdffdd7374."',
    });

    await expect(
      createChatStreamWithFailover({
        tier: "standard",
        model: "gpt-4o",
        maxTokens: 8192,
        messages: [{ role: "user", content: "one" }],
      }),
    ).rejects.toThrow(/Gemini was unavailable/i);

    const second = await createChatStreamWithFailover({
      tier: "standard",
      model: "gpt-4o",
      maxTokens: 8192,
      messages: [{ role: "user", content: "two" }],
    });

    expect(second.provider).toBe("gemini");
    expect(second.failedOver).toBe(false);
    // Turn 1: Gemini fail + xAI fail. Turn 2: Gemini only (sticky skip xAI).
    expect(geminiStreamMock).toHaveBeenCalledTimes(2);
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(geminiStreamMock.mock.calls[1][0].model).toBe("gemini-2.5-flash");
  });

  it("falls back to Grok on OpenAI 401 status code (no body)", async () => {
    process.env.ANIMA_LLM_PROVIDER = "openai";
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
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it("surfaces a clear auth error when the forced provider key is rejected", async () => {
    process.env.ANIMA_LLM_PROVIDER = "xai";
    delete process.env.GEMINI_API_KEY;
    createMock.mockRejectedValueOnce({
      status: 401,
      message: "401 status code (no body)",
    });

    await expect(
      createChatStreamWithFailover({
        tier: "standard",
        model: "gpt-4o",
        maxTokens: 8192,
        messages: [{ role: "user", content: "hello" }],
      }),
    ).rejects.toThrow(/XAI_API_KEY|authentication failed/i);
  });

  it("skips OpenAI entirely when ANIMA_LLM_PROVIDER=xai", async () => {
    process.env.ANIMA_LLM_PROVIDER = "xai";
    createMock.mockResolvedValueOnce(fakeStream("grok-direct"));

    const result = await createChatStreamWithFailover({
      tier: "standard",
      model: "gpt-4o",
      maxTokens: 8192,
      messages: [{ role: "user", content: "hello" }],
    });

    expect(result.provider).toBe("xai");
    expect(result.model).toBe("grok-3");
    expect(result.failedOver).toBe(false);
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createMock.mock.calls[0][0].model).toBe("grok-3");
  });

  it("uses Gemini when ANIMA_LLM_PROVIDER=gemini", async () => {
    process.env.ANIMA_LLM_PROVIDER = "gemini";
    process.env.GEMINI_API_KEY = "gemini-test";
    geminiStreamMock.mockResolvedValueOnce(fakeStream("gemini"));

    const result = await createChatStreamWithFailover({
      tier: "heavy",
      model: "gpt-4.1",
      maxTokens: 8192,
      messages: [{ role: "user", content: "hello" }],
    });

    expect(result.provider).toBe("gemini");
    expect(result.model).toBe("gemini-2.5-pro");
    expect(geminiStreamMock).toHaveBeenCalledTimes(1);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("uses Kimi when ANIMA_LLM_PROVIDER=kimi", async () => {
    process.env.ANIMA_LLM_PROVIDER = "kimi";
    process.env.KIMI_API_KEY = "kimi-test";
    createMock.mockResolvedValueOnce(fakeStream("kimi"));

    const result = await createChatStreamWithFailover({
      tier: "standard",
      model: "gpt-4o",
      maxTokens: 8192,
      messages: [{ role: "user", content: "hello" }],
    });

    expect(result.provider).toBe("kimi");
    expect(result.model).toBe("kimi-k2.6");
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createMock.mock.calls[0][0].model).toBe("kimi-k2.6");
  });

  it("Anima custom mode picks Kimi for standard tier and tags brand", async () => {
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

  it("Anima custom mode picks Grok for heavy tier", async () => {
    process.env.ANIMA_LLM_PROVIDER = "anima";
    process.env.GEMINI_API_KEY = "gemini-test";
    process.env.KIMI_API_KEY = "kimi-test";
    createMock.mockResolvedValueOnce(fakeStream("anima-grok"));

    const result = await createChatStreamWithFailover({
      tier: "heavy",
      model: "gpt-4.1",
      maxTokens: 8192,
      messages: [{ role: "user", content: "why do I feel this way?" }],
    });

    expect(result.brand).toBe("anima");
    expect(result.provider).toBe("xai");
    expect(result.model).toBe("grok-4");
  });

  it("Anima custom mode fails over from Kimi to Gemini while keeping brand", async () => {
    process.env.ANIMA_LLM_PROVIDER = "anima";
    process.env.GEMINI_API_KEY = "gemini-test";
    process.env.KIMI_API_KEY = "kimi-test";
    createMock.mockRejectedValueOnce({
      status: 429,
      message: "quota exhausted",
    });
    geminiStreamMock.mockResolvedValueOnce(fakeStream("anima-gemini-backup"));

    const result = await createChatStreamWithFailover({
      tier: "standard",
      model: "gpt-4o",
      maxTokens: 8192,
      messages: [{ role: "user", content: "hello" }],
    });

    expect(result.brand).toBe("anima");
    expect(result.provider).toBe("gemini");
    expect(result.failedOver).toBe(true);
    expect(result.previousProvider).toBe("kimi");
  });

  it("falls through OpenAI → xAI → Gemini on quota errors", async () => {
    process.env.ANIMA_LLM_PROVIDER = "openai";
    process.env.GEMINI_API_KEY = "gemini-test";
    createMock
      .mockRejectedValueOnce({ status: 429, code: "insufficient_quota" })
      .mockRejectedValueOnce({ status: 429, message: "rate limit" });
    geminiStreamMock.mockResolvedValueOnce(fakeStream("gemini"));

    const result = await createChatStreamWithFailover({
      tier: "standard",
      model: "gpt-4o",
      maxTokens: 8192,
      messages: [{ role: "user", content: "hello" }],
    });

    expect(result.provider).toBe("gemini");
    expect(result.failedOver).toBe(true);
    expect(createMock).toHaveBeenCalledTimes(2);
    expect(geminiStreamMock).toHaveBeenCalledTimes(1);
    expect(geminiStreamMock.mock.calls[0][0].model).toBe("gemini-2.5-flash");
  });

  it("retries OpenAI standard model on model-unavailable before giving up", async () => {
    process.env.ANIMA_LLM_PROVIDER = "openai";
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

    expect(result.provider).toBe("openai");
    expect(result.model).toBe("gpt-4o");
    expect(result.failedOver).toBe(false);
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it("prefers xAI on subsequent turns after OpenAI billing failure", async () => {
    process.env.ANIMA_LLM_PROVIDER = "openai";
    createMock
      .mockRejectedValueOnce({ status: 429, code: "insufficient_quota" })
      .mockResolvedValueOnce(fakeStream("grok-1"))
      .mockResolvedValueOnce(fakeStream("grok-2"));

    await createChatStreamWithFailover({
      tier: "standard",
      model: "gpt-4o",
      maxTokens: 8192,
      messages: [{ role: "user", content: "one" }],
    });

    // Clear forced openai so sticky preferNonOpenAI can take effect under auto.
    delete process.env.ANIMA_LLM_PROVIDER;
    const second = await createChatStreamWithFailover({
      tier: "standard",
      model: "gpt-4o",
      maxTokens: 8192,
      messages: [{ role: "user", content: "two" }],
    });

    expect(second.provider).toBe("xai");
    expect(second.failedOver).toBe(false);
    // First turn: OpenAI fail + xAI ok. Second turn: xAI only (sticky / auto).
    expect(createMock).toHaveBeenCalledTimes(3);
    expect(createMock.mock.calls[2][0].model).toBe("grok-3");
  });

  it("surfaces a helpful error when OpenAI is out of credits and no alt key is set", async () => {
    delete process.env.XAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    createMock.mockRejectedValueOnce({
      status: 429,
      message: "429 You have no credits remaining.",
    });

    await expect(
      createChatStreamWithFailover({
        tier: "standard",
        model: "gpt-4o",
        maxTokens: 8192,
        messages: [{ role: "user", content: "hello" }],
      }),
    ).rejects.toThrow(/XAI_API_KEY|GEMINI_API_KEY|ANIMA_LLM_PROVIDER/);
  });
});

describe("createChatCompletionWithFailover", () => {
  const SAVED = { ...process.env };

  beforeEach(() => {
    process.env = { ...SAVED };
    process.env.OPENAI_API_KEY = "sk-test-openai";
    process.env.XAI_API_KEY = "xai-test";
    delete process.env.GEMINI_API_KEY;
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

  it("returns non-streaming content from the preferred provider", async () => {
    process.env.ANIMA_LLM_PROVIDER = "xai";
    createMock.mockResolvedValueOnce(fakeCompletion("companion json"));

    const result = await createChatCompletionWithFailover({
      tier: "standard",
      maxTokens: 1024,
      messages: [{ role: "user", content: "make a character" }],
    });

    expect(result.content).toBe("companion json");
    expect(result.provider).toBe("xai");
    expect(result.model).toBe("grok-3");
  });

  it("uses native Gemini completion when GEMINI_API_KEY is preferred", async () => {
    process.env.ANIMA_LLM_PROVIDER = "gemini";
    process.env.GEMINI_API_KEY = "AQ.test-key";
    geminiCompletionMock.mockResolvedValueOnce(fakeCompletion("native gemini"));

    const result = await createChatCompletionWithFailover({
      tier: "standard",
      maxTokens: 1024,
      messages: [{ role: "system", content: "You are Serenity." }],
    });

    expect(result.content).toBe("native gemini");
    expect(result.provider).toBe("gemini");
    expect(geminiCompletionMock).toHaveBeenCalledTimes(1);
    expect(createMock).not.toHaveBeenCalled();
  });
});
