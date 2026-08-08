import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createMock = vi.fn();
const modelsListMock = vi.fn();

vi.mock("../src/lib/openaiClient", () => {
  const client = {
    chat: { completions: { create: (...args: unknown[]) => createMock(...args) } },
    models: { list: (...args: unknown[]) => modelsListMock(...args) },
  };
  return {
    hasOpenAIKey: () => Boolean(process.env.OPENAI_API_KEY?.trim()),
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
  isAnimaCustomMode,
  isProviderAuthError,
  probeLlmProviders,
  resolveLocalModel,
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
  it("detects 401 / invalid API key (including SDK 'no body' message)", () => {
    expect(isProviderAuthError({ status: 401, message: "401 status code (no body)" })).toBe(true);
    expect(isProviderAuthError({ status: 429, message: "rate limited" })).toBe(false);
  });
});

describe("isAnimaCustomMode", () => {
  it("is always true — chat only ever runs on the self-hosted Anima LLM", () => {
    expect(isAnimaCustomMode()).toBe(true);
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
  });

  afterEach(() => {
    process.env = { ...SAVED };
  });

  it("reports ok with brand anima when a local endpoint is configured", () => {
    process.env.ANIMA_LOCAL_LLM_BASE_URL = "http://localhost:8000/v1";
    const status = getLlmRoutingStatus();
    expect(status.status).toBe("ok");
    expect(status.preferred).toBe("local");
    expect(status.brand).toBe("anima");
    expect(status.note).toMatch(/self-hosted Anima LLM only/i);
  });

  it("reports error and a setup hint when no local endpoint is configured on Vercel", () => {
    delete process.env.ANIMA_LOCAL_LLM_BASE_URL;
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.VLLM_BASE_URL;
    process.env.VERCEL = "1";
    process.env.ANIMA_OLLAMA_MODEL_STANDARD = "anima-chat";
    const status = getLlmRoutingStatus();
    expect(status.status).toBe("error");
    expect(status.preferred).toBeNull();
    expect(status.localEndpoint.configured).toBe(false);
    expect(status.localEndpoint.model).toBe("anima-chat");
    expect(status.note).toMatch(/ANIMA_LOCAL_LLM_BASE_URL/i);
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

  it("throws a setup error when no local endpoint is configured", async () => {
    delete process.env.ANIMA_LOCAL_LLM_BASE_URL;
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.VLLM_BASE_URL;
    process.env.VERCEL = "1";

    await expect(
      createChatStreamWithFailover({
        tier: "standard",
        model: "anima-chat",
        maxTokens: 8192,
        messages: [{ role: "user", content: "hello" }],
      }),
    ).rejects.toThrow(/ANIMA_LOCAL_LLM_BASE_URL/i);

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
});

describe("createChatCompletionWithFailover", () => {
  const SAVED = { ...process.env };

  beforeEach(() => {
    process.env = { ...SAVED };
    process.env.ANIMA_LOCAL_LLM_BASE_URL = "http://localhost:8000/v1";
    createMock.mockReset();
    modelsListMock.mockReset();
    resetLocalModelCatalogForTests();
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
  });

  afterEach(() => {
    process.env = { ...SAVED };
  });

  it("reports not configured when there is no local endpoint", async () => {
    delete process.env.ANIMA_LOCAL_LLM_BASE_URL;
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.VLLM_BASE_URL;
    process.env.VERCEL = "1";
    const probes = await probeLlmProviders();
    expect(probes).toEqual([{ provider: "local", configured: false, ok: false }]);
  });

  it("probes the local endpoint with a tiny completion", async () => {
    process.env.ANIMA_LOCAL_LLM_BASE_URL = "http://localhost:8000/v1";
    createMock.mockResolvedValueOnce(fakeCompletion("ok"));
    const probes = await probeLlmProviders();
    expect(probes).toHaveLength(1);
    expect(probes[0]).toMatchObject({ provider: "local", configured: true, ok: true });
  });
});
