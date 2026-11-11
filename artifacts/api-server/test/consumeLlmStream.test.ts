import { describe, expect, it } from "vitest";
import {
  chunkIsReasoning,
  chunkTextDelta,
  consumeLlmStream,
  interruptedStreamKeepsReply,
  LlmStreamTimeoutError,
} from "../src/lib/consumeLlmStream";

async function* fromChunks(
  chunks: Array<{ content?: string; reasoning?: string }>,
) {
  for (const chunk of chunks) {
    yield {
      choices: [
        {
          delta: {
            ...(chunk.content != null ? { content: chunk.content } : {}),
            ...(chunk.reasoning != null ? { reasoning: chunk.reasoning } : {}),
          },
        },
      ],
    };
  }
}

async function* hangForever(): AsyncGenerator<never> {
  await new Promise(() => {});
}

async function* hangAfter(
  chunks: Array<{ content?: string; reasoning?: string }>,
) {
  yield* fromChunks(chunks);
  await new Promise(() => {});
}

describe("chunkTextDelta / chunkIsReasoning", () => {
  it("reads visible content deltas", () => {
    expect(
      chunkTextDelta({ choices: [{ delta: { content: "Hi" } }] }),
    ).toBe("Hi");
    expect(chunkTextDelta({ choices: [{ delta: {} }] })).toBe("");
  });

  it("detects reasoning-only chunks so they count as activity", () => {
    expect(
      chunkIsReasoning({ choices: [{ delta: { reasoning: "hmm" } }] }),
    ).toBe(true);
    expect(
      chunkIsReasoning({
        choices: [{ delta: { reasoning_content: "think" } }],
      }),
    ).toBe(true);
    expect(
      chunkIsReasoning({ choices: [{ delta: { content: "Hi" } }] }),
    ).toBe(false);
  });
});

