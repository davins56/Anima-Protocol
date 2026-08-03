import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createGeminiChatCompletion,
  createGeminiChatStream,
  geminiNativeBaseUrl,
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

describe("toGeminiGenerateRequest", () => {
  it("maps system-only prompts to a single user turn", () => {
    const body = toGeminiGenerateRequest(
      [{ role: "system", content: "You are Serenity." }],
      { maxTokens: 1024 },
    );
    expect(body.systemInstruction).toBeUndefined();
    expect(body.contents).toEqual([
      { role: "user", parts: [{ text: "You are Serenity." }] },
    ]);
    expect(body.generationConfig?.maxOutputTokens).toBe(1024);
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
