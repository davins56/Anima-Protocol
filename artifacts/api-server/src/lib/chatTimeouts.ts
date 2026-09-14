/**
 * Chat LLM open / stream / client abort budgets.
 *
 * Production chat is local-only (`chain: ["local"]`). Signed-in SSE
 * (`/api/chat`, `/api/openai`) is long-lived and may use the 35s
 * single-model open budget. The unused OpenRouter :free key must not
 * stretch that wait to 80s (`usesFreeTierOpenBudget()`).
 *
 * POST `/api/ai/chat` is NOT long-lived. An 80s (or even 35s) open abort
 * outlives the Worker ~20s wall, so the client sees 0 bytes instead of
 * JSON. Cap that path under the wall (`LLM_OPEN_TIMEOUT_AI_CHAT_MS`).
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
 * Signed-in SSE only — never `/api/ai/chat`.
 */
export const LLM_OPEN_TIMEOUT_FREE_TIER_MS = 80_000;

/**
 * Unauthenticated `/api/ai/chat` open budget. Must finish before the
 * Worker ~20s isolate wall (`WORKER_API_TIMEOUT_MS`) so a hung Fly/Ollama
 * generate returns JSON `ai_timeout` instead of a 0-byte cut.
 */
export const LLM_OPEN_TIMEOUT_AI_CHAT_MS = 18_000;

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
 * Browser `fetch` abort for `/chat/messages`.
 * Covers a full free-tier open plus a first-chunk wait so the UI does not
 * throw a generic abort while the Worker is still working.
 */
export const CHAT_STREAM_TIMEOUT_MS =
  LLM_OPEN_TIMEOUT_FREE_TIER_MS + LLM_STREAM_FIRST_CHUNK_MS;

export function llmOpenTimeoutMs(opts: { freeTierCascade?: boolean } = {}): number {
  return opts.freeTierCascade ? LLM_OPEN_TIMEOUT_FREE_TIER_MS : LLM_OPEN_TIMEOUT_MS;
}

/**
 * Open budget for POST `/api/ai/chat`. Honors `ANIMA_LLM_OPEN_TIMEOUT_MS` for
 * tests/ops, but never exceeds the Worker-safe cap.
 */
export function llmAiChatOpenTimeoutMs(): number {
  const configured = Number(process.env.ANIMA_LLM_OPEN_TIMEOUT_MS);
  if (Number.isFinite(configured) && configured > 0) {
    return Math.min(configured, LLM_OPEN_TIMEOUT_AI_CHAT_MS);
  }
  return LLM_OPEN_TIMEOUT_AI_CHAT_MS;
}

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
