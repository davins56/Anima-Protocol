/**
 * Chat LLM open / stream / client abort budgets.
 *
 * Production chat prefers local anima-chat (`chain: ["local"]`). Signed-in
 * `/api/openai` uses the 35s single-model open budget, or 80s when
 * `usesFreeTierOpenBudget()` is true. POST `/api/chat/messages` uses the
 * 90s local-only first-token cap unless OpenRouter is actually in the chain,
 * then the 80s free-tier cascade so workersai 4006 + :free hops are not aborted.
 *
 * POST `/api/ai/chat` is NOT long-lived. An 80s (or even 35s) open abort
 * outlives the Worker ~20s wall, so the client sees 0 bytes instead of
 * JSON. Cap that path under the wall (`LLM_OPEN_TIMEOUT_AI_CHAT_MS`).
 * `/api/chat/messages` is wall-exempt (SSE). After the upstream stream
 * opens, `open.cancel()` runs and `consumeLlmStream` owns first-chunk /
 * stall — this cap does not truncate an in-flight reply. Local hop still
 * uses `LLM_LOCAL_FAILOVER_ATTEMPT_MS` (12s) when a next provider exists.
 *
 * Historical free-tier OpenRouter chat (`ANIMA_OPENROUTER_FREE=true`) hops
 * m2.7:free → m3:free → Gemma 4 on 400/429/5xx. Those hops plus the last
 * candidate's SDK retries share one AbortSignal from `openStreamAbort()`.
 * A 35s cap aborts mid-cascade and surfaces as
 * "The companion took too long to reply."
 *
 * Keep the browser fetch abort above the free-tier open budget so the
 * client does not cancel while the Worker is still hopping models.
 * SSE heartbeats (`SSE_HEARTBEAT_MS` in chat.ts) keep the connection alive.
 */

/** Paid / single-model stream-open budget (signed-in SSE). */
export const LLM_OPEN_TIMEOUT_MS = 35_000;

/**
 * Free-tier multi-candidate open budget. Two failed hops (m2.7 429/502,
 * m3 GMICloud 400) plus last-candidate retries must still be able to open.
 * Used by signed-in `/api/openai` and by `/api/chat/messages` when
 * `usesFreeTierOpenBudget()` is true (OpenRouter is actually in the chain).
 * Never `/api/ai/chat` (Worker wall).
 */
export const LLM_OPEN_TIMEOUT_FREE_TIER_MS = 80_000;

/**
 * Unauthenticated `/api/ai/chat` open budget. Must finish before the
 * Worker ~20s isolate wall (`WORKER_API_TIMEOUT_MS`) so a hung Fly/Ollama
 * generate returns JSON `ai_timeout` instead of a 0-byte cut.
 */
export const LLM_OPEN_TIMEOUT_AI_CHAT_MS = 18_000;

/**
 * First token from the self-hosted Anima LLM on a small CPU.
 *
 * Ollama does not emit tokens during prompt prefill. Depending on the
 * server build, HTTP headers arrive either with the first token or before
 * it. The open abort covers the late-header case; `consumeLlmStream`'s
 * first-chunk timer covers the early-header case. Both use this budget.
 * After visible text, `LLM_STREAM_STALL_MS` is the idle gap. There is no
 * OpenRouter hop on this path, so a short wall only turns a slow prefill
 * into the "took too long" toast.
 *
 * 90s stays under Cloudflare's ~100s origin timeout (HTML 524). Decode of
 * the short reply uses `LLM_LOCAL_DECODE_SLACK_MS` on top of that. This
 * clock starts when the turn takes the local slot, not while it is queued.
 * The browser fetch abort is `CHAT_FETCH_ABORT_MS` (queue + this budget).
 * `/api/ai/chat` stays at 18s (Worker wall). Do not raise that probe.
 */
export const LLM_LOCAL_FIRST_TOKEN_MS = 90_000;

/**
 * Tokens after prefill on the local-only path. Added to the first-token
 * budget for the consume hard cap so a slow CPU prefill does not eat the
 * whole window and cut the reply at the first token. Idle gaps after
 * visible text still use `LLM_STREAM_STALL_MS`.
 */
export const LLM_LOCAL_DECODE_SLACK_MS = 30_000;

/**
 * How long a chat turn will wait for the single local Ollama slot.
 * Separate from the first-token budget: queue time must not burn the 90s.
 */
