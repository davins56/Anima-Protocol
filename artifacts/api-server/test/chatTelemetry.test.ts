import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ChatPipelineTelemetry,
  chatErrorClass,
  chatErrorCode,
  replySurvivesDatabaseTimeout,
} from "../src/lib/chatTelemetry";
import { logger } from "../src/lib/logger";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");

describe("chatErrorClass", () => {
  it("uses the error name, not the message", () => {
    const dropped = Object.assign(
      new Error("Ollama /api/chat stream ended before the reply finished"),
      { name: "APIConnectionError" },
    );
    expect(chatErrorClass(dropped)).toBe("APIConnectionError");
    expect(chatErrorClass(new TypeError("fail"))).toBe("TypeError");
    expect(chatErrorClass("nope")).toBe("NonError");
  });

  it("reads the error code, including through cause", () => {
    const timeout = Object.assign(
      new Error("Database operation aborted due to timeout after 5000ms"),
      { name: "DbOperationTimeoutError", code: "ETIMEOUT" },
    );
    expect(chatErrorCode(timeout)).toBe("ETIMEOUT");
    expect(chatErrorCode(new Error("no code", { cause: timeout }))).toBe("ETIMEOUT");
    expect(chatErrorCode(new Error("plain"))).toBe("");
  });
});

describe("replySurvivesDatabaseTimeout", () => {
  const timeout = Object.assign(
    new Error("Database operation aborted due to timeout after 5000ms"),
    { name: "DbOperationTimeoutError", code: "ETIMEOUT" },
  );

  it("keeps text once generation has started", () => {
    expect(replySurvivesDatabaseTimeout("I stay.", "decode", timeout)).toBe(true);
    expect(replySurvivesDatabaseTimeout("I stay.", "post", timeout)).toBe(true);
  });

  it("does not keep a context-load timeout or an empty reply", () => {
    expect(replySurvivesDatabaseTimeout("", "queue", timeout)).toBe(false);
    expect(replySurvivesDatabaseTimeout("I stay.", "queue", timeout)).toBe(false);
    expect(
      replySurvivesDatabaseTimeout("I stay.", "decode", new Error("empty reply")),
    ).toBe(false);
  });
});

describe("ChatPipelineTelemetry failure phase", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("moves queue → prefill → decode → post", () => {
    const telemetry = new ChatPipelineTelemetry({
      turnId: "turn-1",
      sessionId: "session-1",
      mode: "solo",
    });
    expect(telemetry.currentPhase()).toBe("queue");
    telemetry.startGeneration();
    expect(telemetry.currentPhase()).toBe("prefill");
    telemetry.markFirstToken();
    expect(telemetry.currentPhase()).toBe("decode");
    telemetry.markFirstToken();
    expect(telemetry.currentPhase()).toBe("decode");
    telemetry.markReplySettled();
    expect(telemetry.currentPhase()).toBe("post");
  });

  it("logs failure_phase and error_class on a failed turn", () => {
    const info = vi.spyOn(logger, "info").mockImplementation(() => {});
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});
    const telemetry = new ChatPipelineTelemetry({
      turnId: "turn-1",
      sessionId: "session-1",
      mode: "solo",
    });
    telemetry.startGeneration();
    telemetry.markFirstToken();
    telemetry.report("failed", {
      provider: "local",
      model: "anima-chat",
      error_class: "APIConnectionError",
    });
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "chat_pipeline",
        outcome: "failed",
        failure_phase: "decode",
        error_class: "APIConnectionError",
        error_code: "",
        provider: "local",
        model: "anima-chat",
      }),
      "Chat pipeline telemetry",
    );
    expect(consoleInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "chat_pipeline",
        failure_phase: "decode",
        error_class: "APIConnectionError",
      }),
    );
  });

  it("does not attach failure fields to a completed turn", () => {
    const info = vi.spyOn(logger, "info").mockImplementation(() => {});
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});
    const telemetry = new ChatPipelineTelemetry({
      turnId: "turn-1",
      sessionId: "session-1",
      mode: "solo",
    });
    telemetry.markReplySettled();
    telemetry.report("completed", { provider: "local" });
    const payload = info.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.outcome).toBe("completed");
    expect(payload).not.toHaveProperty("failure_phase");
    expect(payload).not.toHaveProperty("error_class");
    expect(consoleInfo).not.toHaveBeenCalled();
  });

  it("wires the chat turn to keep an interrupted reply and log the failure phase", () => {
    const chatRoute = readFileSync(
      join(repoRoot, "artifacts/api-server/src/routes/chat.ts"),
      "utf8",
    );
    expect(chatRoute).toContain("onActivity: noteUpstreamChunk");
    expect(chatRoute).toContain("interruptedStreamKeepsReply(streamed)");
    expect(chatRoute).toContain("!streamInterrupted");
    expect(chatRoute).toContain("telemetry.markReplySettled()");
    expect(chatRoute).toContain("error_class: chatErrorClass(err)");
    expect(chatRoute).toContain("error_code: chatErrorCode(err)");
    expect(chatRoute).toContain("replySurvivesDatabaseTimeout");
    expect(chatRoute).toContain("keptPartialNeedsCutOff(");
    const swapAt = chatRoute.lastIndexOf("unresolvedSwap");
    const markAt = chatRoute.lastIndexOf("mainPartial &&");
    expect(swapAt).toBeGreaterThan(-1);
    expect(markAt).toBeGreaterThan(swapAt);
    const telemetrySource = readFileSync(
      join(repoRoot, "artifacts/api-server/src/lib/chatTelemetry.ts"),
      "utf8",
    );
    expect(telemetrySource).toContain("failure_phase: this.phase");
    expect(telemetrySource).toContain("error_code:");
    expect(telemetrySource).toContain('if (outcome === "failed") console.info(payload)');
    const pendingAt = chatRoute.indexOf("await sessionHasOlderPendingChatTurn(");
    expect(pendingAt).toBeGreaterThan(-1);
    expect(chatRoute.slice(pendingAt, pendingAt + 700)).toContain('closePipeline("failed"');
    const checkpointAt = chatRoute.indexOf("checkpointGeneratedTurnOnce({");
    const doneAt = chatRoute.indexOf("writeSse(res, {", checkpointAt);
    expect(checkpointAt).toBeGreaterThan(-1);
    expect(doneAt).toBeGreaterThan(checkpointAt);
    expect(chatRoute.slice(checkpointAt, doneAt)).not.toContain(
      "checkpointGeneratedTurnWithRetry",
    );
    const surviveAt = chatRoute.indexOf("if (replySurvivesDatabaseTimeout");
    const surviveDoneAt = chatRoute.indexOf("writeSse(res, keptDone)", surviveAt);
    const surviveRetryAt = chatRoute.indexOf(
      "checkpointGeneratedTurnWithRetry",
      surviveAt,
    );
    expect(surviveAt).toBeGreaterThan(-1);
    expect(surviveDoneAt).toBeGreaterThan(surviveAt);
    expect(surviveRetryAt).toBeGreaterThan(surviveDoneAt);
    const missingAt = chatRoute.indexOf('error_code: "session_not_found"');
    const missingReport = chatRoute.lastIndexOf("sessionLoadTelemetry.report(", missingAt);
    expect(chatRoute.slice(missingReport, missingAt)).toContain('"completed"');
  });
});
