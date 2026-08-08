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
    hasGroqKey: () => Boolean(process.env.GROQ_API_KEY?.trim()),
    hasKimiKey: () =>
      Boolean(process.env.KIMI_API_KEY?.trim() || process.env.MOONSHOT_API_KEY?.trim()),
    hasGatewayAuth: () =>
      Boolean(
        process.env.AI_GATEWAY_API_KEY?.trim() || process.env.VERCEL_OIDC_TOKEN?.trim(),
      ),
    hasLocalLlm: () => Boolean(process.env.ANIMA_LOCAL_LLM_BASE_URL?.trim()),
    localLlmBaseUrl: () => process.env.ANIMA_LOCAL_LLM_BASE_URL?.trim() || null,
    summarizeLocalLlmBaseUrl: () => ({
      configured: Boolean(process.env.ANIMA_LOCAL_LLM_BASE_URL?.trim()),
      host: process.env.ANIMA_LOCAL_LLM_BASE_URL?.trim()
        ? "localhost"
        : null,
      hasV1Path: true,
      isHttps: false,
      isLocalhost: true,
    }),
    logLocalLlmClientInitOnce: () => {},
    getOpenAIClient: () => client,
    getXaiClient: () => (process.env.XAI_API_KEY?.trim() ? client : null),
    getGeminiClient: () => null,
    getGroqClient: () => (process.env.GROQ_API_KEY?.trim() ? client : null),
    getKimiClient: () =>
      process.env.KIMI_API_KEY?.trim() || process.env.MOONSHOT_API_KEY?.trim()
        ? client
        : null,
    getGatewayClient: () =>
      process.env.AI_GATEWAY_API_KEY?.trim() || process.env.VERCEL_OIDC_TOKEN?.trim()
        ? client
        : null,
    getLocalLlmClient: () =>
      process.env.ANIMA_LOCAL_LLM_BASE_URL?.trim() ? client : null,
    normalizeApiKey: (raw: string | undefined) => {
      if (!raw) return null;
      return raw.trim() || null;
    },
    resetLlmClientsForTests: () => {},
  };
});

vi.mock("../src/lib/geminiNative", () => ({
  createGeminiChatCompletion: (...args: unknown[]) => geminiCompletionMock(...args),
  createGeminiChatStream: vi.fn(),
}));

import {
  chunkTextAsStream,
  createEnsembleChatReply,
  getEnsembleMinds,
  isEnsembleMode,
  withAbortTimeout,
} from "../src/lib/llmEnsemble";
import {
  isGroqStickySkipped,
  recordProviderFailure,
  resetLlmFailoverStateForTests,
} from "../src/lib/llmFailover";

function fakeCompletion(content: string) {
  return { choices: [{ message: { content } }] };
}

