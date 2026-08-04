import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createGeminiChatCompletion,
  createGeminiChatStream,
  extractCandidateText,
  geminiNativeBaseUrl,
  thinkingBudgetForModel,
  toGeminiGenerateRequest,
} from "../src/lib/geminiNative";

describe("geminiNativeBaseUrl", () => {
  const SAVED = { ...process.env };
  afterEach(() => {
    process.env = { ...SAVED };
  });

  it("strips a legacy OpenAI-compatible suffix", () => {
    process.env.GEMINI_BASE_URL =
      "https://generativelanguage.googleapis.com/v1beta/openai/";
    expect(geminiNativeBaseUrl()).toBe(
      "https://generativelanguage.googleapis.com/v1beta",
    );
  });

  it("honors GEMINI_NATIVE_BASE_URL", () => {
    process.env.GEMINI_NATIVE_BASE_URL = "https://example.test/v1beta/";
    expect(geminiNativeBaseUrl()).toBe("https://example.test/v1beta");
  });
});

describe("thinkingBudgetForModel", () => {
  const SAVED = { ...process.env };
  afterEach(() => {
    process.env = { ...SAVED };
  });

  it("disables thinking for Flash chat models by default", () => {
    delete process.env.ANIMA_GEMINI_THINKING_BUDGET;
    expect(thinkingBudgetForModel("gemini-2.5-flash")).toBe(0);
    expect(thinkingBudgetForModel("gemini-2.5-flash-lite")).toBe(0);
    expect(thinkingBudgetForModel("gemini-3.1-flash-lite")).toBe(0);
  });

  it("uses a modest budget for Pro (cannot fully disable)", () => {
    delete process.env.ANIMA_GEMINI_THINKING_BUDGET;
    expect(thinkingBudgetForModel("gemini-2.5-pro")).toBe(1024);
  });

  it("honors ANIMA_GEMINI_THINKING_BUDGET override", () => {
    process.env.ANIMA_GEMINI_THINKING_BUDGET = "512";
    expect(thinkingBudgetForModel("gemini-2.5-flash")).toBe(512);
  });
});

describe("extractCandidateText", () => {
  it("skips thought parts so only the visible reply is returned", () => {
    expect(
      extractCandidateText({
        candidates: [
          {
            content: {
              parts: [
                { text: "secret reasoning", thought: true },
                { text: "Hello there" },
              ],
            },
          },
        ],
      }),
    ).toBe("Hello there");
  });
});

describe("toGeminiGenerateRequest", () => {
  const SAVED = { ...process.env };
  afterEach(() => {
    process.env = { ...SAVED };
  });

  it("maps system-only prompts to a single user turn", () => {
    delete process.env.ANIMA_GEMINI_THINKING_BUDGET;
    const body = toGeminiGenerateRequest(
      [{ role: "system", content: "You are Serenity." }],
      { maxTokens: 1024, model: "gemini-2.5-flash" },
    );
    expect(body.systemInstruction).toBeUndefined();
    expect(body.contents).toEqual([
      { role: "user", parts: [{ text: "You are Serenity." }] },
    ]);
    expect(body.generationConfig?.maxOutputTokens).toBe(1024);
    expect(body.generationConfig?.thinkingConfig).toEqual({
      thinkingBudget: 0,
    });
  });

  it("keeps systemInstruction when user/assistant turns exist", () => {
    const body = toGeminiGenerateRequest([
      { role: "system", content: "Stay calm." },
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi" },
      { role: "user", content: "Continue" },
    ]);
    expect(body.systemInstruction).toEqual({
      parts: [{ text: "Stay calm." }],
    });
    expect(body.contents.map((c) => c.role)).toEqual([
      "user",
      "model",
      "user",
    ]);
  });

  it("prepends a user turn when history starts with the model", () => {
    const body = toGeminiGenerateRequest([
      { role: "assistant", content: "Already speaking" },
      { role: "user", content: "ok" },
    ]);
    expect(body.contents[0]).toEqual({
      role: "user",
      parts: [{ text: "(continue)" }],
    });
  });
});

describe("createGeminiChatCompletion / createGeminiChatStream", () => {
  const SAVED = { ...process.env };
  const fetchMock = vi.fn();

  afterEach(() => {
    process.env = { ...SAVED };
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it("sends x-goog-api-key (not Bearer) for AQ auth keys", async () => {
    process.env.GEMINI_API_KEY = "AQ.native-test-key";
    delete process.env.ANIMA_GEMINI_THINKING_BUDGET;
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          candidates: [
            { content: { parts: [{ text: "hello from native" }] } },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await createGeminiChatCompletion({
      model: "gemini-2.5-flash",
      maxTokens: 128,
      messages: [{ role: "user", content: "hi" }],
    });

    expect(result.choices[0]?.message?.content).toBe("hello from native");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/models/gemini-2.5-flash:generateContent");
    expect(url).not.toContain("/openai");
    const headers = init.headers as Record<string, string>;
    expect(headers["x-goog-api-key"]).toBe("AQ.native-test-key");
    expect(headers.Authorization).toBeUndefined();
    const sent = JSON.parse(String(init.body)) as {
      generationConfig?: { thinkingConfig?: { thinkingBudget?: number } };
    };
    expect(sent.generationConfig?.thinkingConfig?.thinkingBudget).toBe(0);
  });

  it("throws when Gemini returns MAX_TOKENS with no visible text", async () => {
    process.env.GEMINI_API_KEY = "AQ.empty";
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          candidates: [{ finishReason: "MAX_TOKENS" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await expect(
      createGeminiChatCompletion({
        model: "gemini-2.5-flash",
        maxTokens: 128,
        messages: [{ role: "user", content: "hi" }],
      }),
    ).rejects.toMatchObject({
      name: "GeminiApiError",
      code: "empty_visible_text",
      message: expect.stringMatching(/finishReason=MAX_TOKENS/i),
    });
  });

  it("maps HTTP auth failures onto GeminiApiError with status", async () => {
    process.env.GEMINI_API_KEY = "AQ.bad";
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: {
            code: 401,
            message: "API key not valid. Please pass a valid API key.",
            status: "UNAUTHENTICATED",
          },
        }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      ),
    );

    await expect(
      createGeminiChatCompletion({
        model: "gemini-2.5-flash",
        maxTokens: 128,
        messages: [{ role: "user", content: "hi" }],
      }),
    ).rejects.toMatchObject({
      name: "GeminiApiError",
      status: 401,
      message: expect.stringMatching(/API key not valid/i),
    });
  });

  it("parses SSE stream chunks into OpenAI-shaped deltas", async () => {
    process.env.GEMINI_API_KEY = "AQ.stream";
    vi.stubGlobal("fetch", fetchMock);
    const sse =
      'data: {"candidates":[{"content":{"parts":[{"text":"Hel"}]}}]}\n\n' +
      'data: {"candidates":[{"content":{"parts":[{"text":"lo"}]}}]}\n\n';
    fetchMock.mockResolvedValueOnce(
      new Response(sse, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    );

    const stream = await createGeminiChatStream({
      model: "gemini-2.5-flash",
      maxTokens: 128,
      messages: [{ role: "user", content: "hi" }],
    });

    const parts: string[] = [];
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) parts.push(delta);
    }
    expect(parts.join("")).toBe("Hello");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(":streamGenerateContent?alt=sse");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe(
      "AQ.stream",
    );
  });
});
