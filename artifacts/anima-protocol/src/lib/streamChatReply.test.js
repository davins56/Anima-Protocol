import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { streamChatReply, streamChatReplyWithTurnRetry } from "./streamChatReply";

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

  it("forwards a waiting status with the queue position", async () => {
    const onStatus = vi.fn();
    const onDelta = vi.fn();
    await streamChatReply(
      fromEvents([
        { status: "waiting", queue_position: 1 },
        { status: "waiting", queue_position: 1 },
        { content: "Hi" },
        { done: true },
      ]),
      { onStatus, onDelta },
    );
    expect(onStatus).toHaveBeenCalledTimes(2);
    expect(onStatus.mock.calls[0][0].queue_position).toBe(1);
    expect(onDelta.mock.calls.at(-1)[0]).toBe("Hi");
  });

  it("forwards local-only progress status before the first token", async () => {
    const onStatus = vi.fn();
    const onDelta = vi.fn();
    await streamChatReply(
      fromEvents([
        { status: "progress", phase: "preparing", elapsed_ms: 0 },
        { status: "progress", phase: "waking", elapsed_ms: 1200 },
        { content: "Hi" },
        { done: true },
      ]),
      { onStatus, onDelta },
    );
    expect(onStatus).toHaveBeenCalledTimes(2);
    expect(onStatus.mock.calls[0][0].phase).toBe("preparing");
    expect(onStatus.mock.calls[1][0].phase).toBe("waking");
    expect(onDelta.mock.calls.at(-1)[0]).toBe("Hi");
  });

  it("returns a crisis resource card beside the companion reply", async () => {
    const card = {
      role: "system",
      type: "crisis_resource",
      content: "If you're thinking about suicide or self-harm, you can call or text 988 (US, Suicide & Crisis Lifeline) or text HOME to 741741. If you're outside the US, contact local emergency services.",
    };
    const result = await streamChatReply(
      fromEvents([
        { crisis_resource: card },
        { content: "I'm here with you." },
        { done: true, visible: "I'm here with you.", crisis_resource: card },
      ]),
    );
    expect(result.content).toBe("I'm here with you.");
    expect(result.crisis_resource).toEqual(card);
  });

  it("keeps the crisis card when the stream errors after sending it", async () => {
    const card = { role: "system", type: "crisis_resource", content: "call or text 988" };
    let caught;
    try {
      await streamChatReply(fromEvents([{ crisis_resource: card }, { error: "cut" }]));
    } catch (err) {
      caught = err;
    }
    expect(caught.crisisResource).toEqual(card);
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
    expect(caught.chatClientTrace.partialKept).toBe(true);
    expect(caught.chatClientTrace.sawFirstToken).toBe(true);
    expect(caught.chatClientTrace.serverError).toBe(true);
    expect(JSON.stringify(caught.chatClientTrace)).not.toContain("Hello");
    expect(JSON.stringify(caught.chatClientTrace)).not.toContain("cut");
  });

  it("records a queue wait without copying status text into the trace", async () => {
    let caught;
    try {
      await streamChatReply(
        fromEvents([{ status: "waiting", queue_position: 2 }, { error: "slot" }]),
      );
    } catch (err) {
      caught = err;
    }
    expect(caught.chatClientTrace.sawQueueWait).toBe(true);
    expect(caught.chatClientTrace.leftQueue).toBe(false);
    expect(caught.chatClientTrace.sawFirstToken).toBe(false);
    expect(JSON.stringify(caught.chatClientTrace)).not.toContain("slot");
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

  it("replaces a streamed cutoff with the shorter done.visible reply", async () => {
    const onDelta = vi.fn();
    const result = await streamChatReply(
      fromEvents([
        { content: "The room stays quiet and the lamp keeps burning. " },
        { content: "undist" },
        { done: true, visible: "The room stays quiet and the lamp keeps burning." },
      ]),
      { onDelta },
    );
    expect(result.content).toBe("The room stays quiet and the lamp keeps burning.");
    expect(onDelta.mock.calls.at(-1)[0]).toBe(
      "The room stays quiet and the lamp keeps burning.",
    );
    expect(onDelta.mock.calls.at(-1)[0]).not.toContain("undist");
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

  it("preserves companion_affect on the done payload for the mood UI contract", async () => {
    const result = await streamChatReply(
      fromEvents([
        { content: "I am here." },
        {
          done: true,
          visible: "I am here.",
          companion_affect: {
            version: 1,
            primary: "tender",
            intensity: 58,
            mood: "tender-aching",
            energy: 44,
            synchro_strength: 61,
          },
        },
      ]),
    );
    expect(result.companion_affect).toMatchObject({
      primary: "tender",
      intensity: 58,
      synchro_strength: 61,
    });
    expect(result.content).toBe("I am here.");
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

describe("streamChatReplyWithTurnRetry", () => {
  it("retries once with a new turn_id when the stream is replayed", async () => {
    const mintTurnId = vi.fn(() => "turn_retry");
    const onRetry = vi.fn();
    const send = vi.fn((id) => {
      if (id === "turn_old") {
        return fromEvents([
          { content: "Old reply" },
          { done: true, replayed: true, turn_id: "turn_old" },
        ]);
      }
      return fromEvents([
        { content: "Fresh reply" },
        { done: true, turn_id: id },
      ]);
    });

    const result = await streamChatReplyWithTurnRetry({
      send,
      turnId: "turn_old",
      mintTurnId,
      onRetry,
    });

    expect(mintTurnId).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith("turn_retry");
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0]).toBe("turn_retry");
    expect(result.content).toBe("Fresh reply");
    expect(result.replayed).toBeFalsy();
    expect(result.turn_id).toBe("turn_retry");
  });

  it("does not retry turn_in_flight with a new turn id", async () => {
    const err = Object.assign(
      new Error("This chat turn is already being processed."),
      { status: 409, code: "turn_in_flight" },
    );
    const send = vi.fn(
      () =>
        (async function* () {
          throw err;
        })(),
    );

    await expect(
      streamChatReplyWithTurnRetry({
        send,
        turnId: "turn_old",
        mintTurnId: () => "turn_new",
      }),
    ).rejects.toMatchObject({ code: "turn_in_flight" });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("does not retry a 409 while the first generate may still be running", async () => {
    const err = Object.assign(
      new Error("This chat turn is already being processed."),
      { status: 409 },
    );
    const send = vi.fn(
      () =>
        (async function* () {
          throw err;
        })(),
    );

    await expect(
      streamChatReplyWithTurnRetry({
        send,
        turnId: "turn_old",
        mintTurnId: () => "turn_new",
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(send).toHaveBeenCalledTimes(1);
  });
});
