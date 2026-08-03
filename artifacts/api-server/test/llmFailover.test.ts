import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createMock = vi.fn();

vi.mock("../src/lib/openaiClient", () => {
  const client = {
    chat: { completions: { create: (...args: unknown[]) => createMock(...args) } },
  };
  return {
    hasOpenAIKey: () => Boolean(process.env.OPENAI_API_KEY?.trim()),
    hasXaiKey: () => Boolean(process.env.XAI_API_KEY?.trim()),
    getOpenAIClient: () => client,
    getXaiClient: () => (process.env.XAI_API_KEY?.trim() ? client : null),
    normalizeApiKey: (raw: string | undefined) => {
      if (!raw) return null;
      return raw.trim() || null;
    },
    resetLlmClientsForTests: () => {},
  };
});

import {
  createChatStreamWithFailover,
  isProviderUnusableError,
  resetLlmFailoverStateForTests,
  resolveXaiModel,
} from "../src/lib/llmFailover";

function fakeStream(label = "ok") {
  return {
    async *[Symbol.asyncIterator]() {
      yield { choices: [{ delta: { content: label } }] };
    },
  };
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

describe("resolveXaiModel", () => {
  const SAVED = { ...process.env };
  afterEach(() => {
    process.env = { ...SAVED };
  });

  it("defaults per tier and honors env overrides", () => {
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
});

describe("createChatStreamWithFailover", () => {
  const SAVED = { ...process.env };

  beforeEach(() => {
    process.env = { ...SAVED };
    process.env.OPENAI_API_KEY = "sk-test-openai";
    process.env.XAI_API_KEY = "xai-test";
    delete process.env.ANIMA_XAI_MODEL;
    delete process.env.ANIMA_XAI_MODEL_LIGHT;
    delete process.env.ANIMA_XAI_MODEL_STANDARD;
    delete process.env.ANIMA_XAI_MODEL_HEAVY;
    resetLlmFailoverStateForTests();
    createMock.mockReset();
  });

  afterEach(() => {
    process.env = { ...SAVED };
    resetLlmFailoverStateForTests();
  });

  it("returns OpenAI stream on success without failover", async () => {
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

  it("retries OpenAI standard model on model-unavailable before giving up", async () => {
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

    const second = await createChatStreamWithFailover({
      tier: "standard",
      model: "gpt-4o",
      maxTokens: 8192,
      messages: [{ role: "user", content: "two" }],
    });

    expect(second.provider).toBe("xai");
    expect(second.failedOver).toBe(false);
    // First turn: OpenAI fail + xAI ok. Second turn: xAI only (sticky).
    expect(createMock).toHaveBeenCalledTimes(3);
    expect(createMock.mock.calls[2][0].model).toBe("grok-3");
  });

  it("surfaces a helpful error when OpenAI is out of credits and XAI is unset", async () => {
    delete process.env.XAI_API_KEY;
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
    ).rejects.toThrow(/XAI_API_KEY/);
  });
});
