/**
 * Consume a chat SSE async-iterable and surface tokens as they arrive.
 *
 * The API already streams deltas; the Chat page historically buffered them via
 * completeMessage(). This helper keeps that buffering available (return value)
 * while letting the UI render partial content for a fluid conversation feel.
 *
 * onDelta receives the accumulated text so far. Updates are rAF-coalesced so
 * high-frequency token bursts don't flood React with one setState per byte.
 *
 * @param {AsyncIterable<{ content?: string, done?: boolean, error?: string }>} events
 * @param {{ onDelta?: (accumulated: string) => void, onFirstToken?: (accumulated: string) => void }} [hooks]
 * @returns {Promise<{ content: string, done?: object }>}
 */
export async function streamChatReply(events, { onDelta, onFirstToken } = {}) {
  let content = "";
  let doneEvent = null;
  let sawFirst = false;
  let pending = null;
  let rafId = null;
  const hasRaf = typeof requestAnimationFrame === "function";

  const flush = () => {
    rafId = null;
    if (pending == null) return;
    const next = pending;
    pending = null;
    onDelta?.(next);
  };

  const scheduleDelta = (accumulated) => {
    if (!onDelta) return;
    if (!hasRaf) {
      onDelta(accumulated);
      return;
    }
    pending = accumulated;
    if (rafId != null) return;
    rafId = requestAnimationFrame(flush);
  };

  try {
    for await (const event of events) {
      if (event?.error) {
        const err = new Error(event.error);
        // Preserve tokens already painted so callers can keep a partial reply
        // instead of wiping the bubble when the stream fails mid-response.
        if (content) err.partialContent = content;
        throw err;
      }
      if (event?.content) {
        content += event.content;
        if (!sawFirst) {
          sawFirst = true;
          onFirstToken?.(content);
        }
        scheduleDelta(content);
      }
      if (event?.done) doneEvent = event;
    }
  } finally {
    if (rafId != null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    // Ensure the final accumulated text is delivered even if the last tokens
    // were still waiting on a coalesced frame when the stream ended.
    if (pending != null) flush();
    else if (content && onDelta) onDelta(content);
  }

  return { content, ...(doneEvent || {}) };
}