export const LLM_LOCAL_SLOT_WAIT_MS = 180_000;

/**
 * Lease lifetime for the local slot. A little above the generation cap
 * (first token + decode slack) so a live turn can finish, and short enough
 * that a crashed holder cannot wedge the host. Heartbeats extend it.
 */
export const LLM_LOCAL_SLOT_TTL_MS =
  LLM_LOCAL_FIRST_TOKEN_MS + LLM_LOCAL_DECODE_SLACK_MS + 30_000;

/** Drop a queued chat turn that stopped polling (isolate died in line). */
export const LLM_LOCAL_SLOT_QUEUE_TTL_MS = LLM_LOCAL_SLOT_WAIT_MS + 15_000;

/** How often a holder refreshes the lease while it is generating. */
export const LLM_LOCAL_SLOT_HEARTBEAT_MS = 15_000;

/** How often a waiting chat turn asks the slot for its place in line. */
export const LLM_LOCAL_SLOT_POLL_MS = 1_000;

/**
 * After a chat turn is in flight, or anyone has sent a message this recently,
 * optional local-model work does not start. One Ollama generate at a time
 * means a journal or proactive check-in started in this window sits in front
 * of the next reply. Three minutes covers a pause to type the next message
 * without parking background work for a whole session.
 */
export const ACTIVE_CHAT_QUIET_WINDOW_MS = 3 * 60 * 1000;

/**
 * Longest a chat turn waits for a background generate that already holds the
 * slot. The background call is asked to abort immediately; this is the cap
 * if that abort is late. Well under the 180s chat queue budget.
 */
export const LLM_BACKGROUND_YIELD_MS = 8_000;

/**
 * Wall clock for a background local generate, including prefill. Chat's
 * producing-token cap is 120s (`LLM_LOCAL_FIRST_TOKEN_MS` + decode slack).
 * Background work stops much sooner so it cannot occupy the only slot.
 */
export const LLM_BACKGROUND_WALL_MS = 12_000;

/**
 * Lease for a background holder. The holder refreshes it every
 * `LLM_BACKGROUND_YIELD_POLL_MS`. A dead isolate stops refreshing, so chat
 * can take the slot without waiting out a chat-length lease.
 */
export const LLM_BACKGROUND_SLOT_TTL_MS = 4_000;

/** How often a background holder checks whether chat has asked it to yield. */
export const LLM_BACKGROUND_YIELD_POLL_MS = 500;

/**
 * Token cap for background local generates. Chat replies use up to
 * `OLLAMA_NUM_PREDICT_CAP` (200). At ~9 tokens/s on one vCPU, 80 tokens is
 * about nine seconds of decode and fits inside `LLM_BACKGROUND_WALL_MS`.
 */
export const LLM_BACKGROUND_NUM_PREDICT = 80;

export function capBackgroundNumPredict(requested: number | undefined): number {
  const raw =
    typeof requested === "number" && Number.isFinite(requested) && requested > 0
      ? Math.floor(requested)
      : LLM_BACKGROUND_NUM_PREDICT;
  return Math.min(Math.max(1, raw), LLM_BACKGROUND_NUM_PREDICT);
}

/**
 * SSE `/api/chat/messages` open budget when the chain is local-only.
 * Same clock as `LLM_LOCAL_FIRST_TOKEN_MS`: time-to-first-byte, which is
 * CPU prefill when the host withholds headers until the first token.
 */
export const LLM_OPEN_TIMEOUT_LOCAL_ONLY_MS = LLM_LOCAL_FIRST_TOKEN_MS;

/**
 * Local-provider attempt when a next hop exists. Shorter than the `/api/ai/chat`
 * open budget so a stalled Ollama generate can still fail over before the wall.
 */
export const LLM_LOCAL_FAILOVER_ATTEMPT_MS = 12_000;

/**
 * After the upstream stream is open, wait this long for first activity.
 * DeepSeek R1 on Workers AI often buffers `<think>` before the first SSE
 * byte; 35s was aborting signed-in `/openai` sends that `/api/ai/chat`
 * (unauth, non-stream) still completed.
 */
export const LLM_STREAM_FIRST_CHUNK_MS = 50_000;

/** Once visible text has arrived, treat this idle gap as end-of-reply. */
export const LLM_STREAM_STALL_MS = 15_000;

