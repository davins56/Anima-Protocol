import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CHAT_MESSAGES_CONTEXT_SLACK_MS,
  CHAT_STREAM_TIMEOUT_MS,
  LLM_LOCAL_FAILOVER_ATTEMPT_MS,
  LLM_OPEN_TIMEOUT_AI_CHAT_MS,
  LLM_OPEN_TIMEOUT_FREE_TIER_MS,
  LLM_LOCAL_DECODE_SLACK_MS,
  LLM_LOCAL_FIRST_TOKEN_MS,
  LLM_OPEN_TIMEOUT_LOCAL_ONLY_MS,
  LLM_OPEN_TIMEOUT_MS,
  LLM_STREAM_FIRST_CHUNK_MS,
  llmAiChatOpenTimeoutMs,
  llmChatMessagesFirstChunkMs,
  llmChatMessagesOpenTimeoutMs,
  llmChatMessagesStreamTotalMs,
  REPEAT_RETRY_MIN_MS,
  repeatRetryBudgetMs,
  shouldRegenerateRepeatedReply,
  CLIENT_DISCONNECT_GRACE_MS,
  LLM_LATE_PERSIST_BUDGET_MS,
  llmCompanionDurableWaitMs,
  llmProducingGenerateHardCapMs,
  shouldAbortAbandonedGenerate,
  WORKER_WAIT_UNTIL_GRACE_MS,
  abortWhenClientLeaves,
  llmOpenTimeoutMs,
  openStreamAbort,
  COMPANION_REPLY_MAX_TOKENS,
  companionReplyMaxTokens,
  chatReplyMaxTokens,
} from "../src/lib/chatTimeouts";
import { WORKER_API_TIMEOUT_MS } from "../src/lib/workerApiGuard";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");

