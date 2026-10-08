import {
  createVisibleReplyFilter,
  finalizeAssistantReply,
} from "./visibleAssistantReply";

function rememberChatClientTrace(err, trace) {
  if (!err || typeof err !== "object") return;
  if (Object.prototype.hasOwnProperty.call(err, "chatClientTrace")) return;
  try {
    Object.defineProperty(err, "chatClientTrace", {
      value: trace,
      enumerable: false,
      configurable: true,
    });
  } catch {
    try {
      err.chatClientTrace = trace;
    } catch {
      /* A frozen error still propagates. The report can classify without a trace. */
    }
  }
}

/**
 * Consume a chat SSE async-iterable and surface tokens as they arrive.
 *
 * `/api/chat/messages` streams extras, then a `done` event that carries the
 * full visible reply. iPad Safari can drop the last content frame; `done.visible`
 * is the authoritative paint so an unclosed DeepSeek `<think>` still lands.
 *
 * onDelta receives the accumulated visible text so far.
 * A thrown error gets `chatClientTrace` (timings and flags only, never reply text).
 *
 * @param {AsyncIterable<{ content?: string, done?: boolean, error?: string, status?: string }>} events
 * @param {{ onDelta?: (accumulated: string) => void, onFirstToken?: (accumulated: string) => void, onStatus?: (event: object) => void }} [hooks]
 */
export async function streamChatReply(events, { onDelta, onFirstToken, onStatus } = {}) {
  let content = "";
  let doneEvent = null;
  let crisisResource = null;
  let sawFirst = false;
  let pending = null;
  let rafId = null;
  const replyFilter = createVisibleReplyFilter();
  const hasRaf = typeof requestAnimationFrame === "function";
  const startedAt = Date.now();
  let firstTokenAt = null;
  let sawQueueWait = false;
  let leftQueue = false;
  let serverError = false;

  const currentTrace = () => ({
    startedAt,
    firstTokenAt,
    sawQueueWait,
    leftQueue: leftQueue || firstTokenAt != null,
    sawFirstToken: firstTokenAt != null,
    partialKept: Boolean(String(content || "").trim()),
    serverError,
  });

  const noteStreamStatus = (event) => {
    if (!event || typeof event !== "object") return;
    if (event.status === "waiting") sawQueueWait = true;
    const progressPhase = event.phase;
    if (
      event.status === "thinking" ||
      event.status === "ensemble" ||
      (event.status === "progress" &&
        (progressPhase === "waking" || progressPhase === "generating"))
    ) {
      leftQueue = true;
    }
  };

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
      if (firstTokenAt == null) firstTokenAt = Date.now();
      onFirstToken?.(content);
    }
    scheduleDelta(content);
  };

  try {
    for await (const event of events) {
      if (event?.crisis_resource) {
        crisisResource = event.crisis_resource;
      }
      if (event?.error) {
        serverError = true;
        const err = new Error(event.error);
        if (content) err.partialContent = content;
        if (crisisResource) err.crisisResource = crisisResource;
        throw err;
      }
      if (event?.status) {
        noteStreamStatus(event);
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
  } catch (err) {
    rememberChatClientTrace(err, currentTrace());
    throw err;
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

  return {
    ...(doneEvent || {}),
    content,
    ...(crisisResource && !doneEvent?.crisis_resource
      ? { crisis_resource: crisisResource }
      : {}),
  };
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

/** 409 / turn_in_flight means the first generate is still on the droplet. */
export function isTurnStillRunningError(error) {
  if (!error) return false;
  if (error.code === "turn_in_flight" || error.status === 409) return true;
  return /already being processed/i.test(String(error.message || ""));
}

function defaultMintTurnId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `turn_${crypto.randomUUID()}`;
  }
  return `turn_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Companion send wrapper: a reused `turn_id` can replay prior text (`replayed`).
 * Mint a fresh id and retry that once so turn-2 never keeps the previous
 * assistant bubble.
 *
 * Do not retry `turn_in_flight` / HTTP 409. That response means the first
 * generate is still running on the single-slot Ollama host. A new turn id
 * would queue a second generate behind it.
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
      if (
        !retried &&
        isChatTurnCollisionError(error) &&
        !isTurnStillRunningError(error)
      ) {
        retried = true;
        currentTurnId = mintTurnId();
        onRetry?.(currentTurnId);
        continue;
      }
      throw error;
    }
  }
}