/**
 * Hard cap for consuming an already-open stream.
 * R1 can spend most of a turn inside `<think>` before a visible answer.
 */
export const LLM_STREAM_TOTAL_MS = 90_000;

/**
 * Slack for `/chat/messages` context load + Clerk before LLM timers.
 * Later turns grow this work slightly; keep it off the first-token clock.
 */
export const CHAT_MESSAGES_CONTEXT_SLACK_MS = 10_000;

/**
 * Browser `fetch` abort for `/chat/messages`.
 * Covers a free-tier open (workersai 4006 + OpenRouter :free cascade),
 * context slack, and a first-chunk wait so the UI does not throw a generic
 * abort while the Worker is still hopping models.
 */
export const CHAT_STREAM_TIMEOUT_MS =
  LLM_OPEN_TIMEOUT_FREE_TIER_MS +
  LLM_STREAM_FIRST_CHUNK_MS +
  CHAT_MESSAGES_CONTEXT_SLACK_MS;

/**
 * Browser `fetch` abort for `/chat/messages` on the local host.
 * Covers the slot queue, the first-token budget, decode slack, and context
 * load. Free-tier hops still fit under `CHAT_STREAM_TIMEOUT_MS`; the client
 * uses this longer cap so a queued turn is not aborted while it is waiting.
 * Repeat-retry leftover time stays on `CHAT_STREAM_TIMEOUT_MS`.
 */
export const CHAT_FETCH_ABORT_MS =
  LLM_LOCAL_SLOT_WAIT_MS +
  LLM_LOCAL_FIRST_TOKEN_MS +
  LLM_LOCAL_DECODE_SLACK_MS +
  CHAT_MESSAGES_CONTEXT_SLACK_MS;

/**
 * Hard cap for a local generate that is already emitting tokens.
 * A browser disconnect does not abort that generate before this cap.
 */
export function llmProducingGenerateHardCapMs(): number {
  return LLM_LOCAL_FIRST_TOKEN_MS + LLM_LOCAL_DECODE_SLACK_MS;
}

/**
 * Cloudflare `waitUntil` grace after the browser disconnects.
 * Wall time is unlimited while the client is still connected. After
 * disconnect the runtime keeps background work for 30 seconds.
 */
export const WORKER_WAIT_UNTIL_GRACE_MS = 30_000;

/**
 * After the browser drops, wait this long for a retry/join before aborting
 * the upstream generate. A live client or a pending join keeps the slot.
 */
export const CLIENT_DISCONNECT_GRACE_MS = 25_000;

/**
 * Hard ceiling for a generate that continues only so a late reply can be
 * saved. A companion beat is about 200 tokens (~15s at 13 tok/s) after a
 * ~23s prefill, so this stays well under the old 170s durable wait.
 * A connected client still uses the 90s first-token budget.
 */
export const LLM_LATE_PERSIST_BUDGET_MS = 60_000;

/**
 * How long a disconnected companion generate may keep the model slot when
 * nobody is waiting on the reply. Connected turns use the local first-token
 * budget instead. Does not change `/api/ai/chat`.
 */
export function llmCompanionDurableWaitMs(): number {
  return LLM_LATE_PERSIST_BUDGET_MS;
}

/**
 * Abort an upstream generate that no longer has a live client or a retry
 * waiting on it. A turn still inside the disconnect grace keeps running.
 * Past the late-persist ceiling, a disconnected turn that has not yet
 * produced tokens stops even sooner.
 *
 * Once tokens are flowing, a disconnect does not abort the generate.
 * It runs until the hard cap so the late-reply poll can save the beat.
 */
export function shouldAbortAbandonedGenerate(input: {
  clientLeft: boolean;
  disconnectedForMs: number;
  hasWaiter: boolean;
  elapsedMs: number;
  graceMs?: number;
  lateBudgetMs?: number;
  producingTokens?: boolean;
  hardCapMs?: number;
}): boolean {
  if (!input.clientLeft || input.hasWaiter) return false;
  if (input.producingTokens) {
    const cap = input.hardCapMs ?? llmProducingGenerateHardCapMs();
    return input.elapsedMs >= cap;
  }
  const grace = input.graceMs ?? CLIENT_DISCONNECT_GRACE_MS;
  const late = input.lateBudgetMs ?? LLM_LATE_PERSIST_BUDGET_MS;
  if (input.elapsedMs >= late) return true;
  return input.disconnectedForMs >= grace;
}

