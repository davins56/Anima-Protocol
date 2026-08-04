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
});