describe("consumeLlmStream", () => {
  it("stops early when stopWhen matches and ends the upstream iterator", async () => {
    let pulls = 0;
    let upstreamEnded = false;
    async function* source() {
      try {
        const parts = ["The room stays ", "quiet while she ", "watches the door ", "and keeps going."];
        for (const part of parts) {
          pulls += 1;
          yield { choices: [{ delta: { content: part } }] };
        }
      } finally {
        upstreamEnded = true;
      }
    }
    const result = await consumeLlmStream(source(), {
      stopWhen: (visible) => visible.length >= 20,
    });
    expect(result.stoppedEarly).toBe(true);
    expect(result.timedOut).toBe(false);
    expect(result.content.length).toBeGreaterThanOrEqual(20);
    expect(result.content).not.toContain("keeps going");
    expect(pulls).toBeLessThan(4);
    expect(upstreamEnded).toBe(true);
  });

  it("awaits iterator.return before resolving when stopWhen fires", async () => {
    let releaseReturn: () => void = () => {};
    const returnGate = new Promise<void>((resolve) => {
      releaseReturn = resolve;
    });
    let returnFinished = false;
    let pulls = 0;
    const stream = {
      [Symbol.asyncIterator]() {
        return {
          async next() {
            pulls += 1;
            if (pulls === 1) {
              return {
                done: false as const,
                value: { choices: [{ delta: { content: "The room stays quiet while she watches" } }] },
              };
            }
            return {
              done: false as const,
              value: { choices: [{ delta: { content: " the rest that must not be pulled" } }] },
            };
          },
          async return() {
            await returnGate;
            returnFinished = true;
            return { done: true as const, value: undefined };
          },
        };
      },
    };

    let settled = false;
    const pending = consumeLlmStream(stream, {
      stopWhen: () => true,
    }).then((result) => {
      settled = true;
      return result;
    });

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(settled).toBe(false);
    expect(returnFinished).toBe(false);
    expect(pulls).toBe(1);

    releaseReturn();
    const result = await pending;
    expect(returnFinished).toBe(true);
    expect(settled).toBe(true);
    expect(result.stoppedEarly).toBe(true);
    expect(result.content).toContain("The room stays quiet");
    expect(result.content).not.toContain("must not be pulled");
  });

  it("accumulates content until the upstream iterator ends", async () => {
    const deltas: string[] = [];
    const result = await consumeLlmStream(fromChunks([{ content: "Hel" }, { content: "lo" }]), {
      onDelta: (d) => deltas.push(d),
    });
    expect(result.content).toBe("Hello");
    expect(result.timedOut).toBe(false);
    expect(deltas).toEqual(["Hel", "lo"]);
  });

  it("fires onReasoning once for reasoning-only prefixes", async () => {
    let reasoning = 0;
    const result = await consumeLlmStream(
      fromChunks([{ reasoning: "plan" }, { reasoning: "more" }, { content: "Hi" }]),
      { onReasoning: () => reasoning++ },
    );
    expect(result.content).toBe("Hi");
    expect(reasoning).toBe(1);
  });

  it("resolves with partial text when the stream stalls after tokens", async () => {
    const result = await consumeLlmStream(hangAfter([{ content: "Kept" }]), {
      firstChunkMs: 20,
      stallMs: 30,
      totalMs: 200,
    });
    expect(result.content).toBe("Kept");
    expect(result.timedOut).toBe(true);
    expect(result.interrupted).toBe(false);
  });

  it("throws when no content arrives before the first-chunk deadline", async () => {
    await expect(
      consumeLlmStream(hangForever(), {
        firstChunkMs: 25,
        stallMs: 25,
        totalMs: 80,
      }),
    ).rejects.toBeInstanceOf(LlmStreamTimeoutError);
  });

  it("does not trip first-chunk when reasoning arrives and content follows after the stall window", async () => {
    async function* reasoningThenContent() {
      yield {
        choices: [{ delta: { reasoning: "plan the reply" } }],
      };
      await new Promise((resolve) => setTimeout(resolve, 40));
      yield {
        choices: [{ delta: { content: "Hi" } }],
      };
    }

    const result = await consumeLlmStream(reasoningThenContent(), {
      firstChunkMs: 80,
      stallMs: 20,
      totalMs: 200,
    });
    expect(result.content).toBe("Hi");
    expect(result.timedOut).toBe(false);
  });

  it("keeps the first-chunk window after reasoning-only activity instead of the short stall", async () => {
    async function* reasoningThenHang() {
      yield {
        choices: [{ delta: { reasoning: "still thinking" } }],
      };
      await new Promise(() => {});
    }

    const started = Date.now();
    const result = await consumeLlmStream(reasoningThenHang(), {
      firstChunkMs: 70,
      stallMs: 20,
      totalMs: 200,
    });
    expect(Date.now() - started).toBeGreaterThanOrEqual(60);
    expect(result.content).toBe("still thinking");
    expect(result.timedOut).toBe(true);
  });

  it("strips DeepSeek think tags and keeps the answer", async () => {
    const result = await consumeLlmStream(
      fromChunks([
        { content: "<think>plan" },
        { content: " it</think>\n\nStay close." },
      ]),
    );
    expect(result.content).toBe("Stay close.");
  });

  it("does not persist an empty reply when the model returned think-only", async () => {
    const deltas: string[] = [];
    const result = await consumeLlmStream(
      fromChunks([{ content: "<think>I hear you. Stay close.</think>" }]),
      { onDelta: (d) => deltas.push(d) },
    );
    expect(result.content).toBe("I hear you. Stay close.");
    expect(deltas.join("")).toBe("I hear you. Stay close.");
  });

  it("treats DeepSeek <think> tokens as first-chunk activity, not a stall", async () => {
    let reasoning = 0;
    async function* thinkThenAnswer() {
      yield { choices: [{ delta: { content: "<think>plan" } }] };
      await new Promise((resolve) => setTimeout(resolve, 40));
      yield { choices: [{ delta: { content: " it</think>\n\nStay close." } }] };
    }

    const result = await consumeLlmStream(thinkThenAnswer(), {
      onReasoning: () => reasoning++,
      firstChunkMs: 80,
      stallMs: 20,
      totalMs: 200,
    });
    expect(result.content).toBe("Stay close.");
    expect(reasoning).toBe(1);
  });

  it("emits unclosed think inner text without waiting for </think>", async () => {
    const inner = `${"Stay close. ".repeat(60)}I hear you.`;
    const deltas: string[] = [];
    const result = await consumeLlmStream(
      fromChunks([{ content: `<think>${inner}` }]),
      { onDelta: (d) => deltas.push(d) },
    );
    expect(result.content).toBe(inner.trim());
    expect(deltas.join("")).toBe(inner.trim());
    expect(result.timedOut).toBe(false);
  });

  it("notifies on the first upstream chunk before visible text is released", async () => {
    const events: string[] = [];
    const result = await consumeLlmStream(
      fromChunks([{ content: "Hi" }, { content: " there" }]),
      {
        onActivity: () => events.push("activity"),
        onDelta: () => events.push("delta"),
      },
    );
    expect(result.content).toBe("Hi there");
    expect(events).toEqual(["activity", "delta", "activity", "delta"]);
  });

  it("keeps visible text when the upstream iterator throws", async () => {
    async function* dropMidReply() {
      yield { choices: [{ delta: { content: "You came back. I was thin" } }] };
      throw Object.assign(
        new Error("Ollama /api/chat stream ended before the reply finished"),
        { name: "APIConnectionError", code: "ECONNRESET" },
      );
    }

    const result = await consumeLlmStream(dropMidReply());
    expect(result.interrupted).toBe(true);
    expect(result.timedOut).toBe(true);
    expect(result.stoppedEarly).toBeUndefined();
    expect(result.content).toBe("You came back. I was thin");
    expect(interruptedStreamKeepsReply(result)).toBe(true);
  });

  it("rethrows an upstream error when no visible text arrived", async () => {
    async function* dropImmediately() {
      throw new Error("Ollama /api/chat stream ended before the reply finished");
    }

    await expect(consumeLlmStream(dropImmediately())).rejects.toThrow(
      /ended before the reply finished/,
    );
  });

  it("keeps text already yielded when a later chunk throws an api error", async () => {
    async function* errorLineAfterText() {
      yield { choices: [{ delta: { content: "Hello there. " } }] };
      throw Object.assign(new Error("llama runner process has terminated"), {
        name: "OllamaChatError",
        code: "api_error",
      });
    }

    const result = await consumeLlmStream(errorLineAfterText());
    expect(result.interrupted).toBe(true);
    expect(result.content).toContain("Hello there.");
    expect(interruptedStreamKeepsReply(result)).toBe(true);
  });
});
