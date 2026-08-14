/**
 * Parse an SSE byte stream of `data: <json>\n\n` events.
 *
 * Critical: when the stream ends, any trailing line left in the buffer (no
 * final newline) must still be yielded. Proxies and serverless runtimes often
 * deliver the whole body in one chunk; dropping the trailer makes the client
 * see an empty "successful" reply — thinking/typing paints, then vanishes.
 *
 * Also stop after `done` / `error`. A server that writes the terminal event
 * then keeps the socket open (persist, evolution, a hung proxy) must not leave
 * the Chat page spinning on "Processing...".
 *
 * @param {ReadableStream<Uint8Array> | null | undefined} body
 * @returns {AsyncGenerator<object>}
 */
export async function* readSseJsonStream(body) {
  if (!body || typeof body.getReader !== "function") {
    throw new Error("Response body is not readable");
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const parseLine = (line) => {
    const trimmed = line.trimEnd();
    if (!trimmed.startsWith("data: ")) return null;
    try {
      return JSON.parse(trimmed.slice(6));
    } catch {
      return null;
    }
  };

  const drainBuffer = function* ({ flush = false } = {}) {
    const lines = buffer.split("\n");
    buffer = flush ? "" : lines.pop() ?? "";
    for (const line of lines) {
      const parsed = parseLine(line);
      if (parsed != null) yield parsed;
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (value) {
        buffer += decoder.decode(value, { stream: !done });
        for (const event of drainBuffer({ flush: false })) {
          yield event;
          if (event?.done || event?.error) return;
        }
      }
      if (done) {
        // Flush decoder state and any line that never saw a trailing newline.
        buffer += decoder.decode();
        for (const event of drainBuffer({ flush: true })) {
          yield event;
          if (event?.done || event?.error) return;
        }
        break;
      }
    }
  } finally {
    try {
      reader.releaseLock?.();
    } catch {
      /* ignore */
    }
  }
}
