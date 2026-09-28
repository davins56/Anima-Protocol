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
 * the short reply uses `LLM_LOCAL_DECODE_SLACK_MS` on top of that, still
 * inside the 140s browser abort. `/api/ai/chat` stays at 18s (Worker wall).
 * Do not raise that probe.
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
 * Past the late-persist ceiling, a disconnected turn stops even sooner.
 */
export function shouldAbortAbandonedGenerate(input: {
  clientLeft: boolean;
  disconnectedForMs: number;
  hasWaiter: boolean;
  elapsedMs: number;
  graceMs?: number;
  lateBudgetMs?: number;
}): boolean {
  if (!input.clientLeft || input.hasWaiter) return false;
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

export function companionReplyMaxTokens(routedMax: number): number {
  if (!Number.isFinite(routedMax) || routedMax <= 0) {
    return COMPANION_REPLY_MAX_TOKENS;
  }
  return Math.min(Math.floor(routedMax), COMPANION_REPLY_MAX_TOKENS);
}

/**
 * 1:1 companion turns stay capped for TTFT / stop-early. Group and explicit
 * deep-mode keep the router budget so long-form sessions are not truncated.
 */
export function chatReplyMaxTokens(
  routedMax: number,
  opts: { mode?: string; deepMode?: boolean } = {},
): number {
  if (opts.mode === "group" || opts.deepMode) {
    if (!Number.isFinite(routedMax) || routedMax <= 0) {
      return COMPANION_REPLY_MAX_TOKENS;
    }
    return Math.floor(routedMax);
  }
  return companionReplyMaxTokens(routedMax);
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
}): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const startedAt = args.startedAt ?? Date.now();
  const graceMs = args.graceMs ?? CLIENT_DISCONNECT_GRACE_MS;
  const lateBudgetMs = args.lateBudgetMs ?? LLM_LATE_PERSIST_BUDGET_MS;
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
    if (
      shouldAbortAbandonedGenerate({
        clientLeft: true,
        disconnectedForMs,
        hasWaiter: waiting,
        elapsedMs,
        graceMs,
        lateBudgetMs,
      })
    ) {
      controller.abort();
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
