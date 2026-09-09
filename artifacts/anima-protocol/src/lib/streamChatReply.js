import { createVisibleReplyFilter, visibleAssistantReply } from "./visibleAssistantReply";

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
 * @param {AsyncIterable<{ content?: string, done?: boolean, error?: string, status?: string }>} events
 * @param {{ onDelta?: (accumulated: string) => void, onFirstToken?: (accumulated: string) => void, onStatus?: (event: object) => void }} [hooks]
 * @returns {Promise<{ content: string, done?: object }>}
 */
export async function streamChatReply(events, { onDelta, onFirstToken, onStatus } = {}) {
  let content = "";
  let doneEvent = null;
  let sawFirst = false;
  let pending = null;
  let rafId = null;
  const replyFilter = createVisibleReplyFilter();
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
      if (event?.status) {
        onStatus?.(event);
      }
      if (event?.content) {
        const visibleDelta = replyFilter.push(event.content);
        if (!visibleDelta) continue;
        content += visibleDelta;
        if (!sawFirst) {
          sawFirst = true;
          onFirstToken?.(content);
        }
        scheduleDelta(content);
      }
      if (event?.done) {
        doneEvent = event;
        // Resolve as soon as the server signals completion. Waiting for the
        // HTTP body to close used to leave the Chat page on "Processing..."
        // while persist/evolution work (or a hung tunnel) kept the stream open.
        break;
      }
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

  const finished = replyFilter.finish();
  if (finished.emitted) {
    content += finished.emitted;
    if (onDelta) onDelta(content);
  }
  content = finished.visible || visibleAssistantReply(content) || content;

  return { content, ...(doneEvent || {}) };
}