/**
 * Companion turns are 2–4 sentences. Route tiers still advertise 4–8k
 * max_tokens; honoring that on Ollama lets anima-chat keep generating long
 * after the user already has a complete beat. Cap here, then honor the cap
 * on the local request (`honorCallerMaxTokens` in llmFailover).
 */
export const COMPANION_REPLY_MAX_TOKENS = 1024;

/**
 * Settings → Short (1-2 sentences). About two short sentences on the 0.5B
 * model. Medium and long keep the path's existing cap.
 */
export const SHORT_REPLY_MAX_TOKENS = 90;

export function companionReplyMaxTokens(routedMax: number): number {
  if (!Number.isFinite(routedMax) || routedMax <= 0) {
    return COMPANION_REPLY_MAX_TOKENS;
  }
  return Math.min(Math.floor(routedMax), COMPANION_REPLY_MAX_TOKENS);
}

/**
 * 1:1 companion turns stay capped for TTFT / stop-early. Group and explicit
 * deep-mode keep the router budget so long-form sessions are not truncated.
 * `responseLength: "short"` lowers that result to {@link SHORT_REPLY_MAX_TOKENS}.
 * A crisis turn keeps the uncapped result so the care reply is not shortened.
 */
export function chatReplyMaxTokens(
  routedMax: number,
  opts: { mode?: string; deepMode?: boolean; responseLength?: string | null; crisis?: boolean } = {},
): number {
  const full =
    opts.mode === "group" || opts.deepMode
      ? !Number.isFinite(routedMax) || routedMax <= 0
        ? COMPANION_REPLY_MAX_TOKENS
        : Math.floor(routedMax)
      : companionReplyMaxTokens(routedMax);
  if (opts.crisis) return full;
  if (String(opts.responseLength || "").trim().toLowerCase() === "short") {
    return Math.min(full, SHORT_REPLY_MAX_TOKENS);
  }
  return full;
}

export function llmOpenTimeoutMs(opts: { freeTierCascade?: boolean } = {}): number {
  return opts.freeTierCascade ? LLM_OPEN_TIMEOUT_FREE_TIER_MS : LLM_OPEN_TIMEOUT_MS;
}

function cappedConfiguredOpenTimeoutMs(cap: number): number {
  const configured = Number(process.env.ANIMA_LLM_OPEN_TIMEOUT_MS);
  if (Number.isFinite(configured) && configured > 0) {
    return Math.min(configured, cap);
  }
  return cap;
}

/**
 * Open budget for POST `/api/ai/chat`. Honors `ANIMA_LLM_OPEN_TIMEOUT_MS` for
 * tests/ops, but never exceeds the Worker-safe cap.
 */
export function llmAiChatOpenTimeoutMs(): number {
  return cappedConfiguredOpenTimeoutMs(LLM_OPEN_TIMEOUT_AI_CHAT_MS);
}

/**
 * Open budget for Chat.jsx POST `/api/chat/messages`.
 *
 * Local-only uses `LLM_LOCAL_FIRST_TOKEN_MS` (90s) so CPU prefill of a
 * capped companion prompt can emit a first token. This abort is cancelled
 * once `createChatStreamWithFailover` returns (headers received). When
 * headers arrive before the first token, `llmChatMessagesFirstChunkMs`
 * keeps the same first-token budget. When OpenRouter is actually in the
 * chain (`usesFreeTierOpenBudget()` / `freeTierCascade: true`), use the
 * 80s budget so workersai 4006 + m2.7→m3→Gemma hops share one signal
 * without aborting mid-cascade. When a next provider exists,
 * `LLM_LOCAL_FAILOVER_ATTEMPT_MS` (12s) still aborts the local attempt first.
 */
export function llmChatMessagesOpenTimeoutMs(
  opts: { freeTierCascade?: boolean } = {},
): number {
  return cappedConfiguredOpenTimeoutMs(
    opts.freeTierCascade
      ? LLM_OPEN_TIMEOUT_FREE_TIER_MS
      : LLM_OPEN_TIMEOUT_LOCAL_ONLY_MS,
  );
}

