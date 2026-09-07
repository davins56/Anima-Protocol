import { describe, expect, it } from "vitest";
import {
  chunkIsReasoning,
  chunkTextDelta,
  consumeLlmStream,
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
    await expect(
      consumeLlmStream(reasoningThenHang(), {
        firstChunkMs: 70,
        stallMs: 20,
        totalMs: 200,
      }),
    ).rejects.toBeInstanceOf(LlmStreamTimeoutError);
    expect(Date.now() - started).toBeGreaterThanOrEqual(60);
  });
});
