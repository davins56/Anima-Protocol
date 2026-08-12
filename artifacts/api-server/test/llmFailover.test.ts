import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createMock = vi.fn();
const modelsListMock = vi.fn();

vi.mock("../src/lib/openaiClient", () => {
  const client = {
    chat: { completions: { create: (...args: unknown[]) => createMock(...args) } },
    models: { list: (...args: unknown[]) => modelsListMock(...args) },
  };
  const openRouterClient = {
    chat: { completions: { create: (...args: unknown[]) => createMock(...args) } },
    models: { list: (...args: unknown[]) => modelsListMock(...args) },
  };
  return {
    OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
    OPENROUTER_VENICE_UNCENSORED:
      "cognitivecomputations/dolphin-mistral-24b-venice-edition",
    OPENROUTER_FREE_MODEL: "openai/gpt-oss-20b:free",
    hasOpenAIKey: () => Boolean(process.env.OPENAI_API_KEY?.trim()),
    hasOpenRouterKey: () =>
      Boolean(
        process.env.OPENROUTER_API_KEY?.trim() ||
          process.env.ANIMA_OPENROUTER_API_KEY?.trim() ||
          process.env.OPEN_ROUTER_API_KEY?.trim(),
      ),
    getOpenRouterApiKey: () =>
      process.env.OPENROUTER_API_KEY?.trim() ||
      process.env.ANIMA_OPENROUTER_API_KEY?.trim() ||
      process.env.OPEN_ROUTER_API_KEY?.trim() ||
      null,
    getOpenRouterApiKeySource: () =>
      process.env.OPENROUTER_API_KEY?.trim()
        ? "OPENROUTER_API_KEY"
        : process.env.ANIMA_OPENROUTER_API_KEY?.trim()
          ? "ANIMA_OPENROUTER_API_KEY"
          : process.env.OPEN_ROUTER_API_KEY?.trim()
            ? "OPEN_ROUTER_API_KEY"
            : null,
    openRouterKeyFingerprint: () => {
      const key =
        process.env.OPENROUTER_API_KEY?.trim() ||
        process.env.ANIMA_OPENROUTER_API_KEY?.trim() ||
        process.env.OPEN_ROUTER_API_KEY?.trim();
      return key && key.length >= 8 ? key.slice(-4) : null;
    },
    getOpenRouterClient: () => {
      if (
        !(
          process.env.OPENROUTER_API_KEY?.trim() ||
          process.env.ANIMA_OPENROUTER_API_KEY?.trim() ||
          process.env.OPEN_ROUTER_API_KEY?.trim()
        )
      ) {
        return null;
      }
      return openRouterClient;
    },
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
      return "http://localhost:11434/v1";
    },
    hasLocalLlm: () => {
      const explicit =
        process.env.ANIMA_LOCAL_LLM_BASE_URL?.trim() ||
        process.env.VLLM_BASE_URL?.trim() ||
        process.env.OLLAMA_BASE_URL?.trim();
      if (explicit) return true;
      if (process.env.VERCEL || process.env.VERCEL_ENV) return false;
      return true;
    },
    isCloudFlagshipLlmHost: (host: string | null | undefined) => {
      if (!host) return false;
      const h = host.trim().toLowerCase();
      return (
        h === "api.openai.com" ||
        h === "openai.com" ||
        h === "api.groq.com" ||
        h.endsWith(".api.openai.com")
      );
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
        base = "http://localhost:11434/v1";
      }
      if (!base) {
        return {
          configured: false,
          host: null,
          hasV1Path: false,
          isHttps: false,
          isLocalhost: false,
          isCloudFlagship: false,
        };
      }
      try {
        const url = new URL(base);
        const host = url.hostname || null;
        const path = (url.pathname || "").replace(/\/$/, "");
        const isCloudFlagship =
          host === "api.openai.com" ||
          host === "openai.com" ||
          host === "api.groq.com" ||
          Boolean(host?.endsWith(".api.openai.com"));
        return {
          configured: true,
          host,
          hasV1Path: path === "/v1" || path.endsWith("/v1"),
          isHttps: url.protocol === "https:",
          isLocalhost: host === "localhost" || host === "127.0.0.1" || host === "::1",
          isCloudFlagship,
        };
      } catch {
        return {
          configured: true,
          host: null,
          hasV1Path: /\/v1\/?$/.test(base),
          isHttps: /^https:/i.test(base),
          isLocalhost: /localhost|127\.0\.0\.1/i.test(base),
          isCloudFlagship: /api\.openai\.com|api\.groq\.com/i.test(base),
        };
      }
    },
    logLocalLlmClientInitOnce: () => {},
    getOpenAIClient: () => client,
    getLocalLlmClient: () => {
      const explicit =
        process.env.ANIMA_LOCAL_LLM_BASE_URL?.trim() ||
        process.env.VLLM_BASE_URL?.trim() ||
        process.env.OLLAMA_BASE_URL?.trim();
      if (explicit) return client;
      if (process.env.VERCEL || process.env.VERCEL_ENV) return null;
      return client;
    },
    normalizeApiKey: (raw: string | undefined) => (raw ? raw.trim() || null : null),
    localLlmMaxRetries: () => 2,
    resetLlmClientsForTests: () => {},
  };
});

