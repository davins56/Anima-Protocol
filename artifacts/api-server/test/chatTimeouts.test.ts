import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CHAT_STREAM_TIMEOUT_MS,
  LLM_LOCAL_FAILOVER_ATTEMPT_MS,
  LLM_OPEN_TIMEOUT_AI_CHAT_MS,
  LLM_OPEN_TIMEOUT_FREE_TIER_MS,
  LLM_OPEN_TIMEOUT_LOCAL_ONLY_MS,
  LLM_OPEN_TIMEOUT_MS,
  LLM_STREAM_FIRST_CHUNK_MS,
  llmAiChatOpenTimeoutMs,
  llmChatMessagesOpenTimeoutMs,
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

  it("keeps /api/chat/messages on the 45s local-only SSE open budget, not the 18s wall or 80s cascade", () => {
    expect(LLM_OPEN_TIMEOUT_LOCAL_ONLY_MS).toBe(45_000);
    expect(llmChatMessagesOpenTimeoutMs()).toBe(LLM_OPEN_TIMEOUT_LOCAL_ONLY_MS);
    expect(llmChatMessagesOpenTimeoutMs()).toBe(45_000);
    expect(llmChatMessagesOpenTimeoutMs()).toBeGreaterThan(LLM_OPEN_TIMEOUT_MS);
    expect(llmChatMessagesOpenTimeoutMs()).toBeGreaterThan(LLM_OPEN_TIMEOUT_AI_CHAT_MS);
    expect(llmChatMessagesOpenTimeoutMs()).toBeLessThan(LLM_OPEN_TIMEOUT_FREE_TIER_MS);
    expect(LLM_LOCAL_FAILOVER_ATTEMPT_MS).toBeLessThan(llmChatMessagesOpenTimeoutMs());
    expect(
      llmChatMessagesOpenTimeoutMs() + LLM_STREAM_FIRST_CHUNK_MS,
    ).toBeLessThan(CHAT_STREAM_TIMEOUT_MS);
  });

  it("does not let the 80s free-tier budget stretch /api/chat/messages", () => {
    const previous = process.env.ANIMA_LLM_OPEN_TIMEOUT_MS;
    try {
      process.env.ANIMA_LLM_OPEN_TIMEOUT_MS = String(LLM_OPEN_TIMEOUT_FREE_TIER_MS);
      expect(llmChatMessagesOpenTimeoutMs()).toBe(LLM_OPEN_TIMEOUT_LOCAL_ONLY_MS);
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
      LLM_OPEN_TIMEOUT_FREE_TIER_MS + LLM_STREAM_FIRST_CHUNK_MS,
    );
    expect(CHAT_STREAM_TIMEOUT_MS).toBeGreaterThan(LLM_OPEN_TIMEOUT_FREE_TIER_MS);
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

  it("aborts the /api/chat/messages open budget at 45s for cold local-only loads", () => {
    vi.useFakeTimers();
    const { signal, cancel } = openStreamAbort(llmChatMessagesOpenTimeoutMs());
    vi.advanceTimersByTime(44_999);
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
  it("wires the 45s local-only open budget into /api/chat/messages, not the 80s cascade", () => {
    const chatRoute = readFileSync(
      join(repoRoot, "artifacts/api-server/src/routes/chat.ts"),
      "utf8",
    );
    expect(chatRoute).toContain("llmChatMessagesOpenTimeoutMs()");
    expect(chatRoute).toContain("chatReplyMaxTokens(");
    expect(chatRoute).toContain("scheduleLeftoverTurnRepair(");
    expect(chatRoute).toContain("attachStoredEmbeddings(userId, adapted).catch(");
    expect(chatRoute).toContain("openStreamAbort(");
    expect(chatRoute).not.toContain(
      "llmOpenTimeoutMs({ freeTierCascade: usesFreeTierOpenBudget() })",
    );
    expect(chatRoute).not.toContain("usesFreeTierOpenBudget()");
    expect(chatRoute).not.toMatch(/const LLM_OPEN_TIMEOUT_MS = 35_000/);
    expect(chatRoute).not.toMatch(/maxTokens: routed\.maxTokens/);
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
    expect(animaApi).toMatch(/CHAT_STREAM_TIMEOUT_MS = 130_000/);
    expect(CHAT_STREAM_TIMEOUT_MS).toBe(130_000);
  });
});
