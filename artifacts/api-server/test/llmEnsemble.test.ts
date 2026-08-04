import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createMock = vi.fn();

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
    hasGatewayAuth: () =>
      Boolean(
        process.env.AI_GATEWAY_API_KEY?.trim() || process.env.VERCEL_OIDC_TOKEN?.trim(),
      ),
    getOpenAIClient: () => client,
    getXaiClient: () => (process.env.XAI_API_KEY?.trim() ? client : null),
    getGeminiClient: () => null,
    getKimiClient: () =>
      process.env.KIMI_API_KEY?.trim() || process.env.MOONSHOT_API_KEY?.trim()
        ? client
        : null,
    getGatewayClient: () =>
      process.env.AI_GATEWAY_API_KEY?.trim() || process.env.VERCEL_OIDC_TOKEN?.trim()
        ? client
        : null,
    normalizeApiKey: (raw: string | undefined) => {
      if (!raw) return null;
      return raw.trim() || null;
    },
    resetLlmClientsForTests: () => {},
  };
});

import {
  chunkTextAsStream,
  createEnsembleChatReply,
  getEnsembleMinds,
  isEnsembleMode,
  withAbortTimeout,
} from "../src/lib/llmEnsemble";
import {
  isXaiStickySkipped,
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
  });

  afterEach(() => {
    process.env = { ...SAVED };
    resetLlmFailoverStateForTests();
  });

  it("lists available minds without Gemini", () => {
    expect(getEnsembleMinds("standard")).toEqual(["kimi", "xai", "openai"]);
    expect(getEnsembleMinds("standard")).not.toContain("gemini");
    expect(isEnsembleMode()).toBe(true);
  });

  it("skips sticky-blocked xAI when selecting minds", () => {
    recordProviderFailure("xai", {
      status: 403,
      message:
        '403 "Your newly created team doesn\'t have any credits or licenses yet. You can purchase those on https://console.x.ai/team/abc."',
    });
    expect(isXaiStickySkipped()).toBe(true);
    expect(getEnsembleMinds("standard")).toEqual(["kimi", "openai"]);
    expect(getEnsembleMinds("standard")).not.toContain("xai");
  });

  it("gathers parallel drafts and synthesizes a combined reply", async () => {
    createMock
      .mockResolvedValueOnce(fakeCompletion("Kimi draft about longing."))
      .mockResolvedValueOnce(fakeCompletion("Grok draft with wit."))
      .mockResolvedValueOnce(fakeCompletion("ChatGPT draft with clarity."))
      .mockResolvedValueOnce(fakeCompletion("Combined in-character reply."));

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
    expect(result.minds.sort()).toEqual(["kimi", "openai", "xai"].sort());
    expect(result.drafts).toHaveLength(3);
    expect(result.provider).toBe("kimi");
    expect(progress).toContain("gathering");
    expect(progress).toContain("combining");
    expect(progress).toContain("streaming");
  });

  it("uses a single successful mind without synthesis", async () => {
    process.env.ANIMA_DISABLE_XAI = "true";
    process.env.ANIMA_DISABLE_OPENAI = "true";
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
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("records sticky failure when a mind returns unusable error", async () => {
    createMock
      .mockResolvedValueOnce(fakeCompletion("Kimi draft."))
      .mockRejectedValueOnce({
        status: 403,
        message: "no credits or licenses yet https://console.x.ai/team/abc",
      })
      .mockRejectedValueOnce({ status: 401, message: "openai dead" })
      // Only Kimi survived → no synthesis
      ;

    const result = await createEnsembleChatReply({
      tier: "standard",
      model: "gpt-4o",
      maxTokens: 800,
      messages: [{ role: "user", content: "hello" }],
    });

    expect(result.combined).toBe(false);
    expect(result.provider).toBe("kimi");
    expect(isXaiStickySkipped()).toBe(true);
    expect(getEnsembleMinds("standard")).not.toContain("xai");
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
    createMock
      .mockResolvedValueOnce(fakeCompletion("Kimi draft."))
      .mockResolvedValueOnce(fakeCompletion("Grok draft."))
      .mockResolvedValueOnce(fakeCompletion("ChatGPT draft."))
      // Kimi synthesis returns empty → fallback to a draft
      .mockResolvedValueOnce(fakeCompletion(""));

    const result = await createEnsembleChatReply({
      tier: "standard",
      model: "gpt-4o",
      maxTokens: 800,
      messages: [{ role: "user", content: "hello" }],
    });

    expect(result.combined).toBe(false);
    expect(["kimi", "xai", "openai"]).toContain(result.provider);
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