/**
 * First-chunk wait for POST `/api/chat/messages` after HTTP headers arrive.
 *
 * Local-only matches `LLM_LOCAL_FIRST_TOKEN_MS`. Headers from Ollama / the
 * tunnel proxy can flush before prefill finishes; this is the clock that
 * then waits for the first token. Idle time between later tokens is
 * `LLM_STREAM_STALL_MS`, not this budget.
 */
export function llmChatMessagesFirstChunkMs(
  opts: { freeTierCascade?: boolean } = {},
): number {
  return opts.freeTierCascade ? LLM_STREAM_FIRST_CHUNK_MS : LLM_LOCAL_FIRST_TOKEN_MS;
}

/**
 * Consume budget for POST `/api/chat/messages` after the stream is open.
 *
 * Local-only does not subtract the open budget. The open abort and the
 * first-chunk timer cover the same prefill (headers withheld vs headers
 * early); they overlap instead of stacking. The consume hard cap is the
 * first-token budget plus decode slack, so a 90s prefill can still finish
 * a short beat. Free-tier cascade still fits open + consume + context
 * slack under the browser abort.
 */
export function llmChatMessagesStreamTotalMs(
  opts: { freeTierCascade?: boolean } = {},
): number {
  if (!opts.freeTierCascade) {
    return Math.min(
      CHAT_STREAM_TIMEOUT_MS - CHAT_MESSAGES_CONTEXT_SLACK_MS,
      LLM_LOCAL_FIRST_TOKEN_MS + LLM_LOCAL_DECODE_SLACK_MS,
    );
  }
  return Math.max(
    LLM_STREAM_FIRST_CHUNK_MS,
    CHAT_STREAM_TIMEOUT_MS -
      llmChatMessagesOpenTimeoutMs(opts) -
      CHAT_MESSAGES_CONTEXT_SLACK_MS,
  );
}

/** Shortest window worth spending on the one repeat regenerate. */
export const REPEAT_RETRY_MIN_MS = 20_000;

/**
 * Time left for the repeat regenerate before the browser aborts the
 * `/chat/messages` fetch (`CHAT_STREAM_TIMEOUT_MS`, counted from the request).
 * 0 means skip the regenerate and deliver the first reply: a fresh full
 * budget used to run past the browser abort, so the turn never resolved.
 */
export function repeatRetryBudgetMs(elapsedMs: number): number {
  const left =
    CHAT_STREAM_TIMEOUT_MS - CHAT_MESSAGES_CONTEXT_SLACK_MS - Math.max(0, elapsedMs);
  return left >= REPEAT_RETRY_MIN_MS ? left : 0;
}

/**
 * One extra local generate for a copied reply. Skip it when another turn for
 * this user is already waiting on the single model slot.
 */
export function shouldRegenerateRepeatedReply(input: {
  retryBudgetMs: number;
  aborted: boolean;
  timedOut: boolean;
  repeated: boolean;
  otherWorkQueued: boolean;
}): boolean {
  return (
    input.retryBudgetMs > 0 &&
    !input.aborted &&
    !input.timedOut &&
    input.repeated &&
    !input.otherWorkQueued
  );
}

export {
  CHAT_MESSAGES_MAX_TOKENS,
  clampChatMessagesMaxTokens,
} from "./modelRouter";

export function combineAbortSignals(...signals: AbortSignal[]): AbortSignal {
  const live = signals.filter(Boolean);
  if (live.length === 0) return new AbortController().signal;
  if (live.length === 1) return live[0]!;
  if (typeof AbortSignal.any === "function") return AbortSignal.any(live);
  const controller = new AbortController();
  const listeners = new Map<AbortSignal, () => void>();
  const onAbort = () => {
    if (controller.signal.aborted) return;
    controller.abort();
    for (const [signal, listener] of listeners) {
      signal.removeEventListener("abort", listener);
    }
    listeners.clear();
  };
  for (const signal of live) {
    if (signal.aborted) {
      onAbort();
      break;
    }
    listeners.set(signal, onAbort);
    signal.addEventListener("abort", onAbort, { once: true });
  }
  return controller.signal;
}

export function openStreamAbort(ms: number): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  timer.unref?.();
  return {
    signal: controller.signal,
    cancel: () => clearTimeout(timer),
  };
}

