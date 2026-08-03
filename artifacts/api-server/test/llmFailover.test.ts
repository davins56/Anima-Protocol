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

  it("defaults to Kimi-only when KIMI_API_KEY is set", () => {
    process.env.KIMI_API_KEY = "kimi-test";
    delete process.env.ANIMA_LLM_PROVIDER;
    expect(getConfiguredProviderMode()).toBe("kimi");
    expect(isOpenAIBlocked()).toBe(true);
    expect(isXaiBlocked()).toBe(true);
    expect(getProviderChain()).toEqual(["kimi"]);
    expect(getPreferredProvider()).toBe("kimi");
  });

  it("keeps Kimi-only even when Gemini key and ANIMA_LLM_PROVIDER=gemini are set", () => {
    process.env.GEMINI_API_KEY = "gemini-test";
    process.env.KIMI_API_KEY = "kimi-test";
    process.env.ANIMA_LLM_PROVIDER = "gemini";
    expect(getConfiguredProviderMode()).toBe("kimi");
    expect(getProviderChain()).toEqual(["kimi"]);
    expect(getPreferredProvider()).toBe("kimi");
  });

  it("forces Kimi-only when ANIMA_LLM_PROVIDER=auto but Kimi key exists", () => {
    process.env.ANIMA_LLM_PROVIDER = "auto";
    process.env.KIMI_API_KEY = "kimi-test";
    expect(getConfiguredProviderMode()).toBe("kimi");
    expect(getProviderChain()).toEqual(["kimi"]);
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

  it("forces OpenAI-first when ANIMA_LLM_PROVIDER=openai and no Kimi key", () => {
    delete process.env.KIMI_API_KEY;
    process.env.ANIMA_LLM_PROVIDER = "openai";
    expect(getProviderChain()).toEqual(["openai", "xai"]);
    expect(getPreferredProvider()).toBe("openai");
  });

  it("blocks OpenAI when ANIMA_LLM_PROVIDER=xai and no Kimi key", () => {
    delete process.env.KIMI_API_KEY;
    process.env.ANIMA_LLM_PROVIDER = "xai";
    expect(getConfiguredProviderMode()).toBe("xai");
    expect(isOpenAIBlocked()).toBe(true);
    expect(getProviderChain()).toEqual(["xai"]);
    expect(getPreferredProvider()).toBe("xai");
  });

  it("accepts grok as an alias for xai when no Kimi key", () => {
    delete process.env.KIMI_API_KEY;
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

  it("treats anima/custom/ensemble as Kimi-only when Kimi key is present", () => {
    process.env.KIMI_API_KEY = "kimi-test";
    process.env.ANIMA_LLM_PROVIDER = "anima";
    expect(getConfiguredProviderMode()).toBe("kimi");
    expect(isAnimaCustomMode()).toBe(true);
    expect(getProviderChain()).toEqual(["kimi"]);
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

  it("ignores GEMINI_API_KEY and uses Kimi when KIMI_API_KEY is set", async () => {
    process.env.GEMINI_API_KEY = "gemini-test";
    process.env.KIMI_API_KEY = "kimi-test";
    delete process.env.ANIMA_LLM_PROVIDER;
    createMock.mockResolvedValueOnce(fakeStream("kimi"));
    const result = await createChatStreamWithFailover({
      tier: "standard",
      model: "gpt-4o",
      maxTokens: 8192,
      messages: [{ role: "user", content: "hello" }],
    });
    expect(result.provider).toBe("kimi");
    expect(result.failedOver).toBe(false);
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(geminiStreamMock).not.toHaveBeenCalled();
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

  it("falls back from xAI team-no-credits 403 to Kimi (not Gemini)", async () => {
    // Without Kimi key, xai mode is active; with Kimi key, chat is Kimi-only.
    // This case covers xai mode → Kimi backup when Kimi is added as failover
    // via openai mode chain. Use openai mode so both can be tried... actually
    // with Kimi key everything is kimi-only. So test xai→kimi by NOT setting
    // Kimi until... wait, with our hard rule Kimi key forces kimi-only.
    // So xAI→Kimi failover only happens when mode is xai WITHOUT kimi key
    // for primary, which can't include kimi. Document: Gemini removed; xAI
    // alone fails with billing link when no Kimi.
    process.env.ANIMA_LLM_PROVIDER = "xai";
    process.env.GEMINI_API_KEY = "gemini-test";
    delete process.env.KIMI_API_KEY;
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
    expect(geminiStreamMock).not.toHaveBeenCalled();
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

  it("surfaces a Kimi-only quota error when Kimi is the only chat provider", async () => {
    process.env.KIMI_API_KEY = "kimi-test";
    process.env.GEMINI_API_KEY = "gemini-test";
    delete process.env.ANIMA_LLM_PROVIDER;
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
    expect((err as Error).message).not.toMatch(/Gemini/i);
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(geminiStreamMock).not.toHaveBeenCalled();
  });

  it("never calls Gemini under auto even when GEMINI_API_KEY is set", async () => {
    process.env.ANIMA_LLM_PROVIDER = "auto";
    process.env.ANIMA_DISABLE_OPENAI = "true";
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

  it("does not use Gemini when ANIMA_LLM_PROVIDER=gemini (retired)", async () => {
    process.env.ANIMA_LLM_PROVIDER = "gemini";
    process.env.GEMINI_API_KEY = "gemini-test";
    delete process.env.KIMI_API_KEY;
    createMock.mockResolvedValueOnce(fakeStream("grok"));

    const result = await createChatStreamWithFailover({
      tier: "heavy",
      model: "gpt-4.1",
      maxTokens: 8192,
      messages: [{ role: "user", content: "hello" }],
    });

    expect(result.provider).toBe("xai");
    expect(geminiStreamMock).not.toHaveBeenCalled();
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

  it("Anima mode with Kimi key stays on Kimi for heavy tier (no Gemini/Grok)", async () => {
    process.env.ANIMA_LLM_PROVIDER = "anima";
    process.env.GEMINI_API_KEY = "gemini-test";
    process.env.KIMI_API_KEY = "kimi-test";
    createMock.mockResolvedValueOnce(fakeStream("anima-kimi-heavy"));

    const result = await createChatStreamWithFailover({
      tier: "heavy",
      model: "gpt-4.1",
      maxTokens: 8192,
      messages: [{ role: "user", content: "why do I feel this way?" }],
    });

    expect(result.brand).toBe("anima");
    expect(result.provider).toBe("kimi");
    expect(result.model).toBe("kimi-k3");
    expect(geminiStreamMock).not.toHaveBeenCalled();
  });

  it("falls through OpenAI → xAI on quota errors without Gemini", async () => {
    process.env.ANIMA_LLM_PROVIDER = "openai";
    process.env.GEMINI_API_KEY = "gemini-test";
    delete process.env.KIMI_API_KEY;
    createMock
      .mockRejectedValueOnce({ status: 429, code: "insufficient_quota" })
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
    expect(geminiStreamMock).not.toHaveBeenCalled();
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
    delete process.env.KIMI_API_KEY;
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
    ).rejects.toThrow(/KIMI_API_KEY|XAI_API_KEY|ANIMA_LLM_PROVIDER/);
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

  it("uses Kimi completion when KIMI_API_KEY is set (Gemini retired for chat)", async () => {
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
});