describe("llmOpenTimeoutMs", () => {
  it("keeps the 35s budget for a single-model / paid open", () => {
    expect(LLM_OPEN_TIMEOUT_MS).toBe(35_000);
    expect(llmOpenTimeoutMs()).toBe(35_000);
    expect(llmOpenTimeoutMs({ freeTierCascade: false })).toBe(35_000);
  });

  it("caps companion replies below the routed 4–8k max_tokens", () => {
    expect(COMPANION_REPLY_MAX_TOKENS).toBe(1024);
    expect(companionReplyMaxTokens(8192)).toBe(1024);
    expect(companionReplyMaxTokens(200)).toBe(200);
    expect(companionReplyMaxTokens(0)).toBe(1024);
  });

  it("keeps the router budget for group and deep-mode turns", () => {
    expect(chatReplyMaxTokens(8192)).toBe(1024);
    expect(chatReplyMaxTokens(8192, { mode: "solo" })).toBe(1024);
    expect(chatReplyMaxTokens(8192, { mode: "group" })).toBe(8192);
    expect(chatReplyMaxTokens(4096, { deepMode: true })).toBe(4096);
    expect(chatReplyMaxTokens(0, { mode: "group" })).toBe(1024);
  });

  it("gives free-tier multi-candidate failover an 80s open budget", () => {
    expect(LLM_OPEN_TIMEOUT_FREE_TIER_MS).toBe(80_000);
    expect(llmOpenTimeoutMs({ freeTierCascade: true })).toBe(80_000);
  });

  it("caps /api/ai/chat open timeout under the Worker wall", () => {
    expect(LLM_OPEN_TIMEOUT_AI_CHAT_MS).toBe(18_000);
    expect(LLM_OPEN_TIMEOUT_AI_CHAT_MS).toBeLessThanOrEqual(18_000);
    expect(LLM_OPEN_TIMEOUT_AI_CHAT_MS).toBeLessThan(WORKER_API_TIMEOUT_MS);
    expect(LLM_LOCAL_FAILOVER_ATTEMPT_MS).toBeLessThan(LLM_OPEN_TIMEOUT_AI_CHAT_MS);
    expect(llmAiChatOpenTimeoutMs()).toBe(18_000);
    expect(llmAiChatOpenTimeoutMs()).toBeLessThan(WORKER_API_TIMEOUT_MS);
  });

  it("does not let the 80s free-tier budget stretch /api/ai/chat", () => {
    const previous = process.env.ANIMA_LLM_OPEN_TIMEOUT_MS;
    try {
      process.env.ANIMA_LLM_OPEN_TIMEOUT_MS = String(LLM_OPEN_TIMEOUT_FREE_TIER_MS);
      expect(llmAiChatOpenTimeoutMs()).toBe(LLM_OPEN_TIMEOUT_AI_CHAT_MS);
      process.env.ANIMA_LLM_OPEN_TIMEOUT_MS = "250";
      expect(llmAiChatOpenTimeoutMs()).toBe(250);
    } finally {
      if (previous === undefined) delete process.env.ANIMA_LLM_OPEN_TIMEOUT_MS;
      else process.env.ANIMA_LLM_OPEN_TIMEOUT_MS = previous;
    }
  });

  it("keeps /api/chat/messages on the 90s local-only first-token budget unless OpenRouter is in the chain", () => {
    expect(LLM_LOCAL_FIRST_TOKEN_MS).toBe(90_000);
    expect(LLM_OPEN_TIMEOUT_LOCAL_ONLY_MS).toBe(LLM_LOCAL_FIRST_TOKEN_MS);
    expect(llmChatMessagesOpenTimeoutMs()).toBe(90_000);
    expect(llmChatMessagesFirstChunkMs()).toBe(LLM_LOCAL_FIRST_TOKEN_MS);
    expect(llmChatMessagesFirstChunkMs({ freeTierCascade: true })).toBe(
      LLM_STREAM_FIRST_CHUNK_MS,
    );
    expect(llmChatMessagesOpenTimeoutMs()).toBeGreaterThan(LLM_OPEN_TIMEOUT_MS);
    expect(llmChatMessagesOpenTimeoutMs()).toBeGreaterThan(LLM_OPEN_TIMEOUT_AI_CHAT_MS);
    expect(llmChatMessagesOpenTimeoutMs()).toBeGreaterThan(LLM_OPEN_TIMEOUT_FREE_TIER_MS);
    expect(LLM_LOCAL_FAILOVER_ATTEMPT_MS).toBeLessThan(llmChatMessagesOpenTimeoutMs());
    expect(llmChatMessagesOpenTimeoutMs()).toBeLessThan(100_000);
    expect(
      llmChatMessagesOpenTimeoutMs() + CHAT_MESSAGES_CONTEXT_SLACK_MS,
    ).toBeLessThan(CHAT_STREAM_TIMEOUT_MS);
  });

  it("gives /api/chat/messages the 80s free-tier open budget when OpenRouter is in the chain", () => {
    expect(llmChatMessagesOpenTimeoutMs({ freeTierCascade: true })).toBe(
      LLM_OPEN_TIMEOUT_FREE_TIER_MS,
    );
    expect(
      llmChatMessagesOpenTimeoutMs({ freeTierCascade: true }) +
        llmChatMessagesStreamTotalMs({ freeTierCascade: true }) +
        CHAT_MESSAGES_CONTEXT_SLACK_MS,
    ).toBeLessThanOrEqual(CHAT_STREAM_TIMEOUT_MS);
  });

  it("leaves decode room after a slow local-only prefill", () => {
    expect(LLM_LOCAL_DECODE_SLACK_MS).toBe(30_000);
    expect(llmChatMessagesStreamTotalMs()).toBe(
      LLM_LOCAL_FIRST_TOKEN_MS + LLM_LOCAL_DECODE_SLACK_MS,
    );
    expect(llmChatMessagesStreamTotalMs()).toBeGreaterThan(
      llmChatMessagesFirstChunkMs(),
    );
    expect(
      CHAT_MESSAGES_CONTEXT_SLACK_MS + llmChatMessagesStreamTotalMs(),
    ).toBeLessThan(CHAT_STREAM_TIMEOUT_MS);
  });

  it("does not let the 80s free-tier budget stretch local-only /api/chat/messages", () => {
    const previous = process.env.ANIMA_LLM_OPEN_TIMEOUT_MS;
    try {
      process.env.ANIMA_LLM_OPEN_TIMEOUT_MS = "120000";
      expect(llmChatMessagesOpenTimeoutMs()).toBe(LLM_OPEN_TIMEOUT_LOCAL_ONLY_MS);
      expect(llmChatMessagesOpenTimeoutMs({ freeTierCascade: true })).toBe(
        LLM_OPEN_TIMEOUT_FREE_TIER_MS,
      );
      process.env.ANIMA_LLM_OPEN_TIMEOUT_MS = "250";
      expect(llmChatMessagesOpenTimeoutMs()).toBe(250);
    } finally {
      if (previous === undefined) delete process.env.ANIMA_LLM_OPEN_TIMEOUT_MS;
      else process.env.ANIMA_LLM_OPEN_TIMEOUT_MS = previous;
    }
  });

  it("covers two slow failed hops plus a last-candidate open", () => {
    const twoFailedHopsMs = 12_000 * 2;
    const lastCandidateOpenMs = 15_000;
    expect(LLM_OPEN_TIMEOUT_MS).toBeLessThan(twoFailedHopsMs + lastCandidateOpenMs);
    expect(LLM_OPEN_TIMEOUT_FREE_TIER_MS).toBeGreaterThan(
      twoFailedHopsMs + lastCandidateOpenMs,
    );
  });

  it("keeps the client abort above the free-tier open plus first-chunk wait", () => {
    expect(CHAT_STREAM_TIMEOUT_MS).toBe(
      LLM_OPEN_TIMEOUT_FREE_TIER_MS +
        LLM_STREAM_FIRST_CHUNK_MS +
        CHAT_MESSAGES_CONTEXT_SLACK_MS,
    );
    expect(CHAT_STREAM_TIMEOUT_MS).toBeGreaterThan(LLM_OPEN_TIMEOUT_FREE_TIER_MS);
  });
});

