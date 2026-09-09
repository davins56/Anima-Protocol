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
  const serverlessNoLoopback = () =>
    Boolean(
      process.env.ANIMA_RUNTIME === "worker" ||
        process.env.ANIMA_RUNTIME === "cloudrun" ||
        process.env.ANIMA_RUNTIME === "cloud-run" ||
        process.env.ANIMA_RUNTIME === "gcp" ||
        process.env.VERCEL ||
        process.env.VERCEL_ENV ||
        process.env.CF_PAGES ||
        process.env.K_SERVICE ||
        process.env.CLOUD_RUN_JOB,
    );
  return {
    OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
    OPENROUTER_VENICE_UNCENSORED:
      "cognitivecomputations/dolphin-mistral-24b-venice-edition",
    OPENROUTER_FREE_MODEL: "minimax/minimax-m2.7:free",
    OPENROUTER_FREE_M3_MODEL: "minimax/minimax-m3:free",
    OPENROUTER_FREE_M27_MODEL: "minimax/minimax-m2.7:free",
    OPENROUTER_FREE_GEMMA4_26B_MODEL: "google/gemma-4-26b-a4b-it:free",
    OPENROUTER_FREE_GEMMA4_31B_MODEL: "google/gemma-4-31b-it:free",
    MINIMAX_FREE_MODEL: "minimax/minimax-m3:free",
    OPENROUTER_FREE_MODEL_CANDIDATES: [
      "minimax/minimax-m2.7:free",
      "minimax/minimax-m3:free",
      "google/gemma-4-26b-a4b-it:free",
      "google/gemma-4-31b-it:free",
    ],
    MINIMAX_DEFAULT_MODEL: "MiniMax-M2.7",
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
    hasMinimaxKey: () =>
      Boolean(process.env.MINIMAX_API_KEY?.trim() || process.env.ANIMA_MINIMAX_API_KEY?.trim()),
    hasDeepshiKey: () =>
      Boolean(process.env.DEEPSHI_API_KEY?.trim() || process.env.ANIMA_DEEPSHI_API_KEY?.trim()),
    getDeepshiApiKeySource: () =>
      process.env.DEEPSHI_API_KEY?.trim()
        ? "DEEPSHI_API_KEY"
        : process.env.ANIMA_DEEPSHI_API_KEY?.trim()
          ? "ANIMA_DEEPSHI_API_KEY"
          : null,
    getDeepshiClient: () => {
      if (!(process.env.DEEPSHI_API_KEY?.trim() || process.env.ANIMA_DEEPSHI_API_KEY?.trim())) {
        return null;
      }
      return openRouterClient;
    },
    DEEPSHI_DEFAULT_MODEL: "deepshi-3.0",
    getMinimaxApiKeySource: () =>
      process.env.MINIMAX_API_KEY?.trim()
        ? "MINIMAX_API_KEY"
        : process.env.ANIMA_MINIMAX_API_KEY?.trim()
          ? "ANIMA_MINIMAX_API_KEY"
          : null,
    getMinimaxClient: () => {
      if (!(process.env.MINIMAX_API_KEY?.trim() || process.env.ANIMA_MINIMAX_API_KEY?.trim())) {
        return null;
      }
      return openRouterClient;
    },
    isLoopbackUnreachableRuntime: () => serverlessNoLoopback(),
    isCloudRunRuntime: () =>
      Boolean(
        process.env.ANIMA_RUNTIME === "cloudrun" ||
          process.env.ANIMA_RUNTIME === "cloud-run" ||
          process.env.ANIMA_RUNTIME === "gcp" ||
          process.env.K_SERVICE ||
          process.env.CLOUD_RUN_JOB,
      ),
    localLlmBaseUrl: () => {
      const explicit =
        process.env.ANIMA_LOCAL_LLM_BASE_URL?.trim() ||
        process.env.VLLM_BASE_URL?.trim();
      if (explicit) {
        if (
          serverlessNoLoopback() &&
          /localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0/i.test(explicit)
        ) {
          return null;
        }
        return explicit.replace(/\/$/, "");
      }
      const ollama = process.env.OLLAMA_BASE_URL?.trim();
      if (ollama) {
        const root = ollama.replace(/\/$/, "");
        return root.endsWith("/v1") ? root : `${root}/v1`;
      }
      if (serverlessNoLoopback()) {
        return null;
      }
      return "http://localhost:11434/v1";
    },
    hasLocalLlm: () => {
      const explicit =
        process.env.ANIMA_LOCAL_LLM_BASE_URL?.trim() ||
        process.env.VLLM_BASE_URL?.trim() ||
        process.env.OLLAMA_BASE_URL?.trim();
      if (
        explicit &&
        serverlessNoLoopback() &&
        /localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0/i.test(explicit)
      ) {
        return false;
      }
      if (explicit) return true;
      if (serverlessNoLoopback()) {
        return false;
      }
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
      const noLoopback = serverlessNoLoopback();
      const explicitLoopback = Boolean(
        explicit && /localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0/i.test(explicit),
      );
      const loopbackRejected = noLoopback && explicitLoopback;
      if (!base && !noLoopback) {
        base = "http://localhost:11434/v1";
      }
      if (loopbackRejected) {
        try {
          const url = new URL(explicit.replace(/\/$/, ""));
          return {
            configured: false,
            host: url.hostname,
            hasV1Path: true,
            isHttps: url.protocol === "https:",
            isLocalhost: true,
            isCloudFlagship: false,
            isLoopbackMisconfigured: true,
          };
        } catch {
          return {
            configured: false,
            host: "localhost",
            hasV1Path: true,
            isHttps: false,
            isLocalhost: true,
            isCloudFlagship: false,
            isLoopbackMisconfigured: true,
          };
        }
      }
      if (!base) {
        return {
          configured: false,
          host: null,
          hasV1Path: false,
          isHttps: false,
          isLocalhost: false,
          isCloudFlagship: false,
          isLoopbackMisconfigured: false,
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
          isLoopbackMisconfigured: false,
        };
      } catch {
        return {
          configured: true,
          host: null,
          hasV1Path: /\/v1\/?$/.test(base),
          isHttps: /^https:/i.test(base),
          isLocalhost: /localhost|127\.0\.0\.1/i.test(base),
          isCloudFlagship: /api\.openai\.com|api\.groq\.com/i.test(base),
          isLoopbackMisconfigured: false,
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
      const noLoopback = Boolean(
        process.env.ANIMA_RUNTIME === "worker" ||
          process.env.VERCEL ||
          process.env.VERCEL_ENV ||
          process.env.CF_PAGES,
      );
      if (
        explicit &&
        noLoopback &&
        /localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0/i.test(explicit)
      ) {
        return null;
      }
      if (explicit) return client;
      if (noLoopback) return null;
      return client;
    },
    normalizeApiKey: (raw: string | undefined) => (raw ? raw.trim() || null : null),
    localLlmMaxRetries: () => 2,
    openRouterMaxRetries: () => {
      const raw = Number(process.env.ANIMA_OPENROUTER_MAX_RETRIES);
      if (Number.isFinite(raw) && raw >= 0) return Math.floor(raw);
      return 2;
    },
    openRouterCascadeMaxRetries: (remaining: number) => {
      if (remaining > 0) return 0;
      const raw = Number(process.env.ANIMA_OPENROUTER_MAX_RETRIES);
      if (Number.isFinite(raw) && raw >= 0) return Math.floor(raw);
      return 2;
    },
    resetLlmClientsForTests: () => {},
  };
});

