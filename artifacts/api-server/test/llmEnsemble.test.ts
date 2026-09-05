import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createMock = vi.fn();

vi.mock("../src/lib/openaiClient", () => {
  const client = {
    chat: { completions: { create: (...args: unknown[]) => createMock(...args) } },
  };
  return {
    OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
    OPENROUTER_VENICE_UNCENSORED:
      "cognitivecomputations/dolphin-mistral-24b-venice-edition",
    OPENROUTER_FREE_MODEL: "minimax/minimax-m3:free",
    OPENROUTER_FREE_M3_MODEL: "minimax/minimax-m3:free",
    OPENROUTER_FREE_M27_MODEL: "minimax/minimax-m2.7:free",
    MINIMAX_FREE_MODEL: "minimax/minimax-01:free",
    JULES_FREE_MODEL: "google/gemma-3-12b-it:free",
    OPENROUTER_FREE_MODEL_CANDIDATES: [
      "minimax/minimax-m3:free",
      "google/gemma-3-12b-it:free",
      "minimax/minimax-01:free",
      "minimax/minimax-m2.7:free",
    ],
    MINIMAX_DEFAULT_MODEL: "MiniMax-M2.5",
    hasOpenAIKey: () => Boolean(process.env.OPENAI_API_KEY?.trim()),
    hasOpenRouterKey: () =>
      Boolean(
        process.env.OPENROUTER_API_KEY?.trim() ||
          process.env.ANIMA_OPENROUTER_API_KEY?.trim() ||
          process.env.OPEN_ROUTER_API_KEY?.trim(),
      ),
    hasMinimaxKey: () => false,
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
    getOpenRouterClient: () =>
      process.env.OPENROUTER_API_KEY?.trim() ||
      process.env.ANIMA_OPENROUTER_API_KEY?.trim() ||
      process.env.OPEN_ROUTER_API_KEY?.trim()
        ? client
        : null,
    getOpenAIClient: () => client,
    getLocalLlmClient: () => client,
    getMinimaxClient: () => null,
    getMinimaxApiKeySource: () => null,
    hasLocalLlm: () => Boolean(process.env.ANIMA_LOCAL_LLM_BASE_URL?.trim()),
    localLlmBaseUrl: () => process.env.ANIMA_LOCAL_LLM_BASE_URL?.trim() || null,
    summarizeLocalLlmBaseUrl: () => ({
      configured: Boolean(process.env.ANIMA_LOCAL_LLM_BASE_URL?.trim()),
      host: "localhost",
      hasV1Path: true,
      isHttps: false,
      isLocalhost: true,
      isCloudFlagship: false,
      isLoopbackMisconfigured: false,
    }),
    isLoopbackUnreachableRuntime: () => false,
    isCloudFlagshipLlmHost: () => false,
    logLocalLlmClientInitOnce: () => {},
    normalizeApiKey: (raw: string | undefined) => (raw ? raw.trim() || null : null),
    resetLlmClientsForTests: () => {},
  };
});

import {
  chunkTextAsStream,
  createEnsembleChatReply,
  getEnsembleMinds,
  isEnsembleMode,
} from "../src/lib/llmEnsemble";
import { resetOpenRouterCreditFallbackForTests } from "../src/lib/llmFailover";

function fakeCompletion(content: string) {
  return { choices: [{ message: { content } }] };
}

describe("llmEnsemble", () => {
  const SAVED = { ...process.env };

  beforeEach(() => {
    process.env = { ...SAVED };
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.OPENROUTER_API_KEY = "sk-or-test-key-abcd";
    process.env.ANIMA_LOCAL_LLM_BASE_URL = "http://localhost:11434/v1";
    process.env.ANIMA_OPENROUTER_FALLBACK = "true";
    process.env.ANIMA_LLM_ENSEMBLE = "true";
    process.env.ANIMA_ENSEMBLE_MIND_TIMEOUT_MS = "5000";
    delete process.env.ANIMA_LLM_PROVIDER;
    delete process.env.ANIMA_DISABLE_OPENAI;
    delete process.env.MINIMAX_API_KEY;
    delete process.env.ANIMA_MINIMAX_API_KEY;
    resetOpenRouterCreditFallbackForTests();
    createMock.mockReset();
  });

  afterEach(() => {
    process.env = { ...SAVED };
    resetOpenRouterCreditFallbackForTests();
  });

  it("lists available minds for ensemble", () => {
    expect(getEnsembleMinds("standard")).toEqual(["local", "openrouter"]);
    expect(isEnsembleMode()).toBe(true);
  });

  it("gathers parallel drafts and synthesizes a combined reply", async () => {
    createMock
      .mockResolvedValueOnce(fakeCompletion("Local draft about longing."))
      .mockResolvedValueOnce(fakeCompletion("OpenRouter draft with warmth."))
      .mockResolvedValueOnce(fakeCompletion("Combined in-character reply."));

    const progress: string[] = [];
    const result = await createEnsembleChatReply({
      tier: "standard",
      model: "anima-chat",
      maxTokens: 800,
      messages: [
        { role: "system", content: "You are Serenity." },
        { role: "user", content: "I missed you." },
      ],
      onProgress: (e) => progress.push(e.phase),
    });

    expect(result.combined).toBe(true);
    expect(result.brand).toBe("anima");
    expect(result.content).toBe("Combined in-character reply.");
    expect(result.minds.sort()).toEqual(["local", "openrouter"].sort());
    expect(result.drafts).toHaveLength(2);
    expect(progress).toContain("gathering");
    expect(progress).toContain("combining");
    expect(progress).toContain("streaming");
  });

  it("uses a single successful mind without synthesis", async () => {
    process.env.ANIMA_DISABLE_OPENAI = "true";
    createMock.mockResolvedValueOnce(fakeCompletion("Only OpenRouter answered."));

    const result = await createEnsembleChatReply({
      tier: "standard",
      model: "anima-chat",
      maxTokens: 800,
      messages: [{ role: "user", content: "hi" }],
    });

    expect(result.combined).toBe(false);
    expect(result.provider).toBe("openrouter");
    expect(result.content).toBe("Only OpenRouter answered.");
    expect(result.minds).toEqual(["openrouter"]);
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("still returns a draft when some minds fail", async () => {
    createMock
      .mockRejectedValueOnce({ status: 429, message: "local quota" })
      .mockResolvedValueOnce(fakeCompletion("OpenRouter survived."));

    const result = await createEnsembleChatReply({
      tier: "standard",
      model: "anima-chat",
      maxTokens: 800,
      messages: [{ role: "user", content: "hello" }],
    });

    expect(result.combined).toBe(false);
    expect(result.provider).toBe("openrouter");
    expect(result.content).toBe("OpenRouter survived.");
  });

  it("chunks combined text for streaming", async () => {
    const chunks: string[] = [];
    for await (const part of chunkTextAsStream("Hello world", 5)) {
      chunks.push(part.choices[0]!.delta.content);
    }
    expect(chunks.join("")).toBe("Hello world");
    expect(chunks.length).toBeGreaterThan(1);
  });
});
