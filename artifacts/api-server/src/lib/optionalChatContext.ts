import { logger } from "./logger";

/**
 * Ceiling for one optional enrichment branch (memories, weather, derived
 * state). The turn already runs these in parallel, so this bounds the slowest
 * branch — and therefore how long the reply waits before the model is even
 * called. Prefill, not this, is the bigger cost on the local host, but an
 * unbounded branch is dead time the user feels.
 *
 * Every caller passes a "no context" fallback, so expiring is always safe: it
 * costs recall for that turn, never correctness. Override per deployment with
 * `ANIMA_CHAT_OPTIONAL_CONTEXT_MS`.
 */
export const OPTIONAL_CHAT_CONTEXT_MS = 1_200;

export function optionalChatContextTimeoutMs(): number {
  const raw = Number(process.env.ANIMA_CHAT_OPTIONAL_CONTEXT_MS);
  if (!Number.isFinite(raw) || raw <= 0) return OPTIONAL_CHAT_CONTEXT_MS;
  return Math.min(Math.floor(raw), 60_000);
}

class OptionalChatContextBudgetError extends Error {
  constructor(label: string, budgetMs: number) {
    super(`Optional chat context "${label}" exceeded ${budgetMs}ms`);
    this.name = "OptionalChatContextBudgetError";
  }
}

/**
 * Best-effort enrichment only (memories, weather, and derived state).
 * Character identity and conversation history must not use this fallback:
 * lean client prompts do not contain a backup of those required inputs.
 */
export async function optionalChatContext<T>(
  label: string,
  run: () => Promise<T>,
  fallback: T,
): Promise<T> {
  const budgetMs = optionalChatContextTimeoutMs();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const work = (async () => run())();
    const expired = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new OptionalChatContextBudgetError(label, budgetMs)),
        budgetMs,
      );
    });
    // Race, not await: a slow branch must not hold the reply open. The losing
    // promise keeps its own handlers, so a late rejection is already settled.
    return await Promise.race([work, expired]);
  } catch (err) {
    logger.warn(
      { err, label, budget_ms: budgetMs },
      "Optional chat context unavailable; continuing the reply without it",
    );
    return fallback;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
