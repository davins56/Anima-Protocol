import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ChatPipelineTelemetry,
  chatErrorClass,
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
        provider: "local",
        model: "anima-chat",
      }),
      "Chat pipeline telemetry",
    );
  });

  it("does not attach failure fields to a completed turn", () => {
    const info = vi.spyOn(logger, "info").mockImplementation(() => {});
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
    const telemetrySource = readFileSync(
      join(repoRoot, "artifacts/api-server/src/lib/chatTelemetry.ts"),
      "utf8",
    );
    expect(telemetrySource).toContain("failure_phase: this.phase");
  });
});