describe("llmEnsemble", () => {
  const SAVED = { ...process.env };

  beforeEach(() => {
    process.env = { ...SAVED };
    process.env.GEMINI_API_KEY = "gemini-test";
    process.env.GROQ_API_KEY = "gsk-test";
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.ANIMA_LLM_PROVIDER = "ensemble";
    process.env.ANIMA_ALLOW_CLOUD_LLM = "true";
    delete process.env.ANIMA_DISABLE_OPENAI;
    delete process.env.ANIMA_DISABLE_GROQ;
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

  it("does not enable ensemble for custom/anima self-hosted modes", () => {
    process.env.ANIMA_LLM_PROVIDER = "custom";
    expect(isEnsembleMode()).toBe(false);
    process.env.ANIMA_LLM_PROVIDER = "anima";
    expect(isEnsembleMode()).toBe(false);
  });

  it("lists Gemini + Groq + ChatGPT as opt-in ensemble minds", () => {
    expect(getEnsembleMinds("standard")).toEqual(["gemini", "groq", "openai"]);
    expect(isEnsembleMode()).toBe(true);
  });

  it("stays off even with ANIMA_LLM_PROVIDER=ensemble unless ANIMA_ALLOW_CLOUD_LLM=true", () => {
    delete process.env.ANIMA_ALLOW_CLOUD_LLM;
    expect(isEnsembleMode()).toBe(false);
    process.env.ANIMA_LLM_ENSEMBLE = "true";
    expect(isEnsembleMode()).toBe(false);
    process.env.ANIMA_ALLOW_CLOUD_LLM = "true";
    expect(isEnsembleMode()).toBe(true);
  });

  it("skips sticky-blocked Groq when selecting minds", () => {
    recordProviderFailure("groq", {
      status: 429,
      message: "quota exhausted",
    });
    expect(isGroqStickySkipped()).toBe(true);
    expect(getEnsembleMinds("standard")).toEqual(["gemini", "openai"]);
    expect(getEnsembleMinds("standard")).not.toContain("groq");
  });

  it("gathers parallel drafts and synthesizes a combined reply", async () => {
    geminiCompletionMock
      .mockResolvedValueOnce(fakeCompletion("Gemini draft about longing."))
      .mockResolvedValueOnce(fakeCompletion("Combined in-character reply."));
    createMock
      .mockResolvedValueOnce(fakeCompletion("Groq draft with speed."))
      .mockResolvedValueOnce(fakeCompletion("ChatGPT draft with clarity."));

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
    expect(result.minds.sort()).toEqual(["gemini", "groq", "openai"].sort());
    expect(result.drafts).toHaveLength(3);
    expect(result.provider).toBe("gemini");
    expect(progress).toContain("gathering");
    expect(progress).toContain("combining");
    expect(progress).toContain("streaming");
  });

  it("uses a single successful mind without synthesis", async () => {
    process.env.ANIMA_DISABLE_GROQ = "true";
    process.env.ANIMA_DISABLE_OPENAI = "true";
    geminiCompletionMock.mockResolvedValueOnce(
      fakeCompletion("Only Gemini answered."),
    );

    const result = await createEnsembleChatReply({
      tier: "standard",
      model: "gpt-4o",
      maxTokens: 800,
      messages: [{ role: "user", content: "hi" }],
    });

    expect(result.combined).toBe(false);
    expect(result.provider).toBe("gemini");
    expect(result.content).toBe("Only Gemini answered.");
    expect(result.minds).toEqual(["gemini"]);
    expect(createMock).not.toHaveBeenCalled();
    expect(geminiCompletionMock).toHaveBeenCalledTimes(1);
  });

  it("records sticky failure when a mind returns unusable error", async () => {
    geminiCompletionMock.mockResolvedValueOnce(fakeCompletion("Gemini draft."));
    createMock
      .mockRejectedValueOnce({
        status: 429,
        message: "groq quota exhausted",
      })
      .mockRejectedValueOnce({ status: 401, message: "openai dead" });

    const result = await createEnsembleChatReply({
      tier: "standard",
      model: "gpt-4o",
      maxTokens: 800,
      messages: [{ role: "user", content: "hello" }],
    });

    expect(result.combined).toBe(false);
    expect(result.provider).toBe("gemini");
    expect(isGroqStickySkipped()).toBe(true);
    expect(getEnsembleMinds("standard")).not.toContain("groq");
  });

  it("aborts timed-out work via AbortSignal", async () => {
    const seen: AbortSignal[] = [];
    await expect(
      withAbortTimeout(
        async (signal) => {
          seen.push(signal);
          await new Promise<void>((_resolve, reject) => {
            signal.addEventListener("abort", () =>
              reject(Object.assign(new Error("Aborted"), { name: "AbortError" })),
            );
          });
          return "never";
        },
        30,
        "Slow mind",
      ),
    ).rejects.toThrow(/timed out after 30ms/);
    expect(seen[0]?.aborted).toBe(true);
  });

  it("reports draft fallback metadata when synthesis returns empty", async () => {
    geminiCompletionMock
      .mockResolvedValueOnce(fakeCompletion("Gemini draft."))
      .mockResolvedValueOnce(fakeCompletion(""));
    createMock
      .mockResolvedValueOnce(fakeCompletion("Groq draft."))
      .mockResolvedValueOnce(fakeCompletion("ChatGPT draft."));

    const result = await createEnsembleChatReply({
      tier: "standard",
      model: "gpt-4o",
      maxTokens: 800,
      messages: [{ role: "user", content: "hello" }],
    });

    expect(result.combined).toBe(false);
    expect(["gemini", "groq", "openai"]).toContain(result.provider);
    expect(result.content.length).toBeGreaterThan(0);
    expect(result.synthesizer).toBe(result.provider);
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
