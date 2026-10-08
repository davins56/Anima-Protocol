import { performance } from "node:perf_hooks";
import { isDbOperationTimeoutError } from "./dbErrors";
import { logger } from "./logger";

type ChatTelemetryFields = {
  turnId: string;
  sessionId: string;
  mode: string;
};

/**
 * Where a failed turn died.
 * `queue` is everything before generation starts (including the local slot
 * wait). `prefill` is after the slot is held and before the first upstream
 * chunk. `decode` is once chunks are arriving. `post` is after the reply
 * text is in hand (checkpoint / empty-reply).
 */
export type ChatFailurePhase = "queue" | "prefill" | "decode" | "post";

/** Error.name for the chat_pipeline failed log. Not the message. */
export function chatErrorClass(err: unknown): string {
  if (err instanceof Error && err.name) return err.name;
  if (err && typeof err === "object") {
    const name = (err as { constructor?: { name?: unknown } }).constructor?.name;
    if (typeof name === "string" && name) return name;
  }
  return "NonError";
}

/** Error.code for the chat_pipeline failed log. Walks `cause`. Not the message. */
export function chatErrorCode(err: unknown): string {
  const seen = new Set<unknown>();
  let current: unknown = err;
  for (let depth = 0; depth < 6 && current; depth += 1) {
    if (seen.has(current)) break;
    seen.add(current);
    if (current && typeof current === "object" && "code" in current) {
      const code = (current as { code?: unknown }).code;
      if (typeof code === "string" && code) return code;
      if (typeof code === "number" && Number.isFinite(code)) return String(code);
    }
    current =
      current && typeof current === "object" && "cause" in current
        ? (current as { cause?: unknown }).cause
        : undefined;
  }
  return "";
}

/**
 * A database timeout after generation started must not discard reply text
 * that already arrived. A timeout still in `queue` (context load, before
 * the model) has nothing to keep.
 */
export function replySurvivesDatabaseTimeout(
  content: string,
  phase: ChatFailurePhase,
  err: unknown,
): boolean {
  return content.trim().length > 0 && phase !== "queue" && isDbOperationTimeoutError(err);
}

export class ChatPipelineTelemetry {
  private readonly startedAt = performance.now();
  private generationStartedAt: number | null = null;
  private firstTokenAt: number | null = null;
  private readonly measurements: Record<string, number> = {};
  private phase: ChatFailurePhase = "queue";

  constructor(private readonly fields: ChatTelemetryFields) {}

  async measure<T>(name: string, task: Promise<T>): Promise<T> {
    const startedAt = performance.now();
    try {
      return await task;
    } finally {
      this.measurements[name] = Math.round(performance.now() - startedAt);
    }
  }

  measureSync<T>(name: string, task: () => T): T {
    const startedAt = performance.now();
    try {
      return task();
    } finally {
      this.measurements[name] = Math.round(performance.now() - startedAt);
    }
  }

  startGeneration(): void {
    this.generationStartedAt = performance.now();
    if (this.phase === "queue") this.phase = "prefill";
  }

  markFirstToken(): void {
    if (this.firstTokenAt == null) this.firstTokenAt = performance.now();
    if (this.phase === "queue" || this.phase === "prefill") this.phase = "decode";
  }

  /** The model pass returned and the turn is in checkpoint / delivery. */
  markReplySettled(): void {
    this.phase = "post";
  }

  currentPhase(): ChatFailurePhase {
    return this.phase;
  }

  record(name: string, valueMs: number): void {
    this.measurements[name] = Math.max(0, Math.round(valueMs));
  }

  report(
    outcome: "completed" | "failed",
    details: Record<string, unknown> = {},
  ): void {
    const endedAt = performance.now();
    const generationStart = this.generationStartedAt ?? this.startedAt;
    const payload = {
      event: "chat_pipeline",
      outcome,
      turn_id: this.fields.turnId,
      session_id: this.fields.sessionId,
      mode: this.fields.mode,
      total_ms: Math.round(endedAt - this.startedAt),
      ttft_ms:
        this.firstTokenAt == null
          ? null
          : Math.round(this.firstTokenAt - this.startedAt),
      generation_ttft_ms:
        this.firstTokenAt == null
          ? null
          : Math.round(this.firstTokenAt - generationStart),
      generation_ms: Math.round(endedAt - generationStart),
      ...this.measurements,
      ...details,
      ...(outcome === "failed"
        ? {
            failure_phase: this.phase,
            error_class:
              typeof details.error_class === "string" && details.error_class
                ? details.error_class
                : "Error",
            error_code:
              typeof details.error_code === "string" ? details.error_code : "",
          }
        : {}),
    };
    logger.info(payload, "Chat pipeline telemetry");
    // Workers Logs index console.* reliably. pino's stdout line is the same
    // event, but a cancelled isolate or a stdout drop must not hide a failure.
    // Completed turns stay on the pino line so each success is not stored twice.
    if (outcome === "failed") console.info(payload);
  }
}
