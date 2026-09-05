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
    OPENROUTER_FREE_MODEL: "minimax/minimax-m2.7:free",
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
    getOpenRouterClient: () => null,
    localLlmBaseUrl: () => "http://localhost:8000/v1",
    hasLocalLlm: () => true,
    summarizeLocalLlmBaseUrl: () => ({
      configured: true,
      host: "localhost",
      hasV1Path: true,
      isHttps: false,
      isLocalhost: true,
      isCloudFlagship: false,
    }),
    isCloudFlagshipLlmHost: () => false,
    logLocalLlmClientInitOnce: () => {},
    getOpenAIClient: () => client,
    getLocalLlmClient: () => client,
    normalizeApiKey: (raw: string | undefined) => (raw ? raw.trim() || null : null),
    localLlmMaxRetries: () => 2,
    resetLlmClientsForTests: () => {},
  };
});

import {
  combineLocalDrafts,
  draftLocalMinds,
  isLocalEnsembleEnabled,
} from "../src/lib/localEnsemble";

function fakeCompletion(content = "ok") {
  return { choices: [{ message: { content } }] };
}

function fakeStream(label = "combined") {
  return {
    async *[Symbol.asyncIterator]() {
      yield { choices: [{ delta: { content: label } }] };
    },
  };
}

describe("isLocalEnsembleEnabled", () => {
  const SAVED = { ...process.env };
  afterEach(() => {
    process.env = { ...SAVED };
  });

  it("is off by default", () => {
    delete process.env.ANIMA_LOCAL_LLM_ENSEMBLE;
    expect(isLocalEnsembleEnabled()).toBe(false);
  });

  it("turns on for true/1/yes (case-insensitive)", () => {
    for (const value of ["true", "1", "yes", "TRUE", "Yes"]) {
      process.env.ANIMA_LOCAL_LLM_ENSEMBLE = value;
      expect(isLocalEnsembleEnabled()).toBe(true);
    }
  });

  it("stays off for anything else", () => {
    process.env.ANIMA_LOCAL_LLM_ENSEMBLE = "false";
    expect(isLocalEnsembleEnabled()).toBe(false);
  });
});

