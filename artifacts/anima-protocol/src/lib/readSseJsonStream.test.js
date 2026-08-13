import { describe, it, expect } from "vitest";
import { readSseJsonStream } from "./readSseJsonStream";

function streamFrom(chunks) {
  const encoder = new TextEncoder();
  let i = 0;
  return {
    getReader() {
      return {
        async read() {
          if (i >= chunks.length) return { done: true, value: undefined };
          const value = encoder.encode(chunks[i++]);
          return { done: false, value };
        },
        releaseLock() {},
      };
    },
  };
}

async function collect(body) {
  const out = [];
  for await (const event of readSseJsonStream(body)) out.push(event);
  return out;
}

describe("readSseJsonStream", () => {
  it("yields standard newline-delimited SSE events", async () => {
    const events = await collect(
      streamFrom(['data: {"content":"Hi"}\n\ndata: {"done":true}\n\n']),
    );
    expect(events).toEqual([{ content: "Hi" }, { done: true }]);
  });

  it("flushes a trailing data line that has no final newline", async () => {
    // Serverless/proxies often deliver one chunk without a terminating \n.
    // Dropping that trailer used to make chat see an empty successful reply.
    const events = await collect(streamFrom(['data: {"content":"Hello"}']));
    expect(events).toEqual([{ content: "Hello" }]);
  });

  it("flushes a done event left in the buffer after the last content line", async () => {
    const events = await collect(
      streamFrom(['data: {"content":"Hi"}\n\ndata: {"done":true}']),
    );
    expect(events).toEqual([{ content: "Hi" }, { done: true }]);
  });

  it("handles chunked delivery across event boundaries", async () => {
    const events = await collect(
      streamFrom(["data: {\"cont", 'ent":"A"}\n\ndata: {"content":"B"}\n\n']),
    );
    expect(events).toEqual([{ content: "A" }, { content: "B" }]);
  });

  it("throws when the body is not readable", async () => {
    await expect(collect(null)).rejects.toThrow(/not readable/i);
  });

  it("stops after a done event even when the body stays open", async () => {
    const encoder = new TextEncoder();
    const stream = {
      getReader() {
        let step = 0;
        return {
          async read() {
            if (step === 0) {
              step = 1;
              return {
                done: false,
                value: encoder.encode('data: {"content":"Hi"}\n\ndata: {"done":true}\n\n'),
              };
            }
            // Simulate a connection that never closes after `done`.
            await new Promise(() => {});
            return { done: true, value: undefined };
          },
          releaseLock() {},
        };
      },
    };

    const events = await Promise.race([
      collect(stream),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("readSseJsonStream did not stop on done")), 200),
      ),
    ]);
    expect(events).toEqual([{ content: "Hi" }, { done: true }]);
  });
});
