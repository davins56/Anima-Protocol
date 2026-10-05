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

export function isChatTurnCollisionError(error) {
  if (!error) return false;
  if (error.status === 409) return true;
  if (error.code === "turn_in_flight" || error.code === "turn_id_conflict") {
    return true;
  }
  return /already being processed|already used for a different message/i.test(
    String(error.message || ""),
  );
}

function defaultMintTurnId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `turn_${crypto.randomUUID()}`;
  }
  return `turn_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Companion send wrapper: a reused `turn_id` can replay prior text (`replayed`)
 * or 409 while the first attempt is still pending. Mint a fresh id and retry
 * once so turn-2 never keeps the previous assistant bubble.
 *
 * @param {{
 *   send: (turnId: string) => AsyncIterable<object>,
 *   turnId: string,
 *   mintTurnId?: () => string,
 *   onRetry?: (turnId: string) => void,
 *   onDelta?: (accumulated: string) => void,
 *   onFirstToken?: (accumulated: string) => void,
 *   onStatus?: (event: object) => void,
 * }} args
 */
export async function streamChatReplyWithTurnRetry({
  send,
  turnId,
  mintTurnId = defaultMintTurnId,
  onRetry,
  onDelta,
  onFirstToken,
  onStatus,
}) {
  let currentTurnId = turnId;
  let retried = false;
  for (;;) {
    try {
      const result = await streamChatReply(send(currentTurnId), {
        onDelta,
        onFirstToken,
        onStatus,
      });
      if (result?.replayed && !retried) {
        retried = true;
        currentTurnId = mintTurnId();
        onRetry?.(currentTurnId);
        continue;
      }
      return { ...result, turn_id: result?.turn_id || currentTurnId };
    } catch (error) {
      if (!retried && isChatTurnCollisionError(error)) {
        retried = true;
        currentTurnId = mintTurnId();
        onRetry?.(currentTurnId);
        continue;
      }
      throw error;
    }
  }
}
