import {
  createVisibleReplyFilter,
  finalizeAssistantReply,
} from "./visibleAssistantReply";

/**
 * Consume a chat SSE async-iterable and surface tokens as they arrive.
 *
 * `/api/chat/messages` streams extras, then a `done` event that carries the
 * full visible reply. iPad Safari can drop the last content frame; `done.visible`
 * is the authoritative paint so an unclosed DeepSeek `<think>` still lands.
 *
 * onDelta receives the accumulated visible text so far.
 *
 * @param {AsyncIterable<{ content?: string, done?: boolean, error?: string, status?: string }>} events
 * @param {{ onDelta?: (accumulated: string) => void, onFirstToken?: (accumulated: string) => void, onStatus?: (event: object) => void }} [hooks]
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

  const paintVisible = (next) => {
    const visible = finalizeAssistantReply(next, content);
    if (!visible) return;
    content = visible;
    if (!sawFirst) {
      sawFirst = true;
      onFirstToken?.(content);
    }
    scheduleDelta(content);
  };

  try {
    for await (const event of events) {
      if (event?.error) {
        const err = new Error(event.error);
        if (content) err.partialContent = content;
        throw err;
      }
      if (event?.status) {
        onStatus?.(event);
      }
      if (event?.content && !event?.done) {
        replyFilter.push(event.content);
        paintVisible(replyFilter.peek());
      }
      if (event?.done) {
        doneEvent = event;
        const terminal = event.visible || event.content;
        if (terminal) {
          paintVisible(
            finalizeAssistantReply(terminal, replyFilter.peek(), content),
          );
        }
        break;
      }
    }
  } finally {
    if (rafId != null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (pending != null) flush();
    else if (content && onDelta) onDelta(content);
  }

  const finished = replyFilter.finish();
  content = finalizeAssistantReply(
    doneEvent?.visible,
    doneEvent?.content,
    finished.visible,
    content,
  );
  if (content && onDelta) onDelta(content);

  return { ...(doneEvent || {}), content };
}
