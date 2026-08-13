import { performance } from "node:perf_hooks";
import { logger } from "./logger";

type ChatTelemetryFields = {
  turnId: string;
  sessionId: string;
  mode: string;
};

export class ChatPipelineTelemetry {
  private readonly startedAt = performance.now();
  private generationStartedAt: number | null = null;
  private firstTokenAt: number | null = null;
  private readonly measurements: Record<string, number> = {};

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
  }

  markFirstToken(): void {
    if (this.firstTokenAt == null) this.firstTokenAt = performance.now();
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
            : Math.round(this.firstTokenAt - generationStart),
        generation_ms: Math.round(endedAt - generationStart),
        ...this.measurements,
        ...details,
      },
      "Chat pipeline telemetry",
    );
  }
}
