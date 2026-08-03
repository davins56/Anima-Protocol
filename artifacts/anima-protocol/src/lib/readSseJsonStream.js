/**
 * Parse an SSE byte stream of `data: <json>\n\n` events.
 *
 * Critical: when the stream ends, any trailing line left in the buffer (no
 * final newline) must still be yielded. Proxies and serverless runtimes often
 * deliver the whole body in one chunk; dropping the trailer makes the client
 * see an empty "successful" reply — thinking/typing paints, then vanishes.
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

  const yieldFromBuffer = function* ({ flush = false } = {}) {
    const lines = buffer.split("\n");
    // Keep the last fragment unless we're flushing the end of the stream —
    // it may be an incomplete line waiting for the next chunk.
    buffer = flush ? "" : lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trimEnd();
      if (!trimmed.startsWith("data: ")) continue;
      try {
        yield JSON.parse(trimmed.slice(6));
      } catch {
        // ignore malformed events
      }
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (value) {
        buffer += decoder.decode(value, { stream: !done });
        yield* yieldFromBuffer({ flush: false });
      }
      if (done) {
        // Flush decoder state and any line that never saw a trailing newline.
        buffer += decoder.decode();
        yield* yieldFromBuffer({ flush: true });
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
