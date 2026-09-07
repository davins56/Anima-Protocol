/**
 * Chat LLM open / stream / client abort budgets.
 *
 * Production free-tier OpenRouter chat (`ANIMA_OPENROUTER_FREE=true`) hops
 * m2.7:free → m3:free → Gemma 4 on 400/429/5xx. Those hops plus the last
 * candidate's SDK retries share one AbortSignal from `openStreamAbort()`.
 * A 35s cap aborts mid-cascade and surfaces as
 * "The companion took too long to reply."
 *
 * Keep the browser fetch abort above the free-tier open budget so the
 * client does not cancel while the Worker is still hopping models.
 * SSE heartbeats (`SSE_HEARTBEAT_MS` in chat.ts) keep the connection alive.
 */

/** Paid / single-model stream-open budget. */
export const LLM_OPEN_TIMEOUT_MS = 35_000;

/**
 * Free-tier multi-candidate open budget. Two failed hops (m2.7 429/502,
 * m3 GMICloud 400) plus last-candidate retries must still be able to open.
 */
export const LLM_OPEN_TIMEOUT_FREE_TIER_MS = 80_000;

/** After the upstream stream is open, wait this long for first activity. */
export const LLM_STREAM_FIRST_CHUNK_MS = 35_000;

/** Once visible text has arrived, treat this idle gap as end-of-reply. */
export const LLM_STREAM_STALL_MS = 15_000;

/** Hard cap for consuming an already-open stream. */
export const LLM_STREAM_TOTAL_MS = 50_000;

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

export function openStreamAbort(ms: number): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  timer.unref?.();
  return {
    signal: controller.signal,
    cancel: () => clearTimeout(timer),
  };
}
