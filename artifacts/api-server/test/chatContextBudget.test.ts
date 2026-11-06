import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  CHAT_CONTEXT_MESSAGES,
  chatContextMessageLimit,
} from "../src/lib/chatTimeouts";
import {
  OPTIONAL_CHAT_CONTEXT_MS,
  optionalChatContext,
  optionalChatContextTimeoutMs,
} from "../src/lib/optionalChatContext";
import { ChatPipelineTelemetry } from "../src/lib/chatTelemetry";

const MESSAGES_ENV = "ANIMA_CHAT_CONTEXT_MESSAGES";
const BUDGET_ENV = "ANIMA_CHAT_OPTIONAL_CONTEXT_MS";

afterEach(() => {
  delete process.env[MESSAGES_ENV];
  delete process.env[BUDGET_ENV];
});

describe("chat context budget", () => {
  it("keeps the prompt window at the deep-conversation depth by default", () => {
    // Lowering this default would also lower the routing depth threshold.
    expect(CHAT_CONTEXT_MESSAGES).toBe(24);
    expect(chatContextMessageLimit()).toBe(24);
  });

  it("clamps a configured window to a sane 6-40 messages", () => {
    process.env[MESSAGES_ENV] = "12";
    expect(chatContextMessageLimit()).toBe(12);

    process.env[MESSAGES_ENV] = "1";
    expect(chatContextMessageLimit()).toBe(6);

    process.env[MESSAGES_ENV] = "500";
    expect(chatContextMessageLimit()).toBe(40);

    process.env[MESSAGES_ENV] = "not-a-number";
    expect(chatContextMessageLimit()).toBe(CHAT_CONTEXT_MESSAGES);
  });

  it("defaults the optional context ceiling to 1.2s and honors an override", () => {
    expect(OPTIONAL_CHAT_CONTEXT_MS).toBe(1_200);
    expect(optionalChatContextTimeoutMs()).toBe(1_200);

    process.env[BUDGET_ENV] = "250";
    expect(optionalChatContextTimeoutMs()).toBe(250);

    process.env[BUDGET_ENV] = "-5";
    expect(optionalChatContextTimeoutMs()).toBe(1_200);
  });

  it("returns the fallback instead of waiting on a slow branch", async () => {
    process.env[BUDGET_ENV] = "20";
    const slow = () => new Promise<string>((r) => setTimeout(() => r("slow"), 250));

    const started = Date.now();
    const result = await optionalChatContext("memories", slow, "");
    const elapsed = Date.now() - started;

    expect(result).toBe("");
    // Expired at the budget, not after the branch finished.
    expect(elapsed).toBeLessThan(200);
  });

  it("still returns real context when the branch fits the budget", async () => {
    process.env[BUDGET_ENV] = "2_000";
    const result = await optionalChatContext("memories", async () => ["kept"], []);
    expect(result).toEqual(["kept"]);
  });

  it("wires the window and the gauges into the chat route", () => {
    const routePath = fileURLToPath(new URL("../src/routes/chat.ts", import.meta.url));
    const route = readFileSync(routePath, "utf8");
    expect(route).toContain("chatContextMessageLimit()");
    expect(route).toContain('telemetry.note("prompt_messages"');
    expect(route).toContain('telemetry.note("optional_context_budget_ms"');
  });

  it("reports gauges alongside durations on the pipeline payload", async () => {
    const telemetry = new ChatPipelineTelemetry({
      turnId: "turn-1",
      sessionId: "session-1",
      mode: "solo",
    });
    telemetry.note("prompt_messages", 17);
    await telemetry.measure("context_load_ms", Promise.resolve(null));

    // report() logs; capture the payload through the logger spy.
    const { logger } = await import("../src/lib/logger");
    const seen: Record<string, unknown>[] = [];
    const original = logger.info;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (logger as any).info = (payload: Record<string, unknown>) => {
      seen.push(payload);
    };
    try {
      telemetry.report("completed");
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (logger as any).info = original;
    }

    expect(seen).toHaveLength(1);
    expect(seen[0].prompt_messages).toBe(17);
    expect(typeof seen[0].context_load_ms).toBe("number");
  });
});
