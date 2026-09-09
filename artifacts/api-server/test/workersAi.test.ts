import { afterEach, describe, expect, it } from "vitest";
import { resetAiBindingForTests, setAiBinding } from "../src/lib/aiBinding";
import {
  completeWorkersAi,
  extractWorkersAiReasoning,
  extractWorkersAiText,
  formatWorkersAiError,
  streamWorkersAi,
  WORKERS_AI_CHAT_MODEL,
  WorkersAiRequestError,
  workersAiErrorMessage,
  workersAiMessages,
} from "../src/lib/workersAi";

afterEach(() => {
  resetAiBindingForTests();
});

function sseByteStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

async function collectText(
  stream: AsyncIterable<{ choices?: Array<{ delta?: { content?: string; reasoning?: string } }> }>,
): Promise<{ texts: string[]; reasoning: string[] }> {
  const texts: string[] = [];
  const reasoning: string[] = [];
  for await (const part of stream) {
    const content = part.choices?.[0]?.delta?.content;
    if (content) texts.push(content);
    const think = part.choices?.[0]?.delta?.reasoning;
    if (think) reasoning.push(think);
  }
  return { texts, reasoning };
}

describe("workersAi helpers", () => {
  it("extracts the response string from Workers AI shapes", () => {
    expect(extractWorkersAiText({ response: "hello" })).toBe("hello");
    expect(extractWorkersAiText({ result: { response: "nested" } })).toBe("nested");
    expect(extractWorkersAiText("plain")).toBe("plain");
    expect(extractWorkersAiText(null)).toBe("");
  });

  it("extracts OpenAI-compatible gateway chunks", () => {
    expect(
      extractWorkersAiText({
        choices: [{ delta: { content: "via gateway" } }],
      }),
    ).toBe("via gateway");
    expect(
      extractWorkersAiText({
        choices: [{ message: { content: "complete" } }],
      }),
    ).toBe("complete");
    expect(
      extractWorkersAiReasoning({
        choices: [{ delta: { reasoning: "think" } }],
      }),
    ).toBe("think");
  });

  it("surfaces Workers AI error objects instead of an empty reply", () => {
    expect(
      workersAiErrorMessage({
        success: false,
        errors: [{ message: "model overloaded" }],
      }),
    ).toBe("model overloaded");
    expect(() =>
      extractWorkersAiText({ error: { message: "rate limited" } }),
    ).toThrow(WorkersAiRequestError);
    expect(formatWorkersAiError(new Error("3006: inference failed"))).toMatch(
      /DeepSeek on Workers AI failed: 3006: inference failed/,
    );
  });

  it("stringifies non-text message content for the binding", () => {
    expect(
      workersAiMessages([
        { role: "user", content: "hi" },
        { role: "assistant", content: [{ type: "text", text: "yo" }] as never },
      ]),
    ).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: JSON.stringify([{ type: "text", text: "yo" }]) },
    ]);
  });

  it("completes through the binding model id", async () => {
    setAiBinding({
      run: async (model, options) => {
        expect(model).toBe(WORKERS_AI_CHAT_MODEL);
        expect(options.max_tokens).toBe(16);
        return { response: "ok" };
      },
    });
    await expect(
      completeWorkersAi({
        messages: [{ role: "user", content: "hi" }],
        maxTokens: 16,
      }),
    ).resolves.toBe("ok");
  });

  it("wraps a non-stream binding result as a single chat chunk", async () => {
    setAiBinding({
      run: async (_model, options) => {
        expect(options.stream).toBe(true);
        return { response: "chunk" };
      },
    });
    const stream = await streamWorkersAi({
      messages: [{ role: "user", content: "hi" }],
      maxTokens: 32,
    });
    const { texts } = await collectText(stream);
    expect(texts).toEqual(["chunk"]);
  });

  it("decodes a WHATWG ReadableStream of SSE bytes (not as empty JSON objects)", async () => {
    setAiBinding({
      run: async (_model, options) => {
        expect(options.stream).toBe(true);
        return sseByteStream([
          'data: {"response":"Hello"}\n\n',
          'data: {"response":" world"}\n\n',
        ]);
      },
    });
    const stream = await streamWorkersAi({
      messages: [{ role: "user", content: "hi" }],
      maxTokens: 32,
    });
    const { texts } = await collectText(stream);
    expect(texts.join("")).toBe("Hello world");
  });

  it("decodes an async-iterable of Uint8Array SSE bytes", async () => {
    async function* byteChunks() {
      const encoder = new TextEncoder();
      yield encoder.encode('data: {"response":"byte"}\n\n');
      yield encoder.encode('data: {"response":"-stream"}\n\n');
    }
    setAiBinding({
      run: async () => byteChunks(),
    });
    const stream = await streamWorkersAi({
      messages: [{ role: "user", content: "hi" }],
      maxTokens: 16,
    });
    const { texts } = await collectText(stream);
    expect(texts.join("")).toBe("byte-stream");
  });

  it("reads OpenAI-style SSE from a ReadableStream", async () => {
    setAiBinding({
      run: async () =>
        sseByteStream([
          'data: {"choices":[{"delta":{"content":"Open"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"AI"}}]}\n\n',
        ]),
    });
    const stream = await streamWorkersAi({
      messages: [{ role: "user", content: "hi" }],
      maxTokens: 16,
    });
    const { texts } = await collectText(stream);
    expect(texts.join("")).toBe("OpenAI");
  });

  it("counts reasoning-only gateway deltas as activity", async () => {
    setAiBinding({
      run: async () =>
        sseByteStream([
          'data: {"choices":[{"delta":{"reasoning":"plan"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n',
        ]),
    });
    const stream = await streamWorkersAi({
      messages: [{ role: "user", content: "hi" }],
      maxTokens: 16,
    });
    const { texts, reasoning } = await collectText(stream);
    expect(reasoning).toEqual(["plan"]);
    expect(texts).toEqual(["Hi"]);
  });

  it("falls back to a non-stream completion when the stream yields no text", async () => {
    let calls = 0;
    setAiBinding({
      run: async (_model, options) => {
        calls += 1;
        if (options.stream) return sseByteStream(["data: {\"response\":\"\"}\n\n"]);
        return { response: "fallback reply" };
      },
    });
    const stream = await streamWorkersAi({
      messages: [{ role: "user", content: "hi" }],
      maxTokens: 16,
    });
    const { texts } = await collectText(stream);
    expect(texts).toEqual(["fallback reply"]);
    expect(calls).toBe(2);
  });

  it("strips DeepSeek think tags and keeps a think-only completion", async () => {
    setAiBinding({
      run: async () => ({ response: "<think>Stay close.</think>" }),
    });
    await expect(
      completeWorkersAi({
        messages: [{ role: "user", content: "hi" }],
        maxTokens: 16,
      }),
    ).resolves.toBe("Stay close.");
  });

  it("keeps a long unclosed <think> completion instead of returning empty", async () => {
    const inner = `${"I hear you. ".repeat(80)}Stay close.`;
    setAiBinding({
      run: async () => ({ response: `<think>${inner}` }),
    });
    await expect(
      completeWorkersAi({
        messages: [{ role: "user", content: "hi" }],
        maxTokens: 16,
      }),
    ).resolves.toBe(inner.trim());
  });

  it("uses reasoning text when the response field is empty", async () => {
    setAiBinding({
      run: async () => ({ response: "", reasoning: "I hear you." }),
    });
    await expect(
      completeWorkersAi({
        messages: [{ role: "user", content: "hi" }],
        maxTokens: 16,
      }),
    ).resolves.toBe("I hear you.");
  });

  it("throws a clear Workers AI error when completion is empty", async () => {
    setAiBinding({
      run: async () => ({ response: "" }),
    });
    await expect(
      completeWorkersAi({
        messages: [{ role: "user", content: "hi" }],
        maxTokens: 16,
      }),
    ).rejects.toThrow(/empty reply/i);
  });
});