describe("draftLocalMinds", () => {
  const SAVED = { ...process.env };

  beforeEach(() => {
    process.env = { ...SAVED };
    process.env.ANIMA_LOCAL_LLM_BASE_URL = "http://localhost:8000/v1";
    process.env.ANIMA_ENSEMBLE_MINDS = "Steady,Vivid,Playful";
    createMock.mockReset();
  });

  afterEach(() => {
    process.env = { ...SAVED };
  });

  it("drafts one reply per mind, each at a different temperature", async () => {
    createMock
      .mockResolvedValueOnce(fakeCompletion("steady reply"))
      .mockResolvedValueOnce(fakeCompletion("vivid reply"))
      .mockResolvedValueOnce(fakeCompletion("playful reply"));

    const drafts = await draftLocalMinds({
      tier: "standard",
      maxTokens: 1024,
      messages: [{ role: "user", content: "hi" }],
    });

    expect(drafts).toHaveLength(3);
    expect(drafts.map((d) => d.label)).toEqual(["Steady", "Vivid", "Playful"]);
    expect(drafts.map((d) => d.content)).toEqual(["steady reply", "vivid reply", "playful reply"]);

    const temperatures = createMock.mock.calls.map((call) => (call[0] as { temperature?: number }).temperature);
    expect(new Set(temperatures).size).toBe(3);
  });

  it("drops a mind that errors instead of failing the whole batch", async () => {
    createMock
      .mockResolvedValueOnce(fakeCompletion("steady reply"))
      .mockRejectedValueOnce(new Error("model overloaded"))
      .mockResolvedValueOnce(fakeCompletion("playful reply"));

    const drafts = await draftLocalMinds({
      tier: "standard",
      maxTokens: 1024,
      messages: [{ role: "user", content: "hi" }],
    });

    expect(drafts.map((d) => d.label)).toEqual(["Steady", "Playful"]);
  });

  it("drops a mind that times out, and aborts its in-flight request", async () => {
    process.env.ANIMA_ENSEMBLE_MIND_TIMEOUT_MS = "20";
    let sawAbort = false;
    createMock
      .mockResolvedValueOnce(fakeCompletion("steady reply"))
      .mockImplementationOnce(
        (_body: unknown, options?: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            options?.signal?.addEventListener("abort", () => {
              sawAbort = true;
              reject(new Error("aborted"));
            });
          }),
      )
      .mockResolvedValueOnce(fakeCompletion("playful reply"));

    const drafts = await draftLocalMinds({
      tier: "standard",
      maxTokens: 1024,
      messages: [{ role: "user", content: "hi" }],
    });

    expect(drafts.map((d) => d.label)).toEqual(["Steady", "Playful"]);
    expect(sawAbort).toBe(true);
  });

  it("drops a mind that returns empty content", async () => {
    createMock
      .mockResolvedValueOnce(fakeCompletion(""))
      .mockResolvedValueOnce(fakeCompletion("vivid reply"))
      .mockResolvedValueOnce(fakeCompletion("   "));

    const drafts = await draftLocalMinds({
      tier: "standard",
      maxTokens: 1024,
      messages: [{ role: "user", content: "hi" }],
    });

    expect(drafts.map((d) => d.label)).toEqual(["Vivid"]);
  });

  it("returns an empty array when every mind fails", async () => {
    createMock.mockRejectedValue(new Error("down"));

    const drafts = await draftLocalMinds({
      tier: "standard",
      maxTokens: 1024,
      messages: [{ role: "user", content: "hi" }],
    });

    expect(drafts).toEqual([]);
  });

  it("caps the mind count at ANIMA_ENSEMBLE_MAX_MINDS", async () => {
    process.env.ANIMA_ENSEMBLE_MAX_MINDS = "2";
    createMock.mockResolvedValue(fakeCompletion("reply"));

    const drafts = await draftLocalMinds({
      tier: "standard",
      maxTokens: 1024,
      messages: [{ role: "user", content: "hi" }],
    });

    expect(createMock).toHaveBeenCalledTimes(2);
    expect(drafts).toHaveLength(2);
  });

  it("falls back to the default mind count for a sub-1 ANIMA_ENSEMBLE_MAX_MINDS instead of drafting zero", async () => {
    process.env.ANIMA_ENSEMBLE_MAX_MINDS = "0.5";
    createMock.mockResolvedValue(fakeCompletion("reply"));

    const drafts = await draftLocalMinds({
      tier: "standard",
      maxTokens: 1024,
      messages: [{ role: "user", content: "hi" }],
    });

    expect(createMock).toHaveBeenCalledTimes(3);
    expect(drafts).toHaveLength(3);
  });
});

describe("combineLocalDrafts", () => {
  const SAVED = { ...process.env };

  beforeEach(() => {
    process.env = { ...SAVED };
    process.env.ANIMA_LOCAL_LLM_BASE_URL = "http://localhost:8000/v1";
    createMock.mockReset();
  });

  afterEach(() => {
    process.env = { ...SAVED };
  });

  it("streams a single combined reply built from the drafts and original system prompt", async () => {
    createMock.mockResolvedValueOnce(fakeStream("combined reply"));

    const result = await combineLocalDrafts(
      [
        { label: "Steady", content: "steady reply", model: "anima-chat" },
        { label: "Vivid", content: "vivid reply", model: "anima-chat" },
      ],
      [
        { role: "system", content: "You are Serenity." },
        { role: "user", content: "hi" },
      ],
      { tier: "standard", maxTokens: 1024 },
    );

    expect(result.provider).toBe("local");
    expect(result.brand).toBe("anima");

    const call = createMock.mock.calls[0]![0] as { messages: Array<{ role: string; content: string }> };
    expect(call.messages[0]!.role).toBe("system");
    expect(call.messages[0]!.content).toContain("You are Serenity.");
    expect(call.messages[0]!.content).toMatch(/combining multiple draft replies/i);
    expect(call.messages[1]!.content).toContain("steady reply");
    expect(call.messages[1]!.content).toContain("vivid reply");
  });
});
