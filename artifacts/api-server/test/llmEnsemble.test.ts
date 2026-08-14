import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createMock = vi.fn();
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
  createGeminiChatStream: vi.fn(),
  createGeminiChatCompletion: (...args: unknown[]) => geminiCompletionMock(...args),
}));

import {
  chunkTextAsStream,
  createEnsembleChatReply,
  getEnsembleMinds,
  isEnsembleMode,
} from "../src/lib/llmEnsemble";
import { resetLlmFailoverStateForTests } from "../src/lib/llmFailover";

function fakeCompletion(content: string) {
  return { choices: [{ message: { content } }] };
}

describe("llmEnsemble", () => {
  const SAVED = { ...process.env };

  beforeEach(() => {
    process.env = { ...SAVED };
    process.env.KIMI_API_KEY = "kimi-test";
    process.env.GEMINI_API_KEY = "gemini-test";
    process.env.XAI_API_KEY = "xai-test";
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.ANIMA_LLM_PROVIDER = "anima";
    delete process.env.ANIMA_DISABLE_OPENAI;
    delete process.env.ANIMA_DISABLE_XAI;
    delete process.env.ANIMA_LLM_ENSEMBLE;
    process.env.ANIMA_ENSEMBLE_MIND_TIMEOUT_MS = "5000";
    resetLlmFailoverStateForTests();
    createMock.mockReset();
    geminiCompletionMock.mockReset();
  });

  afterEach(() => {
    process.env = { ...SAVED };
    resetLlmFailoverStateForTests();
  });

  it("lists available minds for ensemble", () => {
    expect(getEnsembleMinds("standard")).toEqual([
      "kimi",
      "gemini",
      "xai",
      "openai",
    ]);
    expect(isEnsembleMode()).toBe(true);
  });

  it("gathers parallel drafts and synthesizes a combined reply", async () => {
    createMock
      // Kimi draft
      .mockResolvedValueOnce(fakeCompletion("Kimi draft about longing."))
      // Grok draft
      .mockResolvedValueOnce(fakeCompletion("Grok draft with wit."))
      // OpenAI draft
      .mockResolvedValueOnce(fakeCompletion("ChatGPT draft with clarity."))
      // Kimi synthesis
      .mockResolvedValueOnce(fakeCompletion("Combined in-character reply."));
    geminiCompletionMock.mockResolvedValueOnce(
      fakeCompletion("Gemini draft with warmth."),
    );

    const progress: string[] = [];
    const result = await createEnsembleChatReply({
      tier: "standard",
      model: "gpt-4o",
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
    expect(result.minds.sort()).toEqual(
      ["gemini", "kimi", "openai", "xai"].sort(),
    );
    expect(result.drafts).toHaveLength(4);
    expect(progress).toContain("gathering");
    expect(progress).toContain("combining");
    expect(progress).toContain("streaming");
  });

  it("uses a single successful mind without synthesis", async () => {
    process.env.ANIMA_DISABLE_XAI = "true";
    process.env.ANIMA_DISABLE_OPENAI = "true";
    delete process.env.GEMINI_API_KEY;
    createMock.mockResolvedValueOnce(fakeCompletion("Only Kimi answered."));

    const result = await createEnsembleChatReply({
      tier: "standard",
      model: "gpt-4o",
      maxTokens: 800,
      messages: [{ role: "user", content: "hi" }],
    });

    expect(result.combined).toBe(false);
    expect(result.provider).toBe("kimi");
    expect(result.content).toBe("Only Kimi answered.");
    expect(result.minds).toEqual(["kimi"]);
    // No synthesis call
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("still returns a draft when some minds fail", async () => {
    createMock
      .mockRejectedValueOnce({ status: 429, message: "kimi quota" })
      .mockResolvedValueOnce(fakeCompletion("Grok survived."))
      .mockRejectedValueOnce({ status: 401, message: "openai dead" })
      // synthesis with Grok (only survivor — pickSynthesizer prefers kimi/gemini first,
      // so with only grok draft, synthesizer is xai)
      .mockResolvedValueOnce(fakeCompletion("Final from Grok synthesis."));
    geminiCompletionMock.mockRejectedValueOnce({
      status: 429,
      message: "gemini quota",
    });

    const result = await createEnsembleChatReply({
      tier: "standard",
      model: "gpt-4o",
      maxTokens: 800,
      messages: [{ role: "user", content: "hello" }],
    });

    // Only one draft succeeded → no synthesis path
    expect(result.combined).toBe(false);
    expect(result.provider).toBe("xai");
    expect(result.content).toBe("Grok survived.");
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
