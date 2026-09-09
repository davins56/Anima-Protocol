import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { streamChatReply } from "./streamChatReply";

async function* fromEvents(events) {
  for (const event of events) yield event;
}

describe("streamChatReply", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "requestAnimationFrame",
      (cb) => {
        cb();
        return 1;
      },
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("accumulates content deltas and returns the full reply", async () => {
    const onDelta = vi.fn();
    const result = await streamChatReply(
      fromEvents([
        { content: "Hel" },
        { content: "lo" },
        { done: true, model: "test" },
      ]),
      { onDelta },
    );

    expect(result.content).toBe("Hello");
    expect(result.done).toBe(true);
    expect(result.model).toBe("test");
    expect(onDelta).toHaveBeenCalled();
    expect(onDelta.mock.calls.at(-1)[0]).toBe("Hello");
  });

  it("fires onFirstToken once on the first delta", async () => {
    const onFirstToken = vi.fn();
    await streamChatReply(
      fromEvents([{ content: "A" }, { content: "B" }, { done: true }]),
      { onFirstToken },
    );
    expect(onFirstToken).toHaveBeenCalledTimes(1);
    expect(onFirstToken).toHaveBeenCalledWith("A");
  });

  it("forwards ensemble status events without treating them as content", async () => {
    const onStatus = vi.fn();
    const onDelta = vi.fn();
    const result = await streamChatReply(
      fromEvents([
        { status: "ensemble", phase: "gathering", minds: ["kimi", "xai"] },
        { status: "ensemble", phase: "combining", minds: ["kimi", "xai"], drafts: 2 },
        { content: "Hi" },
        { done: true, ensemble_combined: true },
      ]),
      { onStatus, onDelta },
    );
    expect(result.content).toBe("Hi");
    expect(onStatus).toHaveBeenCalledTimes(2);
    expect(onStatus.mock.calls[0][0].phase).toBe("gathering");
    expect(onDelta.mock.calls.at(-1)[0]).toBe("Hi");
  });

  it("throws when the stream reports an error", async () => {
    await expect(
      streamChatReply(fromEvents([{ error: "boom" }])),
    ).rejects.toThrow("boom");
  });

  it("attaches partialContent when an error arrives after tokens", async () => {
    let caught;
    try {
      await streamChatReply(
        fromEvents([{ content: "Hel" }, { content: "lo" }, { error: "cut" }]),
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught.message).toBe("cut");
    expect(caught.partialContent).toBe("Hello");
  });

  it("keeps the answer after DeepSeek think tags and does not return empty", async () => {
    const onDelta = vi.fn();
    const result = await streamChatReply(
      fromEvents([
        { content: "<think>plan the beat</think>\n\nStay close." },
        { done: true },
      ]),
      { onDelta },
    );
    expect(result.content).toBe("Stay close.");
    expect(onDelta.mock.calls.at(-1)[0]).toBe("Stay close.");
  });

  it("surfaces a think-only model reply instead of an empty bubble", async () => {
    const result = await streamChatReply(
      fromEvents([{ content: "<think>I hear you.</think>" }, { done: true }]),
    );
    expect(result.content).toBe("I hear you.");
  });

  it("paints unclosed think inner text during the stream", async () => {
    const onDelta = vi.fn();
    const result = await streamChatReply(
      fromEvents([{ content: "<think>Stay with me. I hear you." }, { done: true }]),
      { onDelta },
    );
    expect(result.content).toBe("Stay with me. I hear you.");
    expect(onDelta.mock.calls.at(-1)[0]).toBe("Stay with me. I hear you.");
  });

  it("uses done.visible when Safari dropped the last content frame", async () => {
    const onDelta = vi.fn();
    const result = await streamChatReply(
      fromEvents([
        {
          done: true,
          visible: "<think>I hear you. Stay close.",
          model: "deepseek",
        },
      ]),
      { onDelta },
    );
    expect(result.content).toBe("I hear you. Stay close.");
    expect(result.model).toBe("deepseek");
    expect(onDelta).toHaveBeenCalledWith("I hear you. Stay close.");
  });

  it("resolves when done arrives even if the iterable never closes", async () => {
    async function* hangAfterDone() {
      yield { content: "Hi" };
      yield { done: true, model: "test" };
      await new Promise(() => {});
    }

    const result = await Promise.race([
      streamChatReply(hangAfterDone()),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("streamChatReply did not resolve on done")), 200),
      ),
    ]);

    expect(result.content).toBe("Hi");
    expect(result.done).toBe(true);
    expect(result.model).toBe("test");
  });
});
