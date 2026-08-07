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
    hasGroqKey: () => Boolean(process.env.GROQ_API_KEY?.trim()),
    hasKimiKey: () =>
      Boolean(process.env.KIMI_API_KEY?.trim() || process.env.MOONSHOT_API_KEY?.trim()),
    hasGatewayAuth: () =>
      Boolean(
        process.env.AI_GATEWAY_API_KEY?.trim() || process.env.VERCEL_OIDC_TOKEN?.trim(),
      ),
    localLlmBaseUrl: () => {
      const explicit =
        process.env.ANIMA_LOCAL_LLM_BASE_URL?.trim() ||
        process.env.VLLM_BASE_URL?.trim();
      if (explicit) return explicit.replace(/\/$/, "");
      const ollama = process.env.OLLAMA_BASE_URL?.trim();
      if (ollama) {
        const root = ollama.replace(/\/$/, "");
        return root.endsWith("/v1") ? root : `${root}/v1`;
      }
      if (process.env.VERCEL || process.env.VERCEL_ENV) return null;
      const mode = (process.env.ANIMA_LLM_PROVIDER || "").trim().toLowerCase();
      const cloudOnly = [
        "auto",
        "gemini",
        "groq",
        "kimi",
        "xai",
        "openai",
        "gateway",
        "ensemble",
      ].includes(mode);
      if (cloudOnly) return null;
      return "http://localhost:11434/v1";
    },
    hasLocalLlm: () => {
      const explicit =
        process.env.ANIMA_LOCAL_LLM_BASE_URL?.trim() ||
        process.env.VLLM_BASE_URL?.trim() ||
        process.env.OLLAMA_BASE_URL?.trim();
      if (explicit) return true;
      if (process.env.VERCEL || process.env.VERCEL_ENV) return false;
      const mode = (process.env.ANIMA_LLM_PROVIDER || "").trim().toLowerCase();
      return ![
        "auto",
        "gemini",
        "groq",
        "kimi",
        "xai",
        "openai",
        "gateway",
        "ensemble",
      ].includes(mode);
    },
    summarizeLocalLlmBaseUrl: () => {
      const explicit =
        process.env.ANIMA_LOCAL_LLM_BASE_URL?.trim() ||
        process.env.VLLM_BASE_URL?.trim();
      let base = explicit?.replace(/\/$/, "") || null;
      if (!base) {
        const ollama = process.env.OLLAMA_BASE_URL?.trim();
        if (ollama) {
          const root = ollama.replace(/\/$/, "");
          base = root.endsWith("/v1") ? root : `${root}/v1`;
        }
      }
      if (!base && !(process.env.VERCEL || process.env.VERCEL_ENV)) {
        const mode = (process.env.ANIMA_LLM_PROVIDER || "").trim().toLowerCase();
        const cloudOnly = [
          "auto",
          "gemini",
          "groq",
          "kimi",
          "xai",
          "openai",
          "gateway",
          "ensemble",
        ].includes(mode);
        if (!cloudOnly) base = "http://localhost:11434/v1";
      }
      if (!base) {
        return {
          configured: false,
          host: null,
          hasV1Path: false,
          isHttps: false,
          isLocalhost: false,
        };
      }
      try {
        const url = new URL(base);
        const host = url.hostname || null;
        const path = (url.pathname || "").replace(/\/$/, "");
        return {
          configured: true,
          host,
          hasV1Path: path === "/v1" || path.endsWith("/v1"),
          isHttps: url.protocol === "https:",
          isLocalhost:
            host === "localhost" || host === "127.0.0.1" || host === "::1",
        };
      } catch {
        return {
          configured: true,
          host: null,
          hasV1Path: /\/v1\/?$/.test(base),
          isHttps: /^https:/i.test(base),
          isLocalhost: /localhost|127\.0\.0\.1/i.test(base),
        };
      }
    },
    logLocalLlmClientInitOnce: () => {},
    getOpenAIClient: () => client,
    getXaiClient: () => (process.env.XAI_API_KEY?.trim() ? client : null),
    getGeminiClient: () =>
      process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim()
        ? client
        : null,
    getGroqClient: () => (process.env.GROQ_API_KEY?.trim() ? client : null),
    getKimiClient: () =>
      process.env.KIMI_API_KEY?.trim() || process.env.MOONSHOT_API_KEY?.trim()
        ? client
        : null,
    getGatewayClient: () =>
      process.env.AI_GATEWAY_API_KEY?.trim() || process.env.VERCEL_OIDC_TOKEN?.trim()
        ? client
        : null,
    getLocalLlmClient: () => {
      const explicit =
        process.env.ANIMA_LOCAL_LLM_BASE_URL?.trim() ||
        process.env.VLLM_BASE_URL?.trim() ||
        process.env.OLLAMA_BASE_URL?.trim();
      if (explicit) return client;
      if (process.env.VERCEL || process.env.VERCEL_ENV) return null;
      const mode = (process.env.ANIMA_LLM_PROVIDER || "").trim().toLowerCase();
      if (
        [
          "auto",
          "gemini",
          "groq",
          "kimi",
          "xai",
          "openai",
          "gateway",
          "ensemble",
        ].includes(mode)
      ) {
        return null;
      }
      return client;
    },
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
  resolveGatewayModel,
  resolveGeminiModel,
  resolveGroqModel,
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

