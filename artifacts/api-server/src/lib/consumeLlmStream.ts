/**
 * Consume an OpenAI-compatible chat stream with hard deadlines.
 *
 * Without this, a hung upstream (no [DONE], stalled tunnel, reasoning-only
 * models that never emit `content`) keeps the SSE response open. The Chat UI
 * then stays on "Processing..." until the platform kills the function.
 *
 * - Any chunk resets the stall timer (including reasoning-only deltas).
 * - If we already have visible text and the stream stalls, treat that as the
 *   end of the reply instead of hanging forever.
 * - If nothing usable arrives before the deadline, throw.
 */

export const LLM_STREAM_FIRST_CHUNK_MS = 35_000;
export const LLM_STREAM_STALL_MS = 15_000;
export const LLM_STREAM_TOTAL_MS = 50_000;

export interface ChatStreamChunk {
  choices?: Array<{
    delta?: {
      content?: string | null;
      reasoning?: string | null;
      reasoning_content?: string | null;
    };
    finish_reason?: string | null;
  }>;
}

export class LlmStreamTimeoutError extends Error {
  partialContent: string;
  constructor(message: string, partialContent = "") {
    super(message);
    this.name = "LlmStreamTimeoutError";
    this.partialContent = partialContent;
  }
}

export function chunkTextDelta(chunk: ChatStreamChunk | null | undefined): string {
  const content = chunk?.choices?.[0]?.delta?.content;
  return typeof content === "string" ? content : "";
}

export function chunkIsReasoning(chunk: ChatStreamChunk | null | undefined): boolean {
  const delta = chunk?.choices?.[0]?.delta;
  if (!delta) return false;
  if (typeof delta.content === "string" && delta.content) return false;
  const reasoning = delta.reasoning ?? delta.reasoning_content;
  return typeof reasoning === "string" && reasoning.length > 0;
}

function timeoutError(partial: string): LlmStreamTimeoutError {
  return new LlmStreamTimeoutError(
    "The companion took too long to reply. Please try again.",
    partial,
  );
}

export interface ConsumeLlmStreamOptions {
  onDelta?: (delta: string) => void;
  onReasoning?: () => void;
  firstChunkMs?: number;
  stallMs?: number;
  totalMs?: number;
}

export interface ConsumeLlmStreamResult {
  content: string;
  /** True when we cut the stream short because it stalled or hit the deadline. */
  timedOut: boolean;
}

type WaitResult =
  | { kind: "next"; result: IteratorResult<ChatStreamChunk> }
  | { kind: "timeout" };

/**
 * Pull chunks from `stream` until it ends or a deadline fires.
 */
export async function consumeLlmStream(
  stream: AsyncIterable<ChatStreamChunk>,
  opts: ConsumeLlmStreamOptions = {},
): Promise<ConsumeLlmStreamResult> {
  const firstChunkMs = opts.firstChunkMs ?? LLM_STREAM_FIRST_CHUNK_MS;
  const stallMs = opts.stallMs ?? LLM_STREAM_STALL_MS;
  const totalMs = opts.totalMs ?? LLM_STREAM_TOTAL_MS;

  let content = "";
  let sawReasoning = false;
  const started = Date.now();
  let lastActivity = started;
  const iterator = stream[Symbol.asyncIterator]();

  const nextWithDeadline = async (): Promise<WaitResult> => {
    const elapsed = Date.now() - started;
    const sinceActivity = Date.now() - lastActivity;
    const stallBudget = content || sawReasoning ? stallMs : firstChunkMs;
    const wait = Math.max(
      1,
      Math.min(stallBudget - sinceActivity, totalMs - elapsed),
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        iterator.next().then((result) => ({ kind: "next" as const, result })),
        new Promise<WaitResult>((resolve) => {
          timer = setTimeout(() => resolve({ kind: "timeout" }), wait);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  try {
    while (true) {
      const elapsed = Date.now() - started;
      const sinceActivity = Date.now() - lastActivity;
      const stallBudget = content || sawReasoning ? stallMs : firstChunkMs;
      if (elapsed >= totalMs || sinceActivity >= stallBudget) {
        if (content.trim()) return { content, timedOut: true };
        throw timeoutError(content);
      }

      const waited = await nextWithDeadline();
      if (waited.kind === "timeout") {
        if (content.trim()) return { content, timedOut: true };
        throw timeoutError(content);
      }
      if (waited.result.done) {
        return { content, timedOut: false };
      }

      lastActivity = Date.now();
      const chunk = waited.result.value;
      if (chunkIsReasoning(chunk) && !sawReasoning) {
        sawReasoning = true;
        opts.onReasoning?.();
      }
      const delta = chunkTextDelta(chunk);
      if (delta) {
        content += delta;
        opts.onDelta?.(delta);
      }
    }
  } finally {
    // Don't await return() — a hung upstream iterator would block the timeout
    // path that this helper exists to provide.
    try {
      void iterator.return?.();
    } catch {
      // Upstream cancel is best-effort.
    }
  }
}