import { resetLocalModelCatalogForTests } from "../src/lib/localModelCatalog";
import { resetAiBindingForTests, setAiBinding } from "../src/lib/aiBinding";
import {
  WORKERS_AI_CHAT_MODEL,
  WORKERS_AI_GATEWAY_ID,
  resetWorkersAiQuotaSkipForTests,
} from "../src/lib/workersAi";
import {
  allowOpenRouterFallback,
  createChatCompletionWithFailover,
  createChatStreamWithFailover,
  getLlmRoutingStatus,
  getProviderChain,
  usesFreeTierOpenBudget,
  isAnimaCustomMode,
  isWorkersAiHoppableError,
  isWorkersAiNeuronQuotaError,
  shouldTryNextProvider,
  isProviderAuthError,
  isProviderConnectionError,
  isProviderQuotaError,
  isOpenRouterAlreadyFreeTier,
  isOpenRouterAccountPolicyError,
  isOpenRouterCreditFallback,
  isOpenRouterFreeDailyLimitError,
  isOpenRouterFreeMinuteLimitError,
  isOpenRouterGenericProviderError,
  isOpenRouterModelSpecificClientError,
  isOpenRouterTransientGatewayError,
  isOpenRouterZdrOrDataPolicyError,
  LOCAL_LLM_CONNECTION_FIX_HINT,
  OPENROUTER_FREE_PROVIDER_HINT,
  OPENROUTER_ZDR_PRIVACY_HINT,
  shouldTryNextOpenRouterFreeModel,
  preferCustomLlmOnly,
  preferMinimaxOnly,
  probeLlmProviders,
  remapGenericProviderError,
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

describe("shouldTryNextProvider Workers AI 4006", () => {
  const neuronQuota = {
    code: 4006,
    message: "You have used up your daily free allocation of 10,000 neurons",
  };

  it("detects 4006 / neuron quota / daily free allocation", () => {
    expect(isWorkersAiNeuronQuotaError(neuronQuota)).toBe(true);
    expect(
      isWorkersAiNeuronQuotaError(
        new Error("DeepSeek on Workers AI failed: 4006 daily free allocation exhausted"),
      ),
    ).toBe(true);
    expect(
      isWorkersAiNeuronQuotaError({
        success: false,
        errors: [{ code: 4006, message: "Workers AI neurons exhausted" }],
      }),
    ).toBe(true);
    expect(isWorkersAiNeuronQuotaError({ message: "3006 inference failed" })).toBe(false);
  });

  it("hops from Workers AI to OpenRouter on 4006 when a next provider exists", () => {
    expect(isWorkersAiHoppableError(neuronQuota)).toBe(true);
    expect(shouldTryNextProvider("workersai", neuronQuota, true)).toBe(true);
    expect(shouldTryNextProvider("workersai", neuronQuota, false)).toBe(false);
  });

  it("does not let local auth/quota errors hop even when fallback is configured", () => {
    expect(shouldTryNextProvider("local", { status: 401, message: "401" }, true)).toBe(false);
    expect(shouldTryNextProvider("local", { status: 429, message: "quota" }, true)).toBe(false);
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

  it("detects Workers AI error 4006 (free-plan neurons) as quota", () => {
    expect(isProviderQuotaError({ code: 4006 })).toBe(true);
    expect(
      isProviderQuotaError({
        message:
          "4006: you have used up your daily free allocation of 10,000 neurons, please upgrade to Cloudflare's Workers Paid plan if",
      }),
    ).toBe(true);
    expect(isProviderQuotaError({ message: "3006: inference failed" })).toBe(false);
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
    expect(
      isOpenRouterFreeDailyLimitError({
        status: 429,
        message: "Rate limit exceeded: free-models-per-min.",
      }),
    ).toBe(false);
    expect(isOpenRouterFreeDailyLimitError({ status: 429, message: "rate limited" })).toBe(false);
    expect(isOpenRouterFreeDailyLimitError({ status: 402, message: "Insufficient credits" })).toBe(false);
  });
});

describe("isOpenRouterTransientGatewayError", () => {
  it("detects 502/503/504 and connection failures, not provider 429", () => {
    expect(isOpenRouterTransientGatewayError({ status: 502, message: "Bad Gateway" })).toBe(true);
    expect(isOpenRouterTransientGatewayError({ status: 503, message: "Unavailable" })).toBe(true);
    expect(isOpenRouterTransientGatewayError({ status: 504, message: "Timeout" })).toBe(true);
    expect(
      isOpenRouterTransientGatewayError(
        Object.assign(new Error("Connection error."), { name: "APIConnectionError" }),
      ),
    ).toBe(true);
    expect(isOpenRouterTransientGatewayError({ status: 429, message: "Provider returned error" })).toBe(
      false,
    );
    expect(isOpenRouterTransientGatewayError({ status: 402, message: "Insufficient credits" })).toBe(
      false,
    );
  });
});

const OPENROUTER_ZDR_PRODUCTION_TOAST =
  "404 0 endpoints out of 1 requested are available matching your guardrail restrictions and data policy. We removed them for the following reasons (an endpoint may have matched multiple reasons): ZDR violation (account settings): 1 endpoint excluded; configurable at https://openrouter.ai/settings/privacy";

describe("isOpenRouterZdrOrDataPolicyError", () => {
  it("detects the production ZDR / guardrail / data-policy toast", () => {
    expect(
      isOpenRouterZdrOrDataPolicyError({
        status: 404,
        message: OPENROUTER_ZDR_PRODUCTION_TOAST,
      }),
    ).toBe(true);
    expect(isOpenRouterZdrOrDataPolicyError({ message: "ZDR violation (account settings)" })).toBe(
      true,
    );
    expect(isOpenRouterZdrOrDataPolicyError({ message: "matching your guardrail restrictions" })).toBe(
      true,
    );
    expect(isOpenRouterZdrOrDataPolicyError({ message: "0 endpoints out of 1 requested are available" })).toBe(
      true,
    );
    expect(
      isOpenRouterZdrOrDataPolicyError({
        message: "No endpoints found matching your data policy (Free model publication)",
      }),
    ).toBe(true);
    expect(isOpenRouterZdrOrDataPolicyError({ status: 400, message: "400 Provider returned error" })).toBe(
      false,
    );
    expect(
      isOpenRouterZdrOrDataPolicyError({
        status: 429,
        message: "Rate limit exceeded: free-models-per-day. Add 10 credits.",
      }),
    ).toBe(false);
  });
});

describe("isOpenRouterAccountPolicyError", () => {
  it("detects ZDR / data-policy / free daily-minute caps", () => {
    expect(
      isOpenRouterAccountPolicyError({
        status: 404,
        message: "No endpoints found matching your data policy (Free model publication)",
      }),
    ).toBe(true);
    expect(
      isOpenRouterAccountPolicyError({
        status: 400,
        message: "This request requires ZDR endpoints only",
      }),
    ).toBe(true);
    expect(
      isOpenRouterAccountPolicyError({
        status: 404,
        message: OPENROUTER_ZDR_PRODUCTION_TOAST,
      }),
    ).toBe(true);
    expect(
      isOpenRouterAccountPolicyError({
        status: 429,
        message: "Rate limit exceeded: free-models-per-day. Add 10 credits.",
      }),
    ).toBe(true);
    expect(
      isOpenRouterAccountPolicyError({
        status: 400,
        message: "400 Provider returned error",
      }),
    ).toBe(false);
  });
});

describe("isOpenRouterModelSpecificClientError", () => {
  it("treats provider HTTP 400/404/422 as model-specific, not account policy", () => {
    expect(
      isOpenRouterModelSpecificClientError({
        status: 400,
        message: "400 Provider returned error",
      }),
    ).toBe(true);
    expect(
      isOpenRouterModelSpecificClientError({
        status: 404,
        message: "No endpoints found for minimax/minimax-m3:free",
      }),
    ).toBe(true);
    expect(
      isOpenRouterModelSpecificClientError({
        status: 422,
        message: "Unprocessable Entity",
      }),
    ).toBe(true);
    expect(
      isOpenRouterModelSpecificClientError({
        status: 404,
        message: "No endpoints found matching your data policy (Free model publication)",
      }),
    ).toBe(false);
    expect(
      isOpenRouterModelSpecificClientError({
        status: 401,
        message: "401 Provider returned error",
      }),
    ).toBe(true);
    expect(
      isOpenRouterModelSpecificClientError({
        status: 401,
        message: "User not found. Invalid API key.",
      }),
    ).toBe(false);
  });
});

describe("isOpenRouterGenericProviderError", () => {
  it("detects the opaque OpenRouter wrapper in any casing", () => {
    expect(isOpenRouterGenericProviderError({ status: 400, message: "400 Provider returned error" })).toBe(
      true,
    );
    expect(isOpenRouterGenericProviderError({ message: "400 provider returned error" })).toBe(true);
    expect(isOpenRouterGenericProviderError({ message: "Provider returned error" })).toBe(true);
    expect(isOpenRouterGenericProviderError({ status: 400, message: "context length exceeded" })).toBe(
      false,
    );
  });
});

describe("remapGenericProviderError", () => {
  it("replaces the raw wrapper with the free-tier hint", () => {
    const remapped = remapGenericProviderError(new Error("400 Provider returned error"));
    expect(remapped.message).toBe(OPENROUTER_FREE_PROVIDER_HINT);
    expect(remapped.message).not.toMatch(/Provider returned error/i);
    expect(remapGenericProviderError(new Error("context length exceeded")).message).toBe(
      "context length exceeded",
    );
  });

  it("replaces the raw ZDR dump with the privacy hint", () => {
    const remapped = remapGenericProviderError(new Error(OPENROUTER_ZDR_PRODUCTION_TOAST));
    expect(remapped.message).toBe(OPENROUTER_ZDR_PRIVACY_HINT);
    expect(remapped.message).toMatch(/Zero Data Retention/i);
    expect(remapped.message).toContain("https://openrouter.ai/settings/privacy");
    expect(remapped.message).not.toMatch(/0 endpoints out of/i);
    expect(remapped.message).not.toMatch(/ZDR violation/i);
    expect(remapped.message).not.toMatch(/guardrail restrictions/i);
  });
});

describe("shouldTryNextOpenRouterFreeModel", () => {
  it("failovers a free model on provider 429/5xx but not the daily cap", () => {
    expect(
      shouldTryNextOpenRouterFreeModel(
        { status: 429, message: "429 Provider returned error" },
        "minimax/minimax-m2.7:free",
      ),
    ).toBe(true);
    expect(
      shouldTryNextOpenRouterFreeModel(
        { status: 502, message: "Bad Gateway" },
        "minimax/minimax-m2.7:free",
      ),
    ).toBe(true);
    expect(
      shouldTryNextOpenRouterFreeModel(
        {
          status: 429,
          message: "Rate limit exceeded: free-models-per-day. Add 10 credits.",
        },
        "minimax/minimax-m2.7:free",
      ),
    ).toBe(false);
    expect(
      shouldTryNextOpenRouterFreeModel(
        { status: 429, message: "Rate limit exceeded: free-models-per-min." },
        "minimax/minimax-m2.7:free",
      ),
    ).toBe(false);
  });

  it("failovers a free model on provider HTTP 400 unless it is a policy error", () => {
    expect(
      shouldTryNextOpenRouterFreeModel(
        { status: 400, message: "400 Provider returned error" },
        "minimax/minimax-m3:free",
      ),
    ).toBe(true);
    expect(
      shouldTryNextOpenRouterFreeModel(
        { status: 404, message: "No endpoints found for this model" },
        "minimax/minimax-m3:free",
      ),
    ).toBe(true);
    expect(
      shouldTryNextOpenRouterFreeModel(
        {
          status: 400,
          message: "No endpoints found matching your data policy (Free model publication)",
        },
        "minimax/minimax-m3:free",
      ),
    ).toBe(false);
    expect(
      shouldTryNextOpenRouterFreeModel(
        { status: 400, message: "This organization requires zero data retention" },
        "minimax/minimax-m2.7:free",
      ),
    ).toBe(false);
    expect(
      shouldTryNextOpenRouterFreeModel(
        { status: 404, message: OPENROUTER_ZDR_PRODUCTION_TOAST },
        "minimax/minimax-m2.7:free",
      ),
    ).toBe(false);
  });

  it("still failovers a paid model on credit/quota errors", () => {
    expect(
      shouldTryNextOpenRouterFreeModel(
        { status: 402, message: "Insufficient credits" },
        "cognitivecomputations/dolphin-mistral-24b-venice-edition",
      ),
    ).toBe(true);
    expect(
      shouldTryNextOpenRouterFreeModel(
        { status: 429, message: "Rate limit reached" },
        "cognitivecomputations/dolphin-mistral-24b-venice-edition",
      ),
    ).toBe(true);
    expect(
      shouldTryNextOpenRouterFreeModel(
        { status: 502, message: "Bad Gateway" },
        "cognitivecomputations/dolphin-mistral-24b-venice-edition",
      ),
    ).toBe(false);
    expect(
      shouldTryNextOpenRouterFreeModel(
        { status: 400, message: "400 Provider returned error" },
        "cognitivecomputations/dolphin-mistral-24b-venice-edition",
      ),
    ).toBe(false);
    expect(
      shouldTryNextOpenRouterFreeModel(
        { status: 401, message: "401 Provider returned error" },
        "google/gemma-4-26b-a4b-it:free",
      ),
    ).toBe(true);
  });
});

describe("isOpenRouterAlreadyFreeTier", () => {
  const SAVED = { ...process.env };
  afterEach(() => {
    process.env = { ...SAVED };
    resetOpenRouterCreditFallbackForTests();
  });

  it("is true when ANIMA_OPENROUTER_FREE is set or the model is already :free", () => {
    delete process.env.ANIMA_OPENROUTER_FREE;
    expect(isOpenRouterAlreadyFreeTier("minimax/minimax-m2.7:free")).toBe(true);
    expect(
      isOpenRouterAlreadyFreeTier("cognitivecomputations/dolphin-mistral-24b-venice-edition"),
    ).toBe(false);
    process.env.ANIMA_OPENROUTER_FREE = "true";
    expect(
      isOpenRouterAlreadyFreeTier("cognitivecomputations/dolphin-mistral-24b-venice-edition"),
    ).toBe(true);
  });
});

describe("isOpenRouterFreeMinuteLimitError", () => {
  it("detects OpenRouter's free-models-per-min 429 separately from daily caps", () => {
    expect(
      isOpenRouterFreeMinuteLimitError({
        status: 429,
        message: "Rate limit exceeded: free-models-per-min.",
      }),
    ).toBe(true);
    expect(
      isOpenRouterFreeMinuteLimitError({
        status: 429,
        message: "Rate limit exceeded: free-models-per-day.",
      }),
    ).toBe(false);
  });
});

describe("isAnimaCustomMode", () => {
  const SAVED = { ...process.env };
  afterEach(() => {
    process.env = { ...SAVED };
    resetAiBindingForTests();
  });

  it("is true when the first provider is the self-hosted Anima LLM", () => {
    process.env.ANIMA_LOCAL_LLM_BASE_URL = "http://localhost:8000/v1";
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.ANIMA_OPENROUTER_API_KEY;
    delete process.env.OPEN_ROUTER_API_KEY;
    expect(isAnimaCustomMode()).toBe(true);
  });

  it("stays custom-mode when OpenRouter is the only cloud key (empty chain)", () => {
    delete process.env.ANIMA_LOCAL_LLM_BASE_URL;
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.VLLM_BASE_URL;
    process.env.VERCEL = "1";
    process.env.VERCEL = "1";
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    expect(isAnimaCustomMode()).toBe(true);
  });

  it("stays custom-mode when Workers AI is bound but the Anima LLM URL is set", () => {
    process.env.ANIMA_LOCAL_LLM_BASE_URL = "https://llm.anima-protocol.com/v1";
    setAiBinding({
      run: async () => ({ response: "ok" }),
    });
    expect(isAnimaCustomMode()).toBe(true);
    expect(getProviderChain()).toEqual(["local"]);
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
    delete process.env.ANIMA_OPENROUTER_MODEL_FAMILY;
    expect(resolveOpenRouterModel("standard").model).toBe("minimax/minimax-m2.7:free");
  });

  it("can select a supported OpenRouter family by name", () => {
    process.env.ANIMA_OPENROUTER_MODEL_FAMILY = "deepseek";
    delete process.env.ANIMA_OPENROUTER_MODEL_STANDARD;
    expect(resolveOpenRouterModel("standard").model).toBe("deepseek/deepseek-r1:free");
  });

  it("lets exact OpenRouter model overrides beat family defaults", () => {
    process.env.ANIMA_OPENROUTER_MODEL_FAMILY = "llama";
    process.env.ANIMA_OPENROUTER_MODEL_STANDARD = "custom/provider-model";
    expect(resolveOpenRouterModel("standard").model).toBe("custom/provider-model");
  });
});

describe("getProviderChain", () => {
  const SAVED = { ...process.env };
  afterEach(() => {
    process.env = { ...SAVED };
    resetAiBindingForTests();
  });
  beforeEach(() => {
    process.env = { ...SAVED };
    resetAiBindingForTests();
    delete process.env.MINIMAX_API_KEY;
    delete process.env.ANIMA_MINIMAX_API_KEY;
    delete process.env.DEEPSHI_API_KEY;
    delete process.env.ANIMA_DEEPSHI_API_KEY;
    delete process.env.ANIMA_OPENROUTER_FALLBACK;
  });

  it("uses the custom LLM first and OpenRouter only as a connection hop when fallback is on", () => {
    process.env.ANIMA_LOCAL_LLM_BASE_URL = "http://localhost:8000/v1";
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    process.env.ANIMA_OPENROUTER_FALLBACK = "true";
    delete process.env.ANIMA_LLM_PROVIDER;
    expect(preferCustomLlmOnly()).toBe(true);
    expect(getProviderChain()).toEqual(["local", "openrouter"]);
    expect(getProviderChain()[0]).toBe("local");
    expect(allowOpenRouterFallback()).toBe(true);
  });

  it("keeps local-only when ANIMA_LLM_PROVIDER is unset (durable default)", () => {
    process.env.ANIMA_LOCAL_LLM_BASE_URL = "https://llm.anima-protocol.com/v1";
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    process.env.ANIMA_OPENROUTER_FREE = "true";
    process.env.MINIMAX_API_KEY = "minimax-test";
    delete process.env.ANIMA_LLM_PROVIDER;
    expect(getProviderChain()).toEqual(["local"]);
    expect(preferCustomLlmOnly()).toBe(true);
  });

  it("does not skip a usable local host when ANIMA_LLM_PROVIDER=minimax", () => {
    process.env.ANIMA_LOCAL_LLM_BASE_URL = "https://llm.anima-protocol.com/v1";
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    process.env.ANIMA_LLM_PROVIDER = "minimax";
    process.env.MINIMAX_API_KEY = "minimax-test";
    expect(preferMinimaxOnly()).toBe(true);
    expect(getProviderChain()).toEqual(["local"]);
  });

  it("fails closed when local is unset even if every cloud key is present", () => {
    delete process.env.ANIMA_LOCAL_LLM_BASE_URL;
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.VLLM_BASE_URL;
    process.env.VERCEL = "1";
    delete process.env.ANIMA_LLM_PROVIDER;
    process.env.VERCEL = "1";
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    process.env.MINIMAX_API_KEY = "minimax-test";
    process.env.DEEPSHI_API_KEY = "sk-bf-test";
    process.env.ANIMA_OPENROUTER_FALLBACK = "true";
    process.env.ANIMA_OPENROUTER_FREE = "true";
    expect(getProviderChain()).toEqual([]);
    expect(allowOpenRouterFallback()).toBe(true);
  });

  it("fails closed when ANIMA_LLM_PROVIDER pins MiniMax or Deepshi and local is missing", () => {
    delete process.env.ANIMA_LOCAL_LLM_BASE_URL;
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.VLLM_BASE_URL;
    process.env.VERCEL = "1";
    process.env.VERCEL = "1";
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    process.env.MINIMAX_API_KEY = "minimax-test";
    process.env.DEEPSHI_API_KEY = "sk-bf-test";
    process.env.ANIMA_LLM_PROVIDER = "minimax";
    expect(getProviderChain()).toEqual([]);
    process.env.ANIMA_LLM_PROVIDER = "deepshi";
    expect(getProviderChain()).toEqual([]);
  });

  it("does not use the 80s free-tier open budget for local-only chat", () => {
    process.env.ANIMA_LOCAL_LLM_BASE_URL = "https://llm.anima-protocol.com/v1";
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    process.env.ANIMA_OPENROUTER_FREE = "true";
    expect(getProviderChain()).toEqual(["local"]);
    expect(isOpenRouterAlreadyFreeTier()).toBe(true);
    expect(usesFreeTierOpenBudget()).toBe(false);
  });

  it("prefers the configured Anima LLM over Workers AI", () => {
    process.env.ANIMA_LOCAL_LLM_BASE_URL = "https://llm.anima-protocol.com/v1";
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    setAiBinding({
      run: async () => ({ response: "ok" }),
    });
    expect(getProviderChain()).toEqual(["local"]);
    expect(allowOpenRouterFallback()).toBe(false);
  });

  it("fails closed on Cloud Run even when OpenRouter and MiniMax keys exist", () => {
    process.env.ANIMA_RUNTIME = "cloudrun";
    delete process.env.ANIMA_LOCAL_LLM_BASE_URL;
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.VLLM_BASE_URL;
    process.env.VERCEL = "1";
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    process.env.MINIMAX_API_KEY = "minimax-test";
    expect(getProviderChain()).toEqual([]);
  });

  it("appends OpenRouter after the custom Anima LLM when ANIMA_OPENROUTER_FALLBACK is truthy", () => {
    process.env.ANIMA_LOCAL_LLM_BASE_URL = "https://llm.anima-protocol.com/v1";
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    process.env.ANIMA_OPENROUTER_FALLBACK = "true";
    process.env.ANIMA_OPENROUTER_FREE = "true";
    setAiBinding({
      run: async () => ({ response: "ok" }),
    });
    expect(allowOpenRouterFallback()).toBe(true);
    expect(getProviderChain()).toEqual(["local", "openrouter"]);
    expect(getProviderChain()[0]).toBe("local");
  });

  it("appends OpenRouter after Workers AI when fallback is on and no custom host is set", () => {
    delete process.env.ANIMA_LOCAL_LLM_BASE_URL;
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.VLLM_BASE_URL;
    process.env.VERCEL = "1";
    process.env.VERCEL = "1";
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    process.env.ANIMA_OPENROUTER_FALLBACK = "true";
    process.env.ANIMA_OPENROUTER_FREE = "true";
    setAiBinding({
      run: async () => ({ response: "ok" }),
    });
    expect(getProviderChain()).toEqual(["workersai", "openrouter"]);
    expect(getProviderChain()[0]).toBe("workersai");
  });

  it("accepts 1|true|yes for ANIMA_OPENROUTER_FALLBACK and ignores other values", () => {
    delete process.env.ANIMA_LOCAL_LLM_BASE_URL;
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.VLLM_BASE_URL;
    process.env.VERCEL = "1";
    process.env.VERCEL = "1";
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    setAiBinding({
      run: async () => ({ response: "ok" }),
    });
    for (const value of ["1", "true", "yes", "TRUE", "Yes"]) {
      process.env.ANIMA_OPENROUTER_FALLBACK = value;
      expect(allowOpenRouterFallback()).toBe(true);
      expect(getProviderChain()).toEqual(["workersai", "openrouter"]);
    }
    for (const value of ["false", "0", "no", "off", ""]) {
      process.env.ANIMA_OPENROUTER_FALLBACK = value;
      expect(allowOpenRouterFallback()).toBe(false);
      expect(getProviderChain()).toEqual(["workersai"]);
    }
  });

  it("does not append OpenRouter after Workers AI when the key is missing", () => {
    delete process.env.ANIMA_LOCAL_LLM_BASE_URL;
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.VLLM_BASE_URL;
    process.env.VERCEL = "1";
    process.env.VERCEL = "1";
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.ANIMA_OPENROUTER_API_KEY;
    delete process.env.OPEN_ROUTER_API_KEY;
    process.env.ANIMA_OPENROUTER_FALLBACK = "true";
    setAiBinding({
      run: async () => ({ response: "ok" }),
    });
    expect(allowOpenRouterFallback()).toBe(true);
    expect(getProviderChain()).toEqual(["workersai"]);
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
    resetAiBindingForTests();
    delete process.env.MINIMAX_API_KEY;
    delete process.env.ANIMA_MINIMAX_API_KEY;
    delete process.env.ANIMA_OPENROUTER_FALLBACK;
    resetOpenRouterCreditFallbackForTests();
  });

  afterEach(() => {
    process.env = { ...SAVED };
    resetAiBindingForTests();
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
    expect(status.customOnly).toBe(true);
    expect(status.openRouterFallback).toBe(false);
    expect(status.note).toMatch(/Self-hosted Anima LLM/i);
  });

  it("reports error and a local-only setup hint when no local endpoint is set on Vercel", () => {
    delete process.env.ANIMA_LOCAL_LLM_BASE_URL;
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.VLLM_BASE_URL;
    process.env.VERCEL = "1";
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    process.env.MINIMAX_API_KEY = "minimax-test";
    process.env.VERCEL = "1";
    process.env.ANIMA_OLLAMA_MODEL_STANDARD = "anima-chat";
    const status = getLlmRoutingStatus();
    expect(status.status).toBe("error");
    expect(status.preferred).toBeNull();
    expect(status.customOnly).toBe(true);
    expect(status.chain).toEqual([]);
    expect(status.localEndpoint.configured).toBe(false);
    expect(status.localEndpoint.model).toBe("anima-chat");
    expect(status.note).toMatch(/ANIMA_LLM_PROVIDER=custom/i);
    expect(status.note).toMatch(/ANIMA_LOCAL_LLM_BASE_URL/i);
    expect(status.note).not.toMatch(/Set MINIMAX_API_KEY|OPENROUTER_API_KEY for OpenRouter/i);
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

  it("reports custom-only error instead of OpenRouter when ANIMA_LLM_PROVIDER=custom and local is unset", () => {
    delete process.env.ANIMA_LOCAL_LLM_BASE_URL;
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.VLLM_BASE_URL;
    process.env.VERCEL = "1";
    process.env.VERCEL = "1";
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    process.env.ANIMA_LLM_PROVIDER = "custom";
    const status = getLlmRoutingStatus();
    expect(status.status).toBe("error");
    expect(status.preferred).toBeNull();
    expect(status.customOnly).toBe(true);
    expect(status.chain).toEqual([]);
    expect(status.note).toMatch(/ANIMA_LLM_PROVIDER=custom/i);
    expect(status.note).toMatch(/OpenRouter will not be used/i);
  });

  it("reports the self-hosted Anima LLM as preferred even when Workers AI is bound", () => {
    process.env.ANIMA_LOCAL_LLM_BASE_URL = "https://llm.anima-protocol.com/v1";
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    setAiBinding({
      run: async () => ({ response: "ok" }),
    });
    const status = getLlmRoutingStatus();
    expect(status.status).toBe("ok");
    expect(status.preferred).toBe("local");
    expect(status.brand).toBe("anima");
    expect(status.chain).toEqual(["local"]);
    expect(status.workersai.configured).toBe(true);
    expect(status.openRouterFallback).toBe(false);
    expect(status.note).toMatch(/Self-hosted Anima LLM/i);
    expect(status.note).toMatch(/llm\.anima-protocol\.com/i);
    expect(status.note).not.toMatch(/unused while the Workers AI binding is present/i);
    expect(status.customOnly).toBe(true);
  });

  it("reports openRouterFallback after the custom Anima LLM when fallback is on", () => {
    process.env.ANIMA_LOCAL_LLM_BASE_URL = "https://llm.anima-protocol.com/v1";
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    process.env.ANIMA_OPENROUTER_FALLBACK = "true";
    process.env.ANIMA_OPENROUTER_FREE = "true";
    setAiBinding({
      run: async () => ({ response: "ok" }),
    });
    const status = getLlmRoutingStatus();
    expect(status.status).toBe("ok");
    expect(status.preferred).toBe("local");
    expect(status.brand).toBe("anima");
    expect(status.customOnly).toBe(true);
    expect(status.openRouterFallback).toBe(true);
    expect(status.chain).toEqual(["local", "openrouter"]);
    expect(status.openrouter.isFreeTier).toBe(true);
    expect(status.note).toMatch(/Self-hosted Anima LLM/i);
    expect(status.note).toMatch(/fallback after local connection failure/i);
    expect(status.note).toMatch(/minimax\/minimax-m2\.7:free/i);
  });
});

describe("createChatStreamWithFailover", () => {
  const SAVED = { ...process.env };

  beforeEach(() => {
    process.env = { ...SAVED };
    process.env.ANIMA_LOCAL_LLM_BASE_URL = "http://localhost:8000/v1";
    delete process.env.MINIMAX_API_KEY;
    delete process.env.ANIMA_MINIMAX_API_KEY;
    delete process.env.ANIMA_OPENROUTER_FALLBACK;
    createMock.mockReset();
    modelsListMock.mockReset();
    resetLocalModelCatalogForTests();
    resetOpenRouterCreditFallbackForTests();
    resetAiBindingForTests();
    resetWorkersAiQuotaSkipForTests();
  });

  afterEach(() => {
    process.env = { ...SAVED };
    resetAiBindingForTests();
    resetWorkersAiQuotaSkipForTests();
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

  it("forwards sampling temperature on the local stream", async () => {
    createMock.mockResolvedValueOnce(fakeStream("anima"));
    await createChatStreamWithFailover({
      tier: "standard",
      model: "anima-chat",
      maxTokens: 8192,
      temperature: 0.85,
      messages: [{ role: "user", content: "hello" }],
    });
    expect(createMock.mock.calls[0]?.[0]).toMatchObject({
      stream: true,
      temperature: 0.85,
    });
  });

  it("throws a local-only setup error when the self-hosted LLM is missing", async () => {
    delete process.env.ANIMA_LOCAL_LLM_BASE_URL;
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.VLLM_BASE_URL;
    process.env.VERCEL = "1";
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    process.env.MINIMAX_API_KEY = "minimax-test";
    process.env.DEEPSHI_API_KEY = "sk-bf-test";
    process.env.ANIMA_OPENROUTER_FALLBACK = "true";
    process.env.VERCEL = "1";

    await expect(
      createChatStreamWithFailover({
        tier: "standard",
        model: "anima-chat",
        maxTokens: 8192,
        messages: [{ role: "user", content: "hello" }],
      }),
    ).rejects.toThrow(/ANIMA_LLM_PROVIDER=custom requires a self-hosted Anima LLM/i);

    expect(createMock).not.toHaveBeenCalled();
  });

  it("does not skip the custom LLM after a local auth failure", async () => {
    process.env.ANIMA_LOCAL_LLM_BASE_URL = "https://anima-chat-llm.fly.dev/v1";
    process.env.ANIMA_OLLAMA_MODEL_STANDARD = "anima-chat";
    process.env.OPENROUTER_API_KEY = "sk-or-test-key-abcd";
    process.env.ANIMA_OPENROUTER_FALLBACK = "true";
    createMock.mockRejectedValueOnce(
      Object.assign(new Error("401 status code (no body)"), { status: 401 }),
    );

    try {
      await createChatStreamWithFailover({
        tier: "standard",
        model: "anima-chat",
        maxTokens: 8192,
        messages: [{ role: "user", content: "hello" }],
      });
      throw new Error("expected local auth to reject without OpenRouter");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      expect(message).toMatch(/Anima LLM authentication failed/i);
      expect(message).not.toMatch(/OpenRouter credits/i);
      expect(message).not.toMatch(/also unreachable/i);
    }
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("uses host-neutral recovery guidance for custom local connection failures", async () => {
    process.env.ANIMA_LOCAL_LLM_BASE_URL = "https://custom-llm.example.com/v1";
    process.env.ANIMA_OLLAMA_MODEL_STANDARD = "anima-chat";
    process.env.OPENROUTER_API_KEY = "sk-or-test-key-abcd";
    delete process.env.ANIMA_OPENROUTER_FALLBACK;
    delete process.env.ANIMA_LLM_PROVIDER;
    createMock.mockRejectedValueOnce(
      Object.assign(new Error("Connection error."), { name: "APIConnectionError" }),
    );

    try {
      await createChatStreamWithFailover({
        tier: "standard",
        model: "anima-chat",
        maxTokens: 8192,
        messages: [{ role: "user", content: "hello" }],
      });
      throw new Error("expected local connection to reject without OpenRouter");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      expect(message).toMatch(/custom-llm\.example\.com/);
      expect(message).toMatch(/Anima LLM connection failed/i);
      expect(message).not.toMatch(/openrouter\.ai\/settings\/credits/i);
      expect(message).not.toMatch(/fly apps restart anima-chat-llm/);
    }
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("does not fail over to OpenRouter when local is unreachable", async () => {
    process.env.ANIMA_LOCAL_LLM_BASE_URL = "http://localhost:8000/v1";
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    delete process.env.ANIMA_OPENROUTER_FALLBACK;
    delete process.env.ANIMA_LLM_PROVIDER;
    createMock
      .mockRejectedValueOnce(Object.assign(new Error("Connection error."), { name: "APIConnectionError" }))
      .mockResolvedValueOnce(fakeStream("venice"));

    await expect(
      createChatStreamWithFailover({
        tier: "standard",
        model: "anima-chat",
        maxTokens: 8192,
        messages: [{ role: "user", content: "hello" }],
      }),
    ).rejects.toThrow(/Anima LLM connection failed/i);

    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("refuses OpenRouter even when the local URL is missing", async () => {
    delete process.env.ANIMA_LOCAL_LLM_BASE_URL;
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.VLLM_BASE_URL;
    process.env.VERCEL = "1";
    process.env.VERCEL = "1";
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    delete process.env.ANIMA_LLM_PROVIDER;

    await expect(
      createChatStreamWithFailover({
        tier: "standard",
        model: "anima-chat",
        maxTokens: 8192,
        messages: [{ role: "user", content: "hello" }],
      }),
    ).rejects.toThrow(/ANIMA_LLM_PROVIDER=custom requires a self-hosted Anima LLM/i);

    expect(createMock).not.toHaveBeenCalled();
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
    expect(message).toMatch(/does not fall through to OpenRouter/i);
  });

  it("hops to OpenRouter when the custom Anima LLM host is unreachable and fallback is on", async () => {
    process.env.ANIMA_LOCAL_LLM_BASE_URL = "https://llm.anima-protocol.com/v1";
    process.env.ANIMA_OLLAMA_MODEL_STANDARD = "anima-chat";
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    process.env.ANIMA_OPENROUTER_FALLBACK = "true";
    process.env.ANIMA_OPENROUTER_FREE = "true";
    const sdkErr = Object.assign(new Error("Connection error."), {
      name: "APIConnectionError",
    });
    createMock.mockRejectedValueOnce(sdkErr);
    createMock.mockResolvedValueOnce(fakeStream("openrouter-after-local"));
    const result = await createChatStreamWithFailover({
      tier: "standard",
      model: "anima-chat",
      maxTokens: 32,
      messages: [{ role: "user", content: "hello" }],
    });
    expect(result.provider).toBe("openrouter");
    expect(result.failedOver).toBe(true);
    expect(createMock).toHaveBeenCalled();
  });

  it("streams from the Anima LLM even when Workers AI is bound", async () => {
    process.env.ANIMA_LOCAL_LLM_BASE_URL = "https://llm.anima-protocol.com/v1";
    createMock.mockResolvedValueOnce(fakeStream("from anima-chat"));
    const run = vi.fn(async () => ({ response: "from workersai" }));
    setAiBinding({ run });
    const result = await createChatStreamWithFailover({
      tier: "standard",
      model: "anima-chat",
      maxTokens: 8192,
      messages: [{ role: "user", content: "hello" }],
    });
    expect(result.provider).toBe("local");
    expect(result.brand).toBe("anima");
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(run).not.toHaveBeenCalled();
    const chunks: Array<{ choices?: Array<{ delta?: { content?: string } }> }> = [];
    for await (const chunk of result.stream) {
      chunks.push(chunk);
    }
    expect(chunks.some((chunk) => chunk.choices?.[0]?.delta?.content === "from anima-chat")).toBe(true);
  });

  it("surfaces a clear DeepSeek error when Workers AI run fails", async () => {
    delete process.env.ANIMA_LOCAL_LLM_BASE_URL;
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.VLLM_BASE_URL;
    process.env.VERCEL = "1";
    setAiBinding({
      run: async () => {
        throw new Error("3006 inference failed");
      },
    });
    await expect(
      createChatStreamWithFailover({
        tier: "standard",
        model: "anima-chat",
        maxTokens: 32,
        messages: [{ role: "user", content: "hello" }],
      }),
    ).rejects.toThrow(/DeepSeek on Workers AI failed: 3006 inference failed/);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("surfaces the Workers AI 4006 free-quota hint instead of a generic DeepSeek wrap", async () => {
    delete process.env.ANIMA_LOCAL_LLM_BASE_URL;
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.VLLM_BASE_URL;
    process.env.VERCEL = "1";
    setAiBinding({
      run: async () => {
        throw new Error(
          "4006: you have used up your daily free allocation of 10,000 neurons, please upgrade to Cloudflare's Workers Paid plan if",
        );
      },
    });
    await expect(
      createChatStreamWithFailover({
        tier: "standard",
        model: "anima-chat",
        maxTokens: 32,
        messages: [{ role: "user", content: "hello" }],
      }),
    ).rejects.toThrow(
      /Workers AI daily free quota exhausted — enable Workers Paid or temporarily allow OpenRouter failover/,
    );
    expect(createMock).not.toHaveBeenCalled();
  });

  it("hops to free-tier OpenRouter when Workers AI returns neuron quota 4006", async () => {
    delete process.env.ANIMA_LOCAL_LLM_BASE_URL;
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.VLLM_BASE_URL;
    process.env.VERCEL = "1";
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    process.env.ANIMA_OPENROUTER_FALLBACK = "true";
    process.env.ANIMA_OPENROUTER_FREE = "true";
    setAiBinding({
      run: async () => {
        throw Object.assign(
          new Error("4006: You have used up your daily free allocation of 10,000 neurons"),
          { code: 4006 },
        );
      },
    });
    createMock.mockResolvedValueOnce(fakeStream("openrouter-free"));
    const result = await createChatStreamWithFailover({
      tier: "standard",
      model: "anima-chat",
      maxTokens: 32,
      messages: [{ role: "user", content: "hello" }],
    });
    expect(result.provider).toBe("openrouter");
    expect(result.brand).toBe("openrouter");
    expect(result.failedOver).toBe(true);
    expect(result.model).toBe("minimax/minimax-m2.7:free");
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("hops to OpenRouter when Workers AI returns a 4006 error object at stream open", async () => {
    delete process.env.ANIMA_LOCAL_LLM_BASE_URL;
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.VLLM_BASE_URL;
    process.env.VERCEL = "1";
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    process.env.ANIMA_OPENROUTER_FALLBACK = "true";
    process.env.ANIMA_OPENROUTER_FREE = "true";
    setAiBinding({
      run: async () => ({
        success: false,
        errors: [
          {
            code: 4006,
            message: "You have used up your daily free allocation of 10,000 neurons",
          },
        ],
      }),
    });
    createMock.mockResolvedValueOnce(fakeStream("openrouter-object"));
    const result = await createChatStreamWithFailover({
      tier: "standard",
      model: "anima-chat",
      maxTokens: 32,
      messages: [{ role: "user", content: "hello" }],
    });
    expect(result.provider).toBe("openrouter");
    expect(result.failedOver).toBe(true);
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("hops to OpenRouter when Workers AI streams a 4006 SSE error after run() returns", async () => {
    delete process.env.ANIMA_LOCAL_LLM_BASE_URL;
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.VLLM_BASE_URL;
    process.env.VERCEL = "1";
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    process.env.ANIMA_OPENROUTER_FALLBACK = "true";
    process.env.ANIMA_OPENROUTER_FREE = "true";
    const encoder = new TextEncoder();
    setAiBinding({
      run: async () =>
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                'data: {"success":false,"errors":[{"code":4006,"message":"You have used up your daily free allocation of 10,000 neurons"}]}\n\n',
              ),
            );
            controller.close();
          },
        }),
    });
    createMock.mockResolvedValueOnce(fakeStream("openrouter-sse"));
    const result = await createChatStreamWithFailover({
      tier: "standard",
      model: "anima-chat",
      maxTokens: 32,
      messages: [{ role: "user", content: "hello" }],
    });
    expect(result.provider).toBe("openrouter");
    expect(result.failedOver).toBe(true);
    expect(result.model).toBe("minimax/minimax-m2.7:free");
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("hops to OpenRouter when Workers AI returns a 429 Response with 4006", async () => {
    delete process.env.ANIMA_LOCAL_LLM_BASE_URL;
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.VLLM_BASE_URL;
    process.env.VERCEL = "1";
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    process.env.ANIMA_OPENROUTER_FALLBACK = "true";
    process.env.ANIMA_OPENROUTER_FREE = "true";
    setAiBinding({
      run: async () =>
        new Response(
          JSON.stringify({
            success: false,
            errors: [
              {
                code: 4006,
                message: "You have used up your daily free allocation of 10,000 neurons",
              },
            ],
          }),
          { status: 429 },
        ),
    });
    createMock.mockResolvedValueOnce(fakeStream("openrouter-429"));
    const result = await createChatStreamWithFailover({
      tier: "standard",
      model: "anima-chat",
      maxTokens: 32,
      messages: [{ role: "user", content: "hello" }],
    });
    expect(result.provider).toBe("openrouter");
    expect(result.failedOver).toBe(true);
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("skips Workers AI on the next turn after isolate 4006 so OpenRouter is first", async () => {
    delete process.env.ANIMA_LOCAL_LLM_BASE_URL;
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.VLLM_BASE_URL;
    process.env.VERCEL = "1";
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    process.env.ANIMA_OPENROUTER_FALLBACK = "true";
    process.env.ANIMA_OPENROUTER_FREE = "true";
    let workersAiRuns = 0;
    setAiBinding({
      run: async () => {
        workersAiRuns += 1;
        throw Object.assign(
          new Error("4006: You have used up your daily free allocation of 10,000 neurons"),
          { code: 4006 },
        );
      },
    });
    createMock.mockResolvedValueOnce(fakeStream("hop-1"));
    createMock.mockResolvedValueOnce(fakeStream("hop-2"));
    await createChatStreamWithFailover({
      tier: "standard",
      model: "anima-chat",
      maxTokens: 32,
      messages: [{ role: "user", content: "first" }],
    });
    const second = await createChatStreamWithFailover({
      tier: "standard",
      model: "anima-chat",
      maxTokens: 32,
      messages: [{ role: "user", content: "second" }],
    });
    expect(workersAiRuns).toBe(1);
    expect(second.provider).toBe("openrouter");
    expect(second.failedOver).toBe(true);
    expect(createMock).toHaveBeenCalledTimes(2);
  });
});

describe("createChatCompletionWithFailover", () => {
  const SAVED = { ...process.env };

  beforeEach(() => {
    process.env = { ...SAVED };
    process.env.ANIMA_LOCAL_LLM_BASE_URL = "http://localhost:8000/v1";
    delete process.env.MINIMAX_API_KEY;
    delete process.env.ANIMA_MINIMAX_API_KEY;
    delete process.env.ANIMA_OPENROUTER_FALLBACK;
    createMock.mockReset();
    modelsListMock.mockReset();
    resetLocalModelCatalogForTests();
    resetOpenRouterCreditFallbackForTests();
    resetAiBindingForTests();
    resetWorkersAiQuotaSkipForTests();
  });

  afterEach(() => {
    process.env = { ...SAVED };
    resetWorkersAiQuotaSkipForTests();
    resetAiBindingForTests();
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

  it("refuses OpenRouter and MiniMax for non-streaming completions when local is unset", async () => {
    delete process.env.ANIMA_LOCAL_LLM_BASE_URL;
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.VLLM_BASE_URL;
    process.env.VERCEL = "1";
    process.env.VERCEL = "1";
    process.env.OPENROUTER_API_KEY = "sk-or-test-key-abcd";
    process.env.MINIMAX_API_KEY = "minimax-test";
    process.env.ANIMA_OPENROUTER_FREE = "true";

    await expect(
      createChatCompletionWithFailover({
        tier: "standard",
        maxTokens: 1024,
        messages: [{ role: "user", content: "hello" }],
      }),
    ).rejects.toThrow(/ANIMA_LLM_PROVIDER=custom requires a self-hosted Anima LLM/i);

    expect(createMock).not.toHaveBeenCalled();
  });

  it("completes via the Anima LLM even when Workers AI is bound", async () => {
    process.env.ANIMA_LOCAL_LLM_BASE_URL = "https://llm.anima-protocol.com/v1";
    createMock.mockResolvedValueOnce(fakeCompletion("anima-chat reply"));
    const run = vi.fn(async () => ({ response: "workersai reply" }));
    setAiBinding({ run });
    const result = await createChatCompletionWithFailover({
      tier: "standard",
      maxTokens: 1024,
      messages: [{ role: "user", content: "hello" }],
    });
    expect(result.content).toBe("anima-chat reply");
    expect(result.provider).toBe("local");
    expect(result.brand).toBe("anima");
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(run).not.toHaveBeenCalled();
  });

  it("completes via OpenRouter after Workers AI neuron quota 4006", async () => {
    delete process.env.ANIMA_LOCAL_LLM_BASE_URL;
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.VLLM_BASE_URL;
    process.env.VERCEL = "1";
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    process.env.ANIMA_OPENROUTER_FALLBACK = "true";
    process.env.ANIMA_OPENROUTER_FREE = "true";
    setAiBinding({
      run: async () => ({
        success: false,
        errors: [
          {
            code: 4006,
            message: "You have used up your daily free allocation of 10,000 neurons",
          },
        ],
      }),
    });
    createMock.mockResolvedValueOnce(fakeCompletion("openrouter reply"));
    const result = await createChatCompletionWithFailover({
      tier: "standard",
      maxTokens: 1024,
      messages: [{ role: "user", content: "hello" }],
    });
    expect(result.content).toBe("openrouter reply");
    expect(result.provider).toBe("openrouter");
    expect(result.failedOver).toBe(true);
    expect(result.model).toBe("minimax/minimax-m2.7:free");
    expect(createMock).toHaveBeenCalledTimes(1);
  });
});

describe("probeLlmProviders", () => {
  const SAVED = { ...process.env };

  beforeEach(() => {
    process.env = { ...SAVED };
    delete process.env.MINIMAX_API_KEY;
    delete process.env.ANIMA_MINIMAX_API_KEY;
    delete process.env.ANIMA_OPENROUTER_FALLBACK;
    createMock.mockReset();
    modelsListMock.mockReset();
    resetLocalModelCatalogForTests();
    resetOpenRouterCreditFallbackForTests();
    resetAiBindingForTests();
  });

  afterEach(() => {
    process.env = { ...SAVED };
    resetAiBindingForTests();
  });

  it("reports not configured when there is no local endpoint", async () => {
    delete process.env.ANIMA_LOCAL_LLM_BASE_URL;
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.VLLM_BASE_URL;
    process.env.VERCEL = "1";
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.ANIMA_OPENROUTER_API_KEY;
    delete process.env.OPEN_ROUTER_API_KEY;
    process.env.VERCEL = "1";
    const probes = await probeLlmProviders();
    expect(probes).toHaveLength(1);
    expect(probes[0]).toMatchObject({ provider: "local", configured: false, ok: false });
    expect(probes[0].message).toMatch(/ANIMA_LLM_PROVIDER=custom requires a self-hosted Anima LLM/i);
    expect(probes[0].message).not.toMatch(/Set OPENROUTER_API_KEY|MINIMAX_API_KEY/i);
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

  it("does not probe OpenRouter when local is unset even if a key is present", async () => {
    delete process.env.ANIMA_LOCAL_LLM_BASE_URL;
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.VLLM_BASE_URL;
    process.env.VERCEL = "1";
    process.env.VERCEL = "1";
    process.env.OPENROUTER_API_KEY = "sk-or-test-key-abcd";

    const probes = await probeLlmProviders();
    expect(probes).toHaveLength(1);
    expect(probes[0]).toMatchObject({
      provider: "local",
      configured: false,
      ok: false,
    });
    expect(createMock).not.toHaveBeenCalled();
  });

  it("probes the custom Anima LLM instead of Workers AI when the host is configured", async () => {
    process.env.ANIMA_LOCAL_LLM_BASE_URL = "https://llm.anima-protocol.com/v1";
    createMock.mockResolvedValueOnce(fakeCompletion("ok"));
    const run = vi.fn(async () => ({ response: "ok" }));
    setAiBinding({ run });
    const probes = await probeLlmProviders();
    expect(probes).toHaveLength(1);
    expect(probes[0]).toMatchObject({
      provider: "local",
      configured: true,
      ok: true,
    });
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(run).not.toHaveBeenCalled();
  });

  it("classifies a Workers AI 4006 probe as quota with the free-quota hint", async () => {
    delete process.env.ANIMA_LOCAL_LLM_BASE_URL;
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.VLLM_BASE_URL;
    process.env.VERCEL = "1";
    setAiBinding({
      run: async () => {
        throw Object.assign(
          new Error(
            "4006: you have used up your daily free allocation of 10,000 neurons, please upgrade to Cloudflare's Workers Paid plan if",
          ),
          { code: 4006 },
        );
      },
    });
    const probes = await probeLlmProviders();
    expect(probes).toHaveLength(1);
    expect(probes[0]).toMatchObject({
      provider: "workersai",
      configured: true,
      ok: false,
      errorKind: "quota",
      message: expect.stringMatching(/Workers AI daily free quota exhausted/),
    });
    expect(createMock).not.toHaveBeenCalled();
  });
});
