import { afterEach, describe, expect, it } from "vitest";
import { resetAiBindingForTests, setAiBinding } from "../src/lib/aiBinding";
import {
  completeWorkersAi,
  extractWorkersAiText,
  streamWorkersAi,
  WORKERS_AI_CHAT_MODEL,
  workersAiMessages,
} from "../src/lib/workersAi";

afterEach(() => {
  resetAiBindingForTests();
});

describe("workersAi helpers", () => {
  it("extracts the response string from Workers AI shapes", () => {
    expect(extractWorkersAiText({ response: "hello" })).toBe("hello");
    expect(extractWorkersAiText({ result: { response: "nested" } })).toBe("nested");
    expect(extractWorkersAiText("plain")).toBe("plain");
    expect(extractWorkersAiText(null)).toBe("");
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
    const texts: string[] = [];
    for await (const part of stream) {
      const content = part.choices[0]?.delta?.content;
      if (content) texts.push(content);
    }
    expect(texts).toEqual(["chunk"]);
  });
});