describe("abortWhenClientLeaves", () => {
  it("aborts when the client closes before the response finishes", () => {
    const res = new EventEmitter() as EventEmitter & {
      writableEnded: boolean;
      off: (event: string, listener: () => void) => void;
    };
    res.writableEnded = false;
    const { signal, cancel } = abortWhenClientLeaves(res);
    expect(signal.aborted).toBe(false);
    res.emit("close");
    expect(signal.aborted).toBe(true);
    cancel();
  });

  it("does not abort a response that already finished", () => {
    const res = new EventEmitter() as EventEmitter & { writableEnded: boolean };
    res.writableEnded = true;
    const { signal, cancel } = abortWhenClientLeaves(res);
    res.emit("close");
    expect(signal.aborted).toBe(false);
    cancel();
  });
});

describe("openStreamAbort", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("aborts the paid open budget at 35s", () => {
    vi.useFakeTimers();
    const { signal, cancel } = openStreamAbort(llmOpenTimeoutMs());
    vi.advanceTimersByTime(34_999);
    expect(signal.aborted).toBe(false);
    vi.advanceTimersByTime(1);
    expect(signal.aborted).toBe(true);
    cancel();
  });

  it("aborts the /api/ai/chat open budget at 18s", () => {
    vi.useFakeTimers();
    const { signal, cancel } = openStreamAbort(llmAiChatOpenTimeoutMs());
    vi.advanceTimersByTime(17_999);
    expect(signal.aborted).toBe(false);
    vi.advanceTimersByTime(1);
    expect(signal.aborted).toBe(true);
    cancel();
  });

  it("aborts the /api/chat/messages open budget at 90s for local-only prefill", () => {
    vi.useFakeTimers();
    const { signal, cancel } = openStreamAbort(llmChatMessagesOpenTimeoutMs());
    vi.advanceTimersByTime(89_999);
    expect(signal.aborted).toBe(false);
    vi.advanceTimersByTime(1);
    expect(signal.aborted).toBe(true);
    cancel();
  });

  it("lets a free-tier cascade keep working past the old 35s abort", () => {
    vi.useFakeTimers();
    const { signal, cancel } = openStreamAbort(
      llmOpenTimeoutMs({ freeTierCascade: true }),
    );
    vi.advanceTimersByTime(35_000);
    expect(signal.aborted).toBe(false);
    vi.advanceTimersByTime(44_999);
    expect(signal.aborted).toBe(false);
    vi.advanceTimersByTime(1);
    expect(signal.aborted).toBe(true);
    cancel();
  });
});

