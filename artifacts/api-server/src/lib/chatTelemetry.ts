import { performance } from "node:perf_hooks";
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
    logger.info(
      {
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
            }
          : {}),
      },
      "Chat pipeline telemetry",
    );
  }
}