/**
 * Abort when the SSE client disconnects before the response finishes.
 *
 * Listen on the response, not the request. Node fires `req` "close" when the
 * body has been read, which is before generation starts and would cancel
 * Ollama immediately. `res` "close" also fires after a normal `end`;
 * `writableEnded` is the finished-reply case and must not abort.
 */
export function abortWhenClientLeaves(res: {
  on: (event: string, listener: () => void) => void;
  off?: (event: string, listener: () => void) => void;
  writableEnded: boolean;
}): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const onClose = () => {
    if (!res.writableEnded) controller.abort();
  };
  res.on("close", onClose);
  return {
    signal: controller.signal,
    cancel: () => {
      res.off?.("close", onClose);
    },
  };
}

/**
 * Note that the SSE client went away without aborting the model.
 * Companion chat keeps the self-hosted generate running and saves the reply.
 */
export function watchClientLeave(res: {
  on: (event: string, listener: () => void) => void;
  off?: (event: string, listener: () => void) => void;
  writableEnded: boolean;
}): { left: () => boolean; cancel: () => void } {
  let gone = false;
  const onClose = () => {
    if (!res.writableEnded) gone = true;
  };
  res.on("close", onClose);
  return {
    left: () => gone,
    cancel: () => {
      res.off?.("close", onClose);
    },
  };
}

/**
 * Abort the upstream generate after the disconnect grace when no retry is
 * joined, and never let that orphaned generate run past the late-persist cap.
 * A connected response is left alone so a slow prefill can still finish.
 */
export function armAbandonedGenerateAbort(args: {
  res: {
    on: (event: string, listener: () => void) => void;
    off?: (event: string, listener: () => void) => void;
    writableEnded: boolean;
  };
  hasWaiter: () => boolean | Promise<boolean>;
  startedAt?: number;
  graceMs?: number;
  lateBudgetMs?: number;
  producingTokens?: () => boolean;
  hardCapMs?: number;
}): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const startedAt = args.startedAt ?? Date.now();
  const graceMs = args.graceMs ?? CLIENT_DISCONNECT_GRACE_MS;
  const lateBudgetMs = args.lateBudgetMs ?? LLM_LATE_PERSIST_BUDGET_MS;
  const hardCapMs = args.hardCapMs ?? llmProducingGenerateHardCapMs();
  let disconnectedAt: number | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancelled = false;

  const clearTimer = () => {
    if (!timer) return;
    clearTimeout(timer);
    timer = undefined;
  };

  const schedule = (ms: number) => {
    clearTimer();
    timer = setTimeout(() => {
      void tick();
    }, Math.max(1, ms));
    timer.unref?.();
  };

  const tick = async () => {
    if (cancelled || controller.signal.aborted) return;
    if (args.res.writableEnded || disconnectedAt == null) return;
    const now = Date.now();
    let waiting = false;
    try {
      waiting = await args.hasWaiter();
    } catch {
      waiting = false;
    }
    const disconnectedForMs = now - disconnectedAt;
    const elapsedMs = now - startedAt;
    const producing = args.producingTokens?.() ?? false;
    if (
      shouldAbortAbandonedGenerate({
        clientLeft: true,
        disconnectedForMs,
        hasWaiter: waiting,
        elapsedMs,
        graceMs,
        lateBudgetMs,
        producingTokens: producing,
        hardCapMs,
      })
    ) {
      controller.abort();
      return;
    }
    if (producing) {
      schedule(hardCapMs - elapsedMs);
      return;
    }
    if (waiting) {
      schedule(graceMs);
      return;
    }
    const untilGrace = graceMs - disconnectedForMs;
    const untilCap = lateBudgetMs - elapsedMs;
    schedule(Math.min(untilGrace, untilCap));
  };

  const onClose = () => {
    if (args.res.writableEnded || disconnectedAt != null) return;
    disconnectedAt = Date.now();
    const elapsedMs = disconnectedAt - startedAt;
    if (args.producingTokens?.()) {
      schedule(Math.max(1, hardCapMs - elapsedMs));
      return;
    }
    const untilGrace = graceMs;
    const untilCap = lateBudgetMs - elapsedMs;
    schedule(Math.min(untilGrace, Math.max(1, untilCap)));
  };

  args.res.on("close", onClose);
  return {
    signal: controller.signal,
    cancel: () => {
      cancelled = true;
      clearTimer();
      args.res.off?.("close", onClose);
    },
  };
}
