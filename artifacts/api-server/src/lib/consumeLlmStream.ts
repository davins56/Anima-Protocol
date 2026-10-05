/**
 * Consume an OpenAI-compatible chat stream with hard deadlines.
 *
 * Without this, a hung upstream (no [DONE], stalled tunnel, reasoning-only
 * models that never emit `content`) keeps the SSE response open. The Chat UI
 * then stays on "Processing..." until the platform kills the function.
 *
 * - Any chunk resets the activity timer (including reasoning-only deltas).
 * - The short stall budget applies only after visible content has arrived.
 *   Reasoning-only prefixes keep the first-chunk window so MiniMax :free
 *   thinking tokens do not trip "took too long" before the reply starts.
 * - If we already have visible text and the stream stalls, treat that as the
 *   end of the reply instead of hanging forever.
 * - If nothing usable arrives before the first-chunk deadline, throw.
 */

import {
  LLM_STREAM_FIRST_CHUNK_MS,
  LLM_STREAM_STALL_MS,
  LLM_STREAM_TOTAL_MS,
} from "./chatTimeouts";
import {
  createVisibleReplyFilter,
  finalizeAssistantReply,
  hasThinkMarkup,
} from "./visibleAssistantReply";

export {
  LLM_STREAM_FIRST_CHUNK_MS,
  LLM_STREAM_STALL_MS,
  LLM_STREAM_TOTAL_MS,
};

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

  let rawContent = "";
  let reasoning = "";
  let sawReasoning = false;
  const filter = createVisibleReplyFilter();
  const started = Date.now();
  let lastActivity = started;
  let emittedAny = false;
  const iterator = stream[Symbol.asyncIterator]();
  // Think-inner text is painted, but it is not a post-think answer. Keep the
  // first-chunk window until remainder text arrives so a short pause after
  // `<think>` does not cut the stream. Unclosed think-only still finalizes
  // with inner text when the iterator ends or the first-chunk budget expires.
  const hasVisible = () => filter.hasPostThinkAnswer();

  const finalize = (timedOut: boolean): ConsumeLlmStreamResult => {
    const finished = filter.finish();
    const visible = finalizeAssistantReply(
      finished.visible,
      reasoning,
      rawContent,
    );
    if (finished.emitted) {
      opts.onDelta?.(finished.emitted);
    } else if (visible && !emittedAny) {
      opts.onDelta?.(visible);
    }
    return { content: visible, timedOut };
  };

  const nextWithDeadline = async (): Promise<WaitResult> => {
    const elapsed = Date.now() - started;
    const sinceActivity = Date.now() - lastActivity;
    const stallBudget = hasVisible() ? stallMs : firstChunkMs;
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
      const stallBudget = hasVisible() ? stallMs : firstChunkMs;
      if (elapsed >= totalMs || sinceActivity >= stallBudget) {
        const result = finalize(true);
        if (result.content) return result;
        throw timeoutError(rawContent);
      }

      const waited = await nextWithDeadline();
      if (waited.kind === "timeout") {
        const result = finalize(true);
        if (result.content) return result;
        throw timeoutError(rawContent);
      }
      if (waited.result.done) {
        return finalize(false);
      }

      lastActivity = Date.now();
      const chunk = waited.result.value;
      if (chunkIsReasoning(chunk)) {
        const think =
          chunk.choices?.[0]?.delta?.reasoning ??
          chunk.choices?.[0]?.delta?.reasoning_content;
        if (typeof think === "string" && think) reasoning += think;
        if (!sawReasoning) {
          sawReasoning = true;
          opts.onReasoning?.();
        }
      }
      const delta = chunkTextDelta(chunk);
      if (delta) {
        rawContent += delta;
        if (!sawReasoning && hasThinkMarkup(rawContent)) {
          sawReasoning = true;
          opts.onReasoning?.();
        }
        const extra = filter.push(delta);
        if (extra) {
          emittedAny = true;
          opts.onDelta?.(extra);
        }
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