describe("isModelUnavailableError (via Gemini retired-model failover)", () => {
  const SAVED = { ...process.env };

  beforeEach(() => {
    process.env = { ...SAVED };
    process.env.OPENAI_API_KEY = "sk-test-openai";
    process.env.XAI_API_KEY = "xai-test";
    process.env.GEMINI_API_KEY = "gemini-test";
    process.env.KIMI_API_KEY = "kimi-test";
    process.env.AI_GATEWAY_API_KEY = "gateway-test";
    process.env.ANIMA_LLM_PROVIDER = "auto";
    delete process.env.GROQ_API_KEY;
    delete process.env.ANIMA_GEMINI_MODEL;
    delete process.env.ANIMA_GEMINI_MODEL_LIGHT;
    delete process.env.ANIMA_GEMINI_MODEL_STANDARD;
    resetLlmFailoverStateForTests();
    createMock.mockReset();
    geminiStreamMock.mockReset();
  });

  afterEach(() => {
    process.env = { ...SAVED };
    resetLlmFailoverStateForTests();
  });

  it("fails over to Gateway when Gemini model is retired for new users (404)", async () => {
    // Every Gemini candidate (routed + rescue) is unavailable — must NOT abort
    // the chain before Kimi/xAI/OpenAI/Gateway.
    geminiStreamMock.mockRejectedValue({
      status: 404,
      code: "NOT_FOUND",
      message:
        "This model models/gemini-2.5-flash-lite is no longer available to new users. Please update your code to use a newer model",
    });
    createMock
      .mockRejectedValueOnce({ status: 429, message: "kimi quota gone" })
      .mockRejectedValueOnce({ status: 403, message: "xai no credits" })
      .mockRejectedValueOnce({ status: 429, message: "openai quota gone" })
      .mockResolvedValueOnce(fakeStream("gateway-ok"));

    const result = await createChatStreamWithFailover({
      tier: "light",
      model: "gpt-4.1-mini",
      maxTokens: 4096,
      messages: [{ role: "user", content: "hi" }],
    });

    expect(result.provider).toBe("gateway");
    expect(result.failedOver).toBe(true);
    expect(geminiStreamMock.mock.calls.length).toBeGreaterThan(1);
  });

  it("rescues Gemini onto gemini-2.5-flash when light model is blocked", async () => {
    process.env.ANIMA_GEMINI_MODEL_LIGHT = "gemini-2.5-flash-lite";
    geminiStreamMock
      .mockRejectedValueOnce({
        status: 404,
        message:
          "This model models/gemini-2.5-flash-lite is no longer available to new users",
      })
      .mockResolvedValueOnce(fakeStream("flash-ok"));

    const result = await createChatStreamWithFailover({
      tier: "light",
      model: "gpt-4.1-mini",
      maxTokens: 4096,
      messages: [{ role: "user", content: "hi" }],
    });

    expect(result.provider).toBe("gemini");
    expect(result.model).toBe("gemini-2.5-flash");
    expect(createMock).not.toHaveBeenCalled();
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

  it("defaults Gemini / Groq / Kimi / xAI / Gateway models per tier", () => {
    delete process.env.ANIMA_GEMINI_MODEL;
    delete process.env.ANIMA_GROQ_MODEL;
    delete process.env.ANIMA_KIMI_MODEL;
    delete process.env.ANIMA_XAI_MODEL;
    delete process.env.ANIMA_GATEWAY_MODEL;
    expect(resolveGeminiModel("light").model).toBe("gemini-3.1-flash-lite");
    expect(resolveGeminiModel("standard").model).toBe("gemini-2.5-flash");
    expect(resolveGroqModel("light").model).toBe("llama-3.1-8b-instant");
    expect(resolveGroqModel("standard").model).toBe("llama-3.3-70b-versatile");
    expect(resolveKimiModel("standard").model).toBe("kimi-k2.6");
    expect(resolveXaiModel("standard").model).toBe("grok-3");
    expect(resolveGatewayModel("light").model).toBe("google/gemini-3.1-flash-lite");
    expect(resolveGatewayModel("standard").model).toBe("google/gemini-2.5-flash");
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
    process.env.AI_GATEWAY_API_KEY = "gateway-test";
    delete process.env.GROQ_API_KEY;
    delete process.env.ANIMA_LLM_PROVIDER;
    delete process.env.ANIMA_DISABLE_OPENAI;
    delete process.env.ANIMA_DISABLE_XAI;
    delete process.env.ANIMA_DISABLE_GROQ;
    delete process.env.ANIMA_DISABLE_GATEWAY;
    resetLlmFailoverStateForTests();
  });

  afterEach(() => {
    process.env = { ...SAVED };
    resetLlmFailoverStateForTests();
  });

  it("defaults to custom Anima LLM only (no cloud BYOK)", () => {
    delete process.env.ANIMA_LLM_PROVIDER;
    delete process.env.ANIMA_LOCAL_LLM_BASE_URL;
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.VERCEL;
    expect(getConfiguredProviderMode()).toBe("local");
    expect(isAnimaCustomMode()).toBe(true);
    // Dev convenience may expose localhost Ollama; Vercel must set an explicit URL.
    expect(getLlmRoutingStatus().brand).toBe("anima");
    expect(getLlmRoutingStatus().note).toMatch(/custom self-hosted Anima LLM/i);
  });

  it("auto is Gemini-first with AI Gateway last resort when explicitly selected", () => {
    process.env.ANIMA_LLM_PROVIDER = "auto";
    expect(getConfiguredProviderMode()).toBe("auto");
    expect(getProviderChain()).toEqual([
      "gemini",
      "kimi",
      "xai",
      "openai",
      "gateway",
    ]);
    expect(getPreferredProvider()).toBe("gemini");
  });

  it("inserts Groq after Gemini when GROQ_API_KEY is set under auto", () => {
    process.env.ANIMA_LLM_PROVIDER = "auto";
    process.env.GROQ_API_KEY = "gsk-test";
    expect(getProviderChain()).toEqual([
      "gemini",
      "groq",
      "kimi",
      "xai",
      "openai",
      "gateway",
    ]);
    expect(getLlmRoutingStatus().keys.groq).toBe(true);
  });

  it("honors ANIMA_LLM_PROVIDER=gemini as Gemini-only", () => {
    process.env.ANIMA_LLM_PROVIDER = "gemini";
    expect(getConfiguredProviderMode()).toBe("gemini");
    expect(isOpenAIBlocked()).toBe(true);
    expect(isXaiBlocked()).toBe(true);
    expect(getProviderChain()).toEqual(["gemini"]);
  });

  it("uses Groq-only when ANIMA_LLM_PROVIDER=groq", () => {
    process.env.ANIMA_LLM_PROVIDER = "groq";
    process.env.GROQ_API_KEY = "gsk-test";
    expect(getConfiguredProviderMode()).toBe("groq");
    expect(getProviderChain()).toEqual(["groq"]);
    expect(isOpenAIBlocked()).toBe(true);
  });

  it("uses Kimi-only when ANIMA_LLM_PROVIDER=kimi", () => {
    process.env.ANIMA_LLM_PROVIDER = "kimi";
    expect(getProviderChain()).toEqual(["kimi"]);
  });

  it("ignores API-key-like ANIMA_LLM_PROVIDER and stays on custom Anima LLM", () => {
    process.env.ANIMA_LLM_PROVIDER =
      "AQ.Ab8RN6LnPybKM8XuEVGP3i6PPJsaLJel5DeEfows_E_ZuL3_MQ";
    process.env.ANIMA_LOCAL_LLM_BASE_URL = "http://localhost:8000/v1";
    expect(getConfiguredProviderMode()).toBe("local");
    expect(getProviderChain()).toEqual(["local"]);
    expect(isAnimaCustomMode()).toBe(true);
    const status = getLlmRoutingStatus();
    expect(status.rawProviderEnv).toBeNull();
    expect(status.brand).toBe("anima");
    expect(status.note).toMatch(/API key and was ignored/i);
    expect(status.note).toMatch(/custom self-hosted Anima LLM/i);
    expect(status.localEndpoint.configured).toBe(true);
    expect(status.localEndpoint.host).toBe("localhost");
    expect(status.localEndpoint.hasV1Path).toBe(true);
  });

  it("surfaces missing ANIMA_LOCAL_LLM_BASE_URL on Vercel in healthz", () => {
    delete process.env.ANIMA_LLM_PROVIDER;
    delete process.env.ANIMA_LOCAL_LLM_BASE_URL;
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.VLLM_BASE_URL;
    process.env.VERCEL = "1";
    process.env.ANIMA_OLLAMA_MODEL_STANDARD = "anima-chat";
    const status = getLlmRoutingStatus();
    expect(status.status).toBe("error");
    expect(status.mode).toBe("local");
    expect(status.keys.local).toBe(false);
    expect(status.localEndpoint.configured).toBe(false);
    expect(status.localEndpoint.model).toBe("anima-chat");
    expect(status.note).toMatch(/Anima custom LLM is selected/i);
    expect(status.note).toMatch(/ANIMA_LOCAL_LLM_BASE_URL/i);
  });

  it("auto without Gemini uses Groq → Kimi → Grok → OpenAI → Gateway", () => {
    process.env.ANIMA_LLM_PROVIDER = "auto";
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    process.env.GROQ_API_KEY = "gsk-test";
    expect(getProviderChain()).toEqual([
      "groq",
      "kimi",
      "xai",
      "openai",
      "gateway",
    ]);
  });

  it("uses gateway-only when ANIMA_LLM_PROVIDER=gateway", () => {
    process.env.ANIMA_LLM_PROVIDER = "gateway";
    expect(getConfiguredProviderMode()).toBe("gateway");
    expect(getProviderChain()).toEqual(["gateway"]);
  });

  it("treats custom/anima as self-hosted Anima LLM (no cloud BYOK)", () => {
    process.env.ANIMA_LOCAL_LLM_BASE_URL = "http://localhost:8000/v1";
    for (const mode of ["custom", "anima"] as const) {
      process.env.ANIMA_LLM_PROVIDER = mode;
      expect(getConfiguredProviderMode()).toBe("local");
      expect(isAnimaCustomMode()).toBe(true);
      expect(getProviderChain()).toEqual(["local"]);
      expect(isOpenAIBlocked()).toBe(true);
      expect(getLlmRoutingStatus().brand).toBe("anima");
      expect(getLlmRoutingStatus().note).toMatch(/self-hosted Anima LLM/i);
    }
  });

  it("uses local-only when ANIMA_LLM_PROVIDER=local", () => {
    process.env.ANIMA_LLM_PROVIDER = "local";
    process.env.ANIMA_LOCAL_LLM_BASE_URL = "http://localhost:8000/v1";
    expect(getConfiguredProviderMode()).toBe("local");
    expect(getProviderChain()).toEqual(["local"]);
    expect(isOpenAIBlocked()).toBe(true);
    expect(isAnimaCustomMode()).toBe(true);
  });

  it("uses local-first hybrid chain when ANIMA_LLM_PROVIDER=local-first", () => {
    process.env.ANIMA_LLM_PROVIDER = "local-first";
    process.env.ANIMA_LOCAL_LLM_BASE_URL = "http://localhost:8000/v1";
    expect(getConfiguredProviderMode()).toBe("local-first");
    expect(getProviderChain()).toEqual([
      "local",
      "gemini",
      "kimi",
      "xai",
      "openai",
      "gateway",
    ]);
    expect(getLlmRoutingStatus().keys.local).toBe(true);
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
    process.env.AI_GATEWAY_API_KEY = "gateway-test";
    process.env.ANIMA_LLM_PROVIDER = "auto";
    delete process.env.GROQ_API_KEY;
    delete process.env.ANIMA_DISABLE_OPENAI;
    delete process.env.ANIMA_DISABLE_GROQ;
    delete process.env.ANIMA_DISABLE_GATEWAY;
    delete process.env.ANIMA_LOCAL_LLM_BASE_URL;
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

  it("never calls cloud providers in default custom mode", async () => {
    delete process.env.ANIMA_LLM_PROVIDER;
    delete process.env.ANIMA_LOCAL_LLM_BASE_URL;
    delete process.env.OLLAMA_BASE_URL;
    process.env.VERCEL = "1";

    await expect(
      createChatStreamWithFailover({
        tier: "standard",
        model: "gpt-4o",
        maxTokens: 8192,
        messages: [{ role: "user", content: "hello" }],
      }),
    ).rejects.toThrow(/Anima custom LLM is selected/i);

    expect(geminiStreamMock).not.toHaveBeenCalled();
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

  it("fails over from Gemini quota to Groq when GROQ_API_KEY is set", async () => {
    process.env.GROQ_API_KEY = "gsk-test";
    geminiStreamMock.mockRejectedValueOnce({
      status: 429,
      message: "quota exhausted",
    });
    createMock.mockResolvedValueOnce(fakeStream("groq-backup"));

    const result = await createChatStreamWithFailover({
      tier: "standard",
      model: "gpt-4o",
      maxTokens: 8192,
      messages: [{ role: "user", content: "hello" }],
    });

    expect(result.provider).toBe("groq");
    expect(result.failedOver).toBe(true);
    expect(result.previousProvider).toBe("gemini");
    expect(result.model).toBe("llama-3.3-70b-versatile");
    expect(isGeminiStickySkipped()).toBe(true);
  });

  it("fails over from Gemini quota to Kimi when Groq is absent", async () => {
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

  it("revives sticky skips that would hide Gemini/Kimi (avoids OpenAI-only)", () => {
    recordProviderFailure("gemini", { status: 429, message: "quota exhausted" });
    recordProviderFailure("kimi", { status: 429, message: "quota exhausted" });
    recordProviderFailure("xai", {
      status: 403,
      message:
        '403 "Your newly created team doesn\'t have any credits or licenses yet. You can purchase those on https://console.x.ai/team/abc."',
    });

    // Without revive this collapsed to OpenAI-only → "tried OpenAI".
    expect(getProviderChain()).toEqual([
      "gemini",
      "kimi",
      "xai",
      "openai",
      "gateway",
    ]);
    expect(isGeminiStickySkipped()).toBe(false);
  });

  it("fails over to AI Gateway when every BYOK provider is exhausted", async () => {
    geminiStreamMock.mockRejectedValueOnce({
      status: 429,
      message: "quota exhausted",
    });
    createMock
      .mockRejectedValueOnce({ status: 429, message: "quota exhausted" }) // kimi
      .mockRejectedValueOnce({ status: 403, message: "no credits or licenses" }) // xai
      .mockRejectedValueOnce({ status: 429, code: "insufficient_quota" }) // openai
      .mockResolvedValueOnce(fakeStream("gateway-ok")); // gateway

    const result = await createChatStreamWithFailover({
      tier: "standard",
      model: "gpt-4o",
      maxTokens: 8192,
      messages: [{ role: "user", content: "hello" }],
    });

    expect(result.provider).toBe("gateway");
    expect(result.failedOver).toBe(true);
    expect(result.model).toBe("google/gemini-2.5-flash");
  });

  it("includes per-provider details when the whole chain is exhausted", async () => {
    geminiStreamMock.mockRejectedValueOnce({
      status: 429,
      message: "gemini quota gone",
    });
    createMock
      .mockRejectedValueOnce({ status: 429, message: "kimi quota gone" })
      .mockRejectedValueOnce({ status: 403, message: "xai no credits" })
      .mockRejectedValueOnce({ status: 429, message: "openai quota gone" })
      .mockRejectedValueOnce({ status: 402, message: "gateway budget exceeded" });

    await expect(
      createChatStreamWithFailover({
        tier: "standard",
        model: "gpt-4o",
        maxTokens: 8192,
        messages: [{ role: "user", content: "hello" }],
      }),
    ).rejects.toThrow(/Details:.*Gemini:.*Kimi/i);
  });

  it("points exhausted cloud chain at Anima LLM, not at flipping ANIMA_LLM_PROVIDER=auto", async () => {
    geminiStreamMock.mockRejectedValueOnce({
      status: 429,
      message: "gemini quota gone",
    });
    createMock
      .mockRejectedValueOnce({ status: 429, message: "kimi quota gone" })
      .mockRejectedValueOnce({ status: 403, message: "xai no credits" })
      .mockRejectedValueOnce({ status: 429, message: "openai quota gone" })
      .mockRejectedValueOnce({ status: 402, message: "gateway budget exceeded" });

    try {
      await createChatStreamWithFailover({
        tier: "standard",
        model: "gpt-4o",
        maxTokens: 8192,
        messages: [{ role: "user", content: "hello" }],
      });
      expect.unreachable("expected quota exhaustion");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      expect(msg).toMatch(/ANIMA_LLM_PROVIDER=custom/i);
      expect(msg).toMatch(/ANIMA_LOCAL_LLM_BASE_URL/i);
      expect(msg).toMatch(/GROQ_API_KEY/);
      expect(msg).not.toMatch(
        /Set GROQ_API_KEY for Groq\. Or set ANIMA_LLM_PROVIDER=auto/,
      );
    }
  });

  it("starts each chat turn on Gemini even after prior sticky failures", async () => {
    recordProviderFailure("gemini", { status: 429, message: "quota exhausted" });
    recordProviderFailure("kimi", { status: 429, message: "quota exhausted" });
    recordProviderFailure("xai", {
      status: 403,
      message: "no credits or licenses https://console.x.ai/team/abc",
    });
    expect(isGeminiStickySkipped()).toBe(true);

    geminiStreamMock.mockResolvedValueOnce(fakeStream("gemini-again"));
    const result = await createChatStreamWithFailover({
      tier: "standard",
      model: "gpt-4o",
      maxTokens: 8192,
      messages: [{ role: "user", content: "try again" }],
    });

    expect(result.provider).toBe("gemini");
    expect(result.failedOver).toBe(false);
    expect(geminiStreamMock).toHaveBeenCalledTimes(1);
    expect(createMock).not.toHaveBeenCalled();
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
    process.env.AI_GATEWAY_API_KEY = "gateway-test";
    process.env.ANIMA_LLM_PROVIDER = "auto";
    delete process.env.GROQ_API_KEY;
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