import { resetLocalModelCatalogForTests } from "../src/lib/localModelCatalog";
import {
  createChatCompletionWithFailover,
  createChatStreamWithFailover,
  getLlmRoutingStatus,
  getProviderChain,
  isAnimaCustomMode,
  isProviderAuthError,
  isProviderConnectionError,
  isProviderQuotaError,
  isOpenRouterFreeDailyLimitError,
  LOCAL_LLM_CONNECTION_FIX_HINT,
  probeLlmProviders,
  resetOpenRouterCreditFallbackForTests,
  resolveLocalModel,
  resolveOpenRouterModel,
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

describe("isProviderAuthError", () => {
  it("detects 401 / 403 / invalid API key (including SDK 'no body' message)", () => {
    expect(isProviderAuthError({ status: 401, message: "401 status code (no body)" })).toBe(true);
    expect(isProviderAuthError({ status: 403, message: "403 status code (no body)" })).toBe(true);
    expect(isProviderAuthError({ status: 403 })).toBe(true);
    expect(isProviderAuthError({ status: 429, message: "rate limited" })).toBe(false);
  });

  it("does not throw when code/type/message are non-strings", () => {
    expect(() => isProviderAuthError({ code: 401, type: { nested: true }, message: { raw: true } })).not.toThrow();
    expect(isProviderAuthError({ code: 401, status: 401 })).toBe(true);
    expect(isProviderAuthError({ type: {}, message: {} })).toBe(false);
  });
});

describe("isProviderConnectionError", () => {
  it("detects OpenAI SDK Connection error. (including nested TLS cause)", () => {
    const err = Object.assign(new Error("Connection error."), {
      name: "APIConnectionError",
      cause: Object.assign(new Error("Client network socket disconnected before secure TLS connection was established"), {
        code: "ECONNRESET",
      }),
    });
    expect(isProviderConnectionError(err)).toBe(true);
    expect(isProviderAuthError(err)).toBe(false);
  });

  it("detects undici / DNS connect failures by code", () => {
    expect(isProviderConnectionError({ code: "ECONNREFUSED", message: "connect ECONNREFUSED" })).toBe(true);
    expect(isProviderConnectionError({ code: "ENOTFOUND", message: "getaddrinfo ENOTFOUND" })).toBe(true);
    expect(isProviderConnectionError({ message: "fetch failed" })).toBe(true);
  });

  it("does not treat HTTP auth / quota responses as connection errors", () => {
    expect(isProviderConnectionError({ status: 401, message: "401 status code (no body)" })).toBe(false);
    expect(isProviderConnectionError({ status: 403, message: "403 status code (no body)" })).toBe(false);
    expect(isProviderConnectionError({ status: 429, message: "rate limited" })).toBe(false);
    expect(isProviderConnectionError({ status: 500, message: "internal" })).toBe(false);
  });

  it("does not throw when code/type/message are non-strings", () => {
    expect(() => isProviderConnectionError({ code: -111, type: {}, message: { errno: -111 } })).not.toThrow();
    expect(isProviderConnectionError({ code: -111, type: {} })).toBe(false);
    expect(isProviderConnectionError({ code: "ECONNREFUSED", type: 1 })).toBe(true);
  });
});

describe("isProviderQuotaError", () => {
  it("detects HTTP 429 and rate-limit codes", () => {
    expect(isProviderQuotaError({ status: 429 })).toBe(true);
    expect(isProviderQuotaError({ code: "rate_limit_exceeded" })).toBe(true);
    expect(isProviderQuotaError({ code: "insufficient_quota" })).toBe(true);
    expect(isProviderQuotaError({ message: "Rate limit reached" })).toBe(true);
    expect(isProviderQuotaError({ status: 500, message: "internal" })).toBe(false);
  });

  it("detects OpenRouter HTTP 402 insufficient credits", () => {
    expect(isProviderQuotaError({ status: 402 })).toBe(true);
    expect(
      isProviderQuotaError({
        status: 402,
        message: "402 Insufficient credits. This account never purchased credits.",
      }),
    ).toBe(true);
  });

  it("does not throw when code is a number (OpenAI-compatible servers)", () => {
    expect(() => isProviderQuotaError({ code: 429, type: "rate_limit_error" })).not.toThrow();
    expect(isProviderQuotaError({ code: 429, type: "rate_limit_error" })).toBe(true);
    expect(isProviderQuotaError({ code: 500, type: {} })).toBe(false);
  });
});

describe("isOpenRouterFreeDailyLimitError", () => {
  it("detects OpenRouter's free-models-per-day 429", () => {
    expect(
      isOpenRouterFreeDailyLimitError({
        status: 429,
        message: "Rate limit exceeded: free-models-per-day. Add 10 credits to unlock 1000 free model requests per day.",
      }),
    ).toBe(true);
    expect(isOpenRouterFreeDailyLimitError({ status: 429, message: "rate limited" })).toBe(false);
    expect(isOpenRouterFreeDailyLimitError({ status: 402, message: "Insufficient credits" })).toBe(false);
  });
});

describe("isAnimaCustomMode", () => {
  const SAVED = { ...process.env };
  afterEach(() => {
    process.env = { ...SAVED };
  });

  it("is true when the first provider is the self-hosted Anima LLM", () => {
    process.env.ANIMA_LOCAL_LLM_BASE_URL = "http://localhost:8000/v1";
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.ANIMA_OPENROUTER_API_KEY;
    delete process.env.OPEN_ROUTER_API_KEY;
    expect(isAnimaCustomMode()).toBe(true);
  });

  it("is false when OpenRouter is the only configured provider", () => {
    delete process.env.ANIMA_LOCAL_LLM_BASE_URL;
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.VLLM_BASE_URL;
    process.env.VERCEL = "1";
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    expect(isAnimaCustomMode()).toBe(false);
  });
});

describe("resolveOpenRouterModel", () => {
  const SAVED = { ...process.env };
  afterEach(() => {
    process.env = { ...SAVED };
    resetOpenRouterCreditFallbackForTests();
  });

  it("defaults to Venice Uncensored", () => {
    delete process.env.ANIMA_OPENROUTER_MODEL_STANDARD;
    delete process.env.ANIMA_OPENROUTER_FREE;
    expect(resolveOpenRouterModel("standard").model).toBe(
      "cognitivecomputations/dolphin-mistral-24b-venice-edition",
    );
  });

  it("uses the free model when ANIMA_OPENROUTER_FREE=true", () => {
    process.env.ANIMA_OPENROUTER_FREE = "true";
    delete process.env.ANIMA_OPENROUTER_MODEL_STANDARD;
    expect(resolveOpenRouterModel("standard").model).toBe("openai/gpt-oss-20b:free");
  });
});

describe("getProviderChain", () => {
  const SAVED = { ...process.env };
  afterEach(() => {
    process.env = { ...SAVED };
  });

  it("puts local first then OpenRouter when both are configured", () => {
    process.env.ANIMA_LOCAL_LLM_BASE_URL = "http://localhost:8000/v1";
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    expect(getProviderChain()).toEqual(["local", "openrouter"]);
  });

  it("uses OpenRouter alone on Vercel when local is unset", () => {
    delete process.env.ANIMA_LOCAL_LLM_BASE_URL;
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.VLLM_BASE_URL;
    process.env.VERCEL = "1";
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    expect(getProviderChain()).toEqual(["openrouter"]);
  });
});

describe("resolveLocalModel", () => {
  const SAVED = { ...process.env };
  afterEach(() => {
    process.env = { ...SAVED };
  });

  it("defaults to the ollama registry lineup", () => {
    delete process.env.ANIMA_LOCAL_LLM_BACKEND;
    expect(resolveLocalModel("standard").model).toBeTruthy();
  });

  it("switches to the vLLM lineup when ANIMA_LOCAL_LLM_BACKEND=vllm", () => {
    process.env.ANIMA_LOCAL_LLM_BACKEND = "vllm";
    expect(resolveLocalModel("standard").model).toBeTruthy();
  });
});

describe("getLlmRoutingStatus", () => {
  const SAVED = { ...process.env };

  beforeEach(() => {
    process.env = { ...SAVED };
    resetOpenRouterCreditFallbackForTests();
  });

  afterEach(() => {
    process.env = { ...SAVED };
  });

  it("reports ok with brand anima when a local endpoint is configured", () => {
    process.env.ANIMA_LOCAL_LLM_BASE_URL = "http://localhost:8000/v1";
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.ANIMA_OPENROUTER_API_KEY;
    delete process.env.OPEN_ROUTER_API_KEY;
    const status = getLlmRoutingStatus();
    expect(status.status).toBe("ok");
    expect(status.preferred).toBe("local");
    expect(status.brand).toBe("anima");
    expect(status.chain).toEqual(["local"]);
    expect(status.note).toMatch(/Self-hosted Anima LLM/i);
  });

  it("reports error and a setup hint when no local endpoint or OpenRouter key on Vercel", () => {
    delete process.env.ANIMA_LOCAL_LLM_BASE_URL;
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.VLLM_BASE_URL;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.ANIMA_OPENROUTER_API_KEY;
    delete process.env.OPEN_ROUTER_API_KEY;
    process.env.VERCEL = "1";
    process.env.ANIMA_OLLAMA_MODEL_STANDARD = "anima-chat";
    const status = getLlmRoutingStatus();
    expect(status.status).toBe("error");
    expect(status.preferred).toBeNull();
    expect(status.localEndpoint.configured).toBe(false);
    expect(status.localEndpoint.model).toBe("anima-chat");
    expect(status.note).toMatch(/OPENROUTER_API_KEY|ANIMA_LOCAL_LLM_BASE_URL/i);
  });

  it("reports OpenRouter as preferred when only OPENROUTER_API_KEY is set on Vercel", () => {
    delete process.env.ANIMA_LOCAL_LLM_BASE_URL;
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.VLLM_BASE_URL;
    process.env.VERCEL = "1";
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    const status = getLlmRoutingStatus();
    expect(status.status).toBe("ok");
    expect(status.preferred).toBe("openrouter");
    expect(status.brand).toBe("openrouter");
    expect(status.chain).toEqual(["openrouter"]);
    expect(status.openrouter.configured).toBe(true);
    expect(status.openrouter.model).toMatch(/venice|dolphin|gpt-oss/i);
    expect(status.openrouter.env).toBe("OPENROUTER_API_KEY");
    expect(status.openrouter.keyTail).toBe("test");
    expect(status.openrouter.creditFallback).toBe(false);
  });

  it("reports error when ANIMA_LOCAL_LLM_BASE_URL points at api.openai.com", () => {
    process.env.ANIMA_LOCAL_LLM_BASE_URL = "https://api.openai.com/v1";
    process.env.ANIMA_OLLAMA_MODEL_STANDARD = "anima-chat";
    const status = getLlmRoutingStatus();
    expect(status.status).toBe("error");
    expect(status.preferred).toBeNull();
    expect(status.localEndpoint.configured).toBe(true);
    expect(status.localEndpoint.isCloudFlagship).toBe(true);
    expect(status.localEndpoint.host).toBe("api.openai.com");
    expect(status.note).toMatch(/cloud chat API/i);
    expect(status.note).toMatch(/self-hosted/i);
  });
});

describe("createChatStreamWithFailover", () => {
  const SAVED = { ...process.env };

  beforeEach(() => {
    process.env = { ...SAVED };
    process.env.ANIMA_LOCAL_LLM_BASE_URL = "http://localhost:8000/v1";
    createMock.mockReset();
    modelsListMock.mockReset();
    resetLocalModelCatalogForTests();
    resetOpenRouterCreditFallbackForTests();
  });

  afterEach(() => {
    process.env = { ...SAVED };
  });

  it("streams from the local Anima LLM", async () => {
    createMock.mockResolvedValueOnce(fakeStream("anima"));
    const result = await createChatStreamWithFailover({
      tier: "standard",
      model: "anima-chat",
      maxTokens: 8192,
      messages: [{ role: "user", content: "hello" }],
    });
    expect(result.provider).toBe("local");
    expect(result.brand).toBe("anima");
    expect(result.failedOver).toBe(false);
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("throws a setup error when no local endpoint or OpenRouter key is configured", async () => {
    delete process.env.ANIMA_LOCAL_LLM_BASE_URL;
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.VLLM_BASE_URL;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.ANIMA_OPENROUTER_API_KEY;
    delete process.env.OPEN_ROUTER_API_KEY;
    process.env.VERCEL = "1";

    await expect(
      createChatStreamWithFailover({
        tier: "standard",
        model: "anima-chat",
        maxTokens: 8192,
        messages: [{ role: "user", content: "hello" }],
      }),
    ).rejects.toThrow(/No chat LLM configured|OPENROUTER_API_KEY|ANIMA_LOCAL_LLM_BASE_URL/i);

    expect(createMock).not.toHaveBeenCalled();
  });

  it("streams from OpenRouter Venice Uncensored when only OPENROUTER_API_KEY is set", async () => {
    delete process.env.ANIMA_LOCAL_LLM_BASE_URL;
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.VLLM_BASE_URL;
    process.env.VERCEL = "1";
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    createMock.mockResolvedValueOnce(fakeStream("venice"));

    const result = await createChatStreamWithFailover({
      tier: "standard",
      model: "anima-chat",
      maxTokens: 8192,
      messages: [{ role: "user", content: "hello" }],
    });

    expect(result.provider).toBe("openrouter");
    expect(result.brand).toBe("openrouter");
    expect(result.model).toBe(
      "cognitivecomputations/dolphin-mistral-24b-venice-edition",
    );
    expect(result.failedOver).toBe(false);
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("retries the OpenRouter free model when Venice returns HTTP 402", async () => {
    delete process.env.ANIMA_LOCAL_LLM_BASE_URL;
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.VLLM_BASE_URL;
    delete process.env.ANIMA_OPENROUTER_FREE;
    delete process.env.ANIMA_OPENROUTER_MODEL_STANDARD;
    process.env.VERCEL = "1";
    process.env.OPENROUTER_API_KEY = "sk-or-test-key-abcd";
    createMock
      .mockRejectedValueOnce(
        Object.assign(
          new Error("402 Insufficient credits. This account never purchased credits."),
          { status: 402 },
        ),
      )
      .mockResolvedValueOnce(fakeStream("free"));

    const result = await createChatStreamWithFailover({
      tier: "standard",
      model: "anima-chat",
      maxTokens: 8192,
      messages: [{ role: "user", content: "hello" }],
    });

    expect(result.provider).toBe("openrouter");
    expect(result.model).toBe("openai/gpt-oss-20b:free");
    expect(createMock).toHaveBeenCalledTimes(2);
    expect(createMock.mock.calls[0][0].model).toBe(
      "cognitivecomputations/dolphin-mistral-24b-venice-edition",
    );
    expect(createMock.mock.calls[1][0].model).toBe("openai/gpt-oss-20b:free");
  });

  it("does not retry the free model when Venice already hit free-models-per-day", async () => {
    delete process.env.ANIMA_LOCAL_LLM_BASE_URL;
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.VLLM_BASE_URL;
    delete process.env.ANIMA_OPENROUTER_FREE;
    delete process.env.ANIMA_OPENROUTER_MODEL_STANDARD;
    process.env.VERCEL = "1";
    process.env.OPENROUTER_API_KEY = "sk-or-test-key-abcd";
    createMock.mockRejectedValue(
      Object.assign(
        new Error(
          "Rate limit exceeded: free-models-per-day. Add 10 credits to unlock 1000 free model requests per day.",
        ),
        { status: 429 },
      ),
    );

    try {
      await createChatStreamWithFailover({
        tier: "standard",
        model: "anima-chat",
        maxTokens: 8192,
        messages: [{ role: "user", content: "hello" }],
      });
      throw new Error("expected OpenRouter daily limit to reject");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      expect(message).toMatch(/Today's free OpenRouter messages are used up/i);
      expect(message).toMatch(/openrouter\.ai\/settings\/credits/);
      expect(message).not.toMatch(/ANIMA_OPENROUTER_FREE/);
    }
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("mentions the Fly host when local is down and OpenRouter hits the daily free cap", async () => {
    process.env.ANIMA_LOCAL_LLM_BASE_URL = "https://anima-chat-llm.fly.dev/v1";
    process.env.ANIMA_OLLAMA_MODEL_STANDARD = "anima-chat";
    process.env.OPENROUTER_API_KEY = "sk-or-test-key-abcd";
    delete process.env.ANIMA_OPENROUTER_FREE;
    createMock
      .mockRejectedValueOnce(
        Object.assign(new Error("Connection error."), { name: "APIConnectionError" }),
      )
      .mockRejectedValueOnce(
        Object.assign(
          new Error("Rate limit exceeded: free-models-per-day. Add 10 credits to unlock 1000 free model requests per day."),
          { status: 429 },
        ),
      );

    try {
      await createChatStreamWithFailover({
        tier: "standard",
        model: "anima-chat",
        maxTokens: 8192,
        messages: [{ role: "user", content: "hello" }],
      });
      throw new Error("expected both providers to fail");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      expect(message).toMatch(/Today's free OpenRouter messages are used up/i);
      expect(message).toMatch(/anima-chat-llm\.fly\.dev/);
      expect(message).toMatch(/fly apps restart anima-chat-llm/);
      expect(message).not.toMatch(/ANIMA_OPENROUTER_FREE/);
    }
  });

  it("does not tell the operator to set OPENROUTER_API_KEY when a 402 happens on the free model", async () => {
    delete process.env.ANIMA_LOCAL_LLM_BASE_URL;
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.VLLM_BASE_URL;
    process.env.VERCEL = "1";
    process.env.OPENROUTER_API_KEY = "sk-or-test-key-abcd";
    process.env.ANIMA_OPENROUTER_FREE = "true";
    createMock.mockRejectedValue(
      Object.assign(
        new Error("402 Insufficient credits. This account never purchased credits."),
        { status: 402 },
      ),
    );

    try {
      await createChatStreamWithFailover({
        tier: "standard",
        model: "anima-chat",
        maxTokens: 8192,
        messages: [{ role: "user", content: "hello" }],
      });
      throw new Error("expected OpenRouter 402 to reject");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      expect(message).toMatch(/Your OPENROUTER_API_KEY is configured/);
      expect(message).not.toMatch(/Set OPENROUTER_API_KEY/);
    }
  });

  it("fails over to OpenRouter when local fails", async () => {
    process.env.ANIMA_LOCAL_LLM_BASE_URL = "http://localhost:8000/v1";
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    createMock
      .mockRejectedValueOnce(Object.assign(new Error("Connection error."), { name: "APIConnectionError" }))
      .mockResolvedValueOnce(fakeStream("venice"));

    const result = await createChatStreamWithFailover({
      tier: "standard",
      model: "anima-chat",
      maxTokens: 8192,
      messages: [{ role: "user", content: "hello" }],
    });

    expect(result.provider).toBe("openrouter");
    expect(result.failedOver).toBe(true);
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it("throws a clear setup error when base URL is api.openai.com (not a self-hosted LLM)", async () => {
    process.env.ANIMA_LOCAL_LLM_BASE_URL = "https://api.openai.com/v1";
    process.env.ANIMA_OLLAMA_MODEL_STANDARD = "anima-chat";

    await expect(
      createChatStreamWithFailover({
        tier: "standard",
        model: "anima-chat",
        maxTokens: 8192,
        messages: [{ role: "user", content: "hello" }],
      }),
    ).rejects.toThrow(/cloud chat API/i);

    expect(createMock).not.toHaveBeenCalled();
  });

  it("retries the standard-tier model on model-unavailable before giving up", async () => {
    // Distinct tags per tier so the rescue chain has more than one candidate
    // (the default single-model ollama lineup collapses all tiers to one tag).
    process.env.ANIMA_OLLAMA_MODEL_HEAVY = "anima-heavy";
    process.env.ANIMA_OLLAMA_MODEL_STANDARD = "anima-chat";
    createMock
      .mockRejectedValueOnce({ status: 404, code: "model_not_found", message: "The model does not exist" })
      .mockResolvedValueOnce(fakeStream("standard"));

    const result = await createChatStreamWithFailover({
      tier: "heavy",
      model: "anima-heavy",
      maxTokens: 8192,
      messages: [{ role: "user", content: "hi" }],
    });

    expect(result.provider).toBe("local");
    expect(result.model).toBe("anima-chat");
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it("falls back to a model the endpoint actually serves when the configured tag is missing", async () => {
    // The real-world failure: every tier resolves to `anima-chat`, but the
    // host only ever had the base weights pulled — `ollama create` was never
    // run — so the configured tag 404s on every single turn.
    createMock
      .mockRejectedValueOnce({
        status: 404,
        message: "The model `anima-chat` does not exist or you do not have access to it.",
      })
      .mockResolvedValueOnce(fakeStream("recovered"));
    modelsListMock.mockResolvedValueOnce({
      data: [{ id: "nomic-embed-text:latest" }, { id: "qwen2.5:3b" }],
    });

    const result = await createChatStreamWithFailover({
      tier: "standard",
      model: "anima-chat",
      maxTokens: 8192,
      messages: [{ role: "user", content: "hi" }],
    });

    expect(result.model).toBe("qwen2.5:3b");
    expect(modelsListMock).toHaveBeenCalledTimes(1);
    expect(createMock).toHaveBeenNthCalledWith(2, expect.objectContaining({ model: "qwen2.5:3b" }));
  });

  it("reuses the discovered model on later turns instead of re-earning the 404", async () => {
    createMock
      .mockRejectedValueOnce({ status: 404, message: "model `anima-chat` does not exist" })
      .mockResolvedValueOnce(fakeStream("first"))
      .mockResolvedValueOnce(fakeStream("second"));
    modelsListMock.mockResolvedValueOnce({ data: [{ id: "qwen2.5:3b" }] });

    const req = {
      tier: "standard" as const,
      model: "anima-chat",
      maxTokens: 8192,
      messages: [{ role: "user", content: "hi" }],
    };
    await createChatStreamWithFailover(req);
    const second = await createChatStreamWithFailover(req);

    expect(second.model).toBe("qwen2.5:3b");
    // Three calls total, not four: the second turn skipped the dead tag.
    expect(createMock).toHaveBeenCalledTimes(3);
    expect(createMock).toHaveBeenNthCalledWith(3, expect.objectContaining({ model: "qwen2.5:3b" }));
    // And discovery was not repeated either.
    expect(modelsListMock).toHaveBeenCalledTimes(1);
  });

  it("never substitutes an embedding model for chat", async () => {
    createMock.mockRejectedValue({ status: 404, message: "model `anima-chat` does not exist" });
    modelsListMock.mockResolvedValueOnce({
      data: [{ id: "nomic-embed-text:latest" }, { id: "bge-large" }],
    });

    await expect(
      createChatStreamWithFailover({
        tier: "standard",
        model: "anima-chat",
        maxTokens: 8192,
        messages: [{ role: "user", content: "hi" }],
      }),
    ).rejects.toThrow(/does not serve a model named "anima-chat"/i);

    // Only the configured tag was tried — no embedding model was ever called.
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("explains the mismatch with the host's real lineup when nothing works", async () => {
    createMock.mockRejectedValue({ status: 404, message: "model not found" });
    modelsListMock.mockResolvedValueOnce({ data: [{ id: "llama3.2:1b" }] });
    createMock.mockRejectedValue({ status: 404, message: "model not found" });

    await expect(
      createChatStreamWithFailover({
        tier: "standard",
        model: "anima-chat",
        maxTokens: 8192,
        messages: [{ role: "user", content: "hi" }],
      }),
    ).rejects.toThrow(/llama3\.2:1b/);
  });

  it("still fails clearly when the endpoint lists no models at all", async () => {
    createMock.mockRejectedValue({ status: 404, message: "model `anima-chat` does not exist" });
    modelsListMock.mockRejectedValueOnce(new Error("404 page not found"));

    await expect(
      createChatStreamWithFailover({
        tier: "standard",
        model: "anima-chat",
        maxTokens: 8192,
        messages: [{ role: "user", content: "hi" }],
      }),
    ).rejects.toThrow(/reported no models at all/i);
  });

  it("does not retry on a quota/rate-limit error — surfaces it immediately", async () => {
    createMock.mockRejectedValueOnce({ status: 429, message: "rate limited" });

    await expect(
      createChatStreamWithFailover({
        tier: "standard",
        model: "anima-chat",
        maxTokens: 8192,
        messages: [{ role: "user", content: "hi" }],
      }),
    ).rejects.toBeTruthy();

    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("names the LLM host when the OpenAI SDK only says Connection error.", async () => {
    process.env.ANIMA_LOCAL_LLM_BASE_URL = "https://anima-chat-llm.fly.dev/v1";
    process.env.ANIMA_OLLAMA_MODEL_STANDARD = "anima-chat";
    const sdkErr = Object.assign(new Error("Connection error."), {
      name: "APIConnectionError",
      cause: Object.assign(new Error("SSL_ERROR_SYSCALL"), { code: "ECONNRESET" }),
    });
    createMock.mockRejectedValueOnce(sdkErr);

    let thrown: unknown;
    try {
      await createChatStreamWithFailover({
        tier: "standard",
        model: "anima-chat",
        maxTokens: 8192,
        messages: [{ role: "user", content: "hi" }],
      });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    expect(message).toMatch(
      /Anima LLM connection failed for host=anima-chat-llm\.fly\.dev model=anima-chat/i,
    );
    expect(message).toMatch(/Connection error/i);
    expect(message).toMatch(/SSL_ERROR_SYSCALL|ECONNRESET/i);
    expect(message).toMatch(/fly status -a anima-chat-llm/i);
  });
});

describe("createChatCompletionWithFailover", () => {
  const SAVED = { ...process.env };

  beforeEach(() => {
    process.env = { ...SAVED };
    process.env.ANIMA_LOCAL_LLM_BASE_URL = "http://localhost:8000/v1";
    createMock.mockReset();
    modelsListMock.mockReset();
    resetLocalModelCatalogForTests();
    resetOpenRouterCreditFallbackForTests();
  });

  afterEach(() => {
    process.env = { ...SAVED };
  });

  it("returns a completion from the local Anima LLM", async () => {
    createMock.mockResolvedValueOnce(fakeCompletion("anima reply"));
    const result = await createChatCompletionWithFailover({
      tier: "standard",
      maxTokens: 1024,
      messages: [{ role: "system", content: "You are Serenity." }],
    });
    expect(result.content).toBe("anima reply");
    expect(result.provider).toBe("local");
    expect(result.brand).toBe("anima");
  });
});

describe("probeLlmProviders", () => {
  const SAVED = { ...process.env };

  beforeEach(() => {
    process.env = { ...SAVED };
    createMock.mockReset();
    modelsListMock.mockReset();
    resetLocalModelCatalogForTests();
    resetOpenRouterCreditFallbackForTests();
  });

  afterEach(() => {
    process.env = { ...SAVED };
  });

  it("reports not configured when there is no local endpoint", async () => {
    delete process.env.ANIMA_LOCAL_LLM_BASE_URL;
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.VLLM_BASE_URL;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.ANIMA_OPENROUTER_API_KEY;
    delete process.env.OPEN_ROUTER_API_KEY;
    process.env.VERCEL = "1";
    const probes = await probeLlmProviders();
    expect(probes).toHaveLength(2);
    expect(probes[0]).toMatchObject({ provider: "local", configured: false, ok: false });
    expect(probes[1]).toMatchObject({ provider: "openrouter", configured: false, ok: false });
    expect(probes[1].message).toMatch(/OPENROUTER_API_KEY/i);
  });

  it("probes the local endpoint with a tiny completion", async () => {
    process.env.ANIMA_LOCAL_LLM_BASE_URL = "http://localhost:8000/v1";
    createMock.mockResolvedValueOnce(fakeCompletion("ok"));
    const probes = await probeLlmProviders();
    expect(probes).toHaveLength(1);
    expect(probes[0]).toMatchObject({ provider: "local", configured: true, ok: true });
  });

  it("reports errorKind=connection with host + fix hint when the host is unreachable", async () => {
    process.env.ANIMA_LOCAL_LLM_BASE_URL = "https://anima-chat-llm.fly.dev/v1";
    process.env.ANIMA_OLLAMA_MODEL_STANDARD = "anima-chat";
    createMock.mockRejectedValueOnce(
      Object.assign(new Error("Connection error."), { name: "APIConnectionError" }),
    );
    const probes = await probeLlmProviders();
    expect(probes).toHaveLength(1);
    expect(probes[0]).toMatchObject({
      provider: "local",
      configured: true,
      ok: false,
      errorKind: "connection",
      hint: LOCAL_LLM_CONNECTION_FIX_HINT,
    });
    expect(probes[0]?.message).toMatch(/host=anima-chat-llm\.fly\.dev/i);
    expect(probes[0]?.message).toMatch(/model=anima-chat/i);
  });

  it("probes OpenRouter via the free model when Venice returns HTTP 402", async () => {
    delete process.env.ANIMA_LOCAL_LLM_BASE_URL;
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.VLLM_BASE_URL;
    delete process.env.ANIMA_OPENROUTER_FREE;
    process.env.VERCEL = "1";
    process.env.OPENROUTER_API_KEY = "sk-or-test-key-abcd";
    createMock
      .mockRejectedValueOnce(
        Object.assign(
          new Error("402 Insufficient credits. This account never purchased credits."),
          { status: 402 },
        ),
      )
      .mockResolvedValueOnce(fakeCompletion("ok"));

    const probes = await probeLlmProviders();
    expect(probes).toHaveLength(1);
    expect(probes[0]).toMatchObject({
      provider: "openrouter",
      configured: true,
      ok: true,
      model: "openai/gpt-oss-20b:free",
    });
  });
});
