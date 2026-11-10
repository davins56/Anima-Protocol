/**
 * Mid-stream fallback. `createChatStreamWithFailover` only fails over when a
 * stream refuses to open. If Workers AI opens and then dies before a single
 * visible token (overload, 4006 on first read, dropped socket), the turn used
 * to fail outright. This retries once on the next provider in the chain,
 * but only while nothing has reached the user, so there is never a
 * half-reply spliced onto a different model's continuation.
 */
export type StreamAttempt<TResult> = {
  provider: string;
  result: TResult;
};

export async function consumeWithMidstreamFallback<TOpen extends { provider: string }, TResult>(args: {
  open: (excludeProviders: string[]) => Promise<TOpen>;
  consume: (opened: TOpen) => Promise<TResult>;
  /** True once any visible text has been shown for this turn. */
  emittedVisible: () => boolean;
  /** True when another provider could still answer. */
  hasAlternative: (excludeProviders: string[]) => boolean;
  onFallback?: (fromProvider: string, error: unknown) => void;
  maxAttempts?: number;
}): Promise<{ opened: TOpen; result: TResult; attempts: number }> {
  const exclude: string[] = [];
  const maxAttempts = Math.max(1, args.maxAttempts ?? 2);
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const opened = await args.open([...exclude]);
    try {
      const result = await args.consume(opened);
      return { opened, result, attempts: attempt };
    } catch (err) {
      lastErr = err;
      exclude.push(opened.provider);
      const canRetry =
        attempt < maxAttempts && !args.emittedVisible() && args.hasAlternative([...exclude]);
      if (!canRetry) throw err;
      args.onFallback?.(opened.provider, err);
    }
  }
  throw lastErr;
}