describe("client/server budget lockstep", () => {
  it("wires the chat-messages open budget to the free-tier cascade when OpenRouter is in the chain", () => {
    const chatRoute = readFileSync(
      join(repoRoot, "artifacts/api-server/src/routes/chat.ts"),
      "utf8",
    );
    expect(chatRoute).toContain("llmChatMessagesOpenTimeoutMs({ freeTierCascade })");
    expect(chatRoute).toContain("llmChatMessagesFirstChunkMs({ freeTierCascade })");
    expect(chatRoute).toContain("llmChatMessagesStreamTotalMs({ freeTierCascade })");
    expect(chatRoute).toContain("usesFreeTierOpenBudget()");
    expect(chatRoute).toContain("chatReplyMaxTokens(");
    expect(chatRoute).toContain("scheduleLeftoverTurnRepair(");
    expect(chatRoute).toContain("attachStoredEmbeddings(userId, adapted).catch(");
    expect(chatRoute).toContain("openStreamAbort(");
    expect(chatRoute).toContain("llmCompanionDurableWaitMs()");
    expect(chatRoute).toContain("armAbandonedGenerateAbort(");
    expect(chatRoute).toContain("watchClientLeave(");
    expect(chatRoute).not.toContain("abortWhenClientLeaves(");
    expect(chatRoute).not.toContain(
      "llmOpenTimeoutMs({ freeTierCascade: usesFreeTierOpenBudget() })",
    );
    expect(chatRoute).not.toMatch(/const LLM_OPEN_TIMEOUT_MS = 35_000/);
    expect(chatRoute).not.toMatch(/maxTokens: routed\.maxTokens/);
    expect(chatRoute).toContain("queryCompanionMemories");
    expect(chatRoute).toContain("optionalChatContext");
    expect(chatRoute).toContain("matchEntityIds");
    expect(chatRoute).toMatch(
      /Generated-turn checkpoint failed; delivering the reply anyway/,
    );
    expect(chatRoute).not.toMatch(/inArray\(companionMemories/);
    expect(chatRoute).not.toMatch(/inArray\(userEntities/);
    expect(chatRoute).toContain("resetEnsureSchemaLatch");
    expect(chatRoute).toContain("streamErrorMessage");
    expect(chatRoute).toMatch(
      /if \(!\/companion_memories\/i\.test\(blob\)\) return false;/,
    );
  });

  it("arms a Worker-safe open abort on the unauthenticated /api/ai/chat probe", () => {
    const appRoute = readFileSync(
      join(repoRoot, "artifacts/api-server/src/app.ts"),
      "utf8",
    );
    expect(appRoute).toContain("llmAiChatOpenTimeoutMs()");
    expect(appRoute).toContain("openStreamAbort(");
    expect(appRoute).toContain("signal: open.signal");
    expect(appRoute).not.toContain(
      "llmOpenTimeoutMs({ freeTierCascade: usesFreeTierOpenBudget() })",
    );
    expect(appRoute).toContain("The companion returned an empty reply. Please try again.");
  });

  it("keeps the browser fetch abort equal to the documented client budget", () => {
    const animaApi = readFileSync(
      join(repoRoot, "artifacts/anima-protocol/src/api/animaApi.js"),
      "utf8",
    );
    expect(animaApi).toMatch(/CHAT_STREAM_TIMEOUT_MS = 140_000/);
    expect(CHAT_STREAM_TIMEOUT_MS).toBe(140_000);
  });

  it("caps an abandoned companion generate well below the old 170s durable wait", () => {
    expect(WORKER_WAIT_UNTIL_GRACE_MS).toBe(30_000);
    expect(CLIENT_DISCONNECT_GRACE_MS).toBeGreaterThanOrEqual(20_000);
    expect(CLIENT_DISCONNECT_GRACE_MS).toBeLessThanOrEqual(30_000);
    expect(LLM_LATE_PERSIST_BUDGET_MS).toBe(60_000);
    expect(llmCompanionDurableWaitMs()).toBe(LLM_LATE_PERSIST_BUDGET_MS);
    expect(llmCompanionDurableWaitMs()).toBeLessThan(CHAT_STREAM_TIMEOUT_MS);
    expect(llmCompanionDurableWaitMs()).toBeLessThan(170_000);
    expect(llmChatMessagesOpenTimeoutMs()).toBe(90_000);
    expect(llmChatMessagesOpenTimeoutMs()).toBeLessThan(100_000);
  });
});

describe("shouldAbortAbandonedGenerate", () => {
  it("keeps a connected turn and a joined retry", () => {
    expect(
      shouldAbortAbandonedGenerate({
        clientLeft: false,
        disconnectedForMs: 60_000,
        hasWaiter: false,
        elapsedMs: 60_000,
      }),
    ).toBe(false);
    expect(
      shouldAbortAbandonedGenerate({
        clientLeft: true,
        disconnectedForMs: CLIENT_DISCONNECT_GRACE_MS,
        hasWaiter: true,
        elapsedMs: 90_000,
      }),
    ).toBe(false);
  });

  it("aborts after the disconnect grace when nobody is waiting", () => {
    expect(
      shouldAbortAbandonedGenerate({
        clientLeft: true,
        disconnectedForMs: CLIENT_DISCONNECT_GRACE_MS - 1,
        hasWaiter: false,
        elapsedMs: 10_000,
      }),
    ).toBe(false);
    expect(
      shouldAbortAbandonedGenerate({
        clientLeft: true,
        disconnectedForMs: CLIENT_DISCONNECT_GRACE_MS,
        hasWaiter: false,
        elapsedMs: 30_000,
      }),
    ).toBe(true);
  });

  it("aborts a disconnected turn once the late-persist ceiling is reached", () => {
    expect(
      shouldAbortAbandonedGenerate({
        clientLeft: true,
        disconnectedForMs: 1_000,
        hasWaiter: false,
        elapsedMs: LLM_LATE_PERSIST_BUDGET_MS,
      }),
    ).toBe(true);
  });

  it("does not abort a generate that is already producing tokens until the hard cap", () => {
    const cap = llmProducingGenerateHardCapMs();
    expect(cap).toBe(LLM_LOCAL_FIRST_TOKEN_MS + LLM_LOCAL_DECODE_SLACK_MS);
    expect(
      shouldAbortAbandonedGenerate({
        clientLeft: true,
        disconnectedForMs: CLIENT_DISCONNECT_GRACE_MS,
        hasWaiter: false,
        elapsedMs: LLM_LATE_PERSIST_BUDGET_MS,
        producingTokens: true,
      }),
    ).toBe(false);
    expect(
      shouldAbortAbandonedGenerate({
        clientLeft: true,
        disconnectedForMs: 1_000,
        hasWaiter: false,
        elapsedMs: cap,
        producingTokens: true,
      }),
    ).toBe(true);
  });
});

describe("repeatRetryBudgetMs", () => {
  const window = CHAT_STREAM_TIMEOUT_MS - CHAT_MESSAGES_CONTEXT_SLACK_MS;

  it("spends only what is left of the browser fetch window", () => {
    expect(repeatRetryBudgetMs(0)).toBe(window);
    expect(repeatRetryBudgetMs(30_000)).toBe(window - 30_000);
  });

  it("skips the regenerate when a slow first reply used the window", () => {
    // Local CPU first reply: 90s first token + decode.
    expect(
      repeatRetryBudgetMs(LLM_LOCAL_FIRST_TOKEN_MS + LLM_LOCAL_DECODE_SLACK_MS),
    ).toBe(0);
    expect(repeatRetryBudgetMs(window - REPEAT_RETRY_MIN_MS + 1)).toBe(0);
    expect(repeatRetryBudgetMs(window - REPEAT_RETRY_MIN_MS)).toBe(REPEAT_RETRY_MIN_MS);
  });

  it("never gives the regenerate more than the time before the browser abort", () => {
    for (const elapsed of [0, 5_000, 60_000, 100_000]) {
      const budget = repeatRetryBudgetMs(elapsed);
      expect(elapsed + budget).toBeLessThanOrEqual(CHAT_STREAM_TIMEOUT_MS);
    }
  });

  it("skips the regenerate when another turn is already queued", () => {
    expect(
      shouldRegenerateRepeatedReply({
        retryBudgetMs: REPEAT_RETRY_MIN_MS,
        aborted: false,
        timedOut: false,
        repeated: true,
        otherWorkQueued: true,
      }),
    ).toBe(false);
    expect(
      shouldRegenerateRepeatedReply({
        retryBudgetMs: REPEAT_RETRY_MIN_MS,
        aborted: false,
        timedOut: false,
        repeated: true,
        otherWorkQueued: false,
      }),
    ).toBe(true);
  });
});
