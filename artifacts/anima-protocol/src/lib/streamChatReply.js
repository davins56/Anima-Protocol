import {
  createVisibleReplyFilter,
  finalizeAssistantReply,
} from "./visibleAssistantReply";
import {
  stripMachineTags,
  stripMachineTagsStreaming,
  stripStageMarkers,
  stripStageMarkersStreaming,
} from "./machineTags";

const EMPTY_REPLY_MESSAGE =
  "The companion returned an empty reply. Please try again.";

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
 * With `stripTags` (ANIMA_EMOTIONS on, #765) machine tags (`[EMOTION:…]`,
 * `[[…]]`) are hidden chunk-safely and removed from the final content, so
 * streamed and stored text match. `onAffect` receives the provisional early
 * `{ affect }` frame; it is never part of the returned payload. Both default
 * off, which leaves the stream exactly as before.
 *
 * With `onScene` (ANIMA_SITUATIONAL_SCENES on, #763) the additive
 * `{ scene_plan }` and `{ scene_event }` frames are handed to the caller,
 * `[[…]]` stage markers are hidden from the visible text (`stripStage`),
 * and a turn whose server plan picked nobody (`speakers: []`) resolves with
 * `scene_no_reply: true` instead of failing as an empty reply. All default
 * off, which leaves the stream exactly as before.
 *
 * @param {AsyncIterable<{ content?: string, done?: boolean, error?: string, status?: string, affect?: unknown, scene_plan?: unknown, scene_event?: unknown }>} events
 * @param {{ onDelta?: (accumulated: string) => void, onFirstToken?: (accumulated: string) => void, onStatus?: (event: object) => void, onAffect?: (frame: unknown) => void, stripTags?: boolean, stripStage?: boolean, onScene?: (frame: { scene_plan?: unknown, scene_event?: unknown }) => void }} [hooks]
 */
export async function streamChatReply(events, { onDelta, onFirstToken, onStatus, onAffect, stripTags = false, stripStage = false, onScene } = {}) {
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

  const streamView = (text) =>
    stripTags ? stripMachineTagsStreaming(text) : stripStage ? stripStageMarkersStreaming(text) : text;
  const finalView = (text) =>
    stripTags ? stripMachineTags(text) : stripStage ? stripStageMarkers(text) : text;
  // #763: the server plan for this turn picked nobody (natural mode / narrator).
  let sceneNoSpeaker = false;

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
        if (event.code) err.code = event.code;
        if (event.turn_id) err.turnId = event.turn_id;
        if (content) err.partialContent = content;
        if (crisisResource) err.crisisResource = crisisResource;
        if (event.resting === true) {
          err.resting = true;
          err.queued = event.queued === true;
        }
        throw err;
      }
      if (event?.status) {
        noteStreamStatus(event);
        onStatus?.(event);
      }
      if (onAffect && event?.affect && !event?.done) {
        try {
          onAffect(event.affect);
        } catch {
          // A cue is decoration; it never breaks the reply.
        }
      }
      if (onScene && !event?.done && (event?.scene_plan || event?.scene_event)) {
        const plan = event.scene_plan;
        if (
          plan &&
          typeof plan === "object" &&
          Array.isArray(/** @type {any} */ (plan).speakers) &&
          /** @type {any} */ (plan).speakers.length === 0
        ) {
          sceneNoSpeaker = true;
        }
        try {
          onScene({
            ...(event.scene_plan ? { scene_plan: event.scene_plan } : {}),
            ...(event.scene_event ? { scene_event: event.scene_event } : {}),
          });
        } catch {
          // Scene UI is decoration around the reply; it never breaks it.
        }
      }
      if (event?.content && !event?.done) {
        replyFilter.push(event.content);
        paintVisible(streamView(replyFilter.peek()));
      }
      if (event?.done) {
        doneEvent = event;
        const terminal = event.visible || event.content;
        if (terminal) {
          paintVisible(
            finalView(finalizeAssistantReply(terminal, replyFilter.peek(), content)),
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
  if (stripTags) content = stripMachineTags(content).trim();
  else if (stripStage) content = stripStageMarkers(content).trim();
  if (content && onDelta) onDelta(content);

  // #763: nobody speaks this turn by design. Not an error, no blank bubble.
  if (onScene && sceneNoSpeaker && !String(content || "").trim()) {
    return {
      ...(doneEvent || {}),
      content: "",
      scene_no_reply: true,
    };
  }

  // A stream that finished (or closed without `done`) with nothing visible
  // must fail loudly so the caller toasts instead of leaving a blank turn.
  if (!String(content || "").trim()) {
    const err = new Error(EMPTY_REPLY_MESSAGE);
    err.code = "empty_reply";
    if (doneEvent?.turn_id) err.turnId = doneEvent.turn_id;
    rememberChatClientTrace(err, currentTrace());
    throw err;
  }

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

/** 409 / turn_in_flight means the first generate for this turn is still running. */
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
 *   onAffect?: (frame: unknown) => void,
 *   stripTags?: boolean,
 *   stripStage?: boolean,
 *   onScene?: (frame: { scene_plan?: unknown, scene_event?: unknown }) => void,
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
  onAffect,
  stripTags = false,
  stripStage = false,
  onScene,
}) {
  let currentTurnId = turnId;
  let retried = false;
  for (;;) {
    try {
      const result = await streamChatReply(send(currentTurnId), {
        onDelta,
        onFirstToken,
        onStatus,
        ...(onAffect ? { onAffect } : {}),
        ...(stripTags ? { stripTags: true } : {}),
        ...(stripStage ? { stripStage: true } : {}),
        ...(onScene ? { onScene } : {}),
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
