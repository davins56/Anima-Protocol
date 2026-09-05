import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CHAT_STREAM_TIMEOUT_MS,
  LLM_OPEN_TIMEOUT_FREE_TIER_MS,
  LLM_OPEN_TIMEOUT_MS,
  LLM_STREAM_FIRST_CHUNK_MS,
  llmOpenTimeoutMs,
  openStreamAbort,
} from "../src/lib/chatTimeouts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");

describe("llmOpenTimeoutMs", () => {
  it("keeps the 35s budget for a single-model / paid open", () => {
    expect(LLM_OPEN_TIMEOUT_MS).toBe(35_000);
    expect(llmOpenTimeoutMs()).toBe(35_000);
    expect(llmOpenTimeoutMs({ freeTierCascade: false })).toBe(35_000);
  });

  it("gives free-tier multi-candidate failover an 80s open budget", () => {
    expect(LLM_OPEN_TIMEOUT_FREE_TIER_MS).toBe(80_000);
    expect(llmOpenTimeoutMs({ freeTierCascade: true })).toBe(80_000);
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
  it("wires the free-tier open budget into the chat route", () => {
    const chatRoute = readFileSync(
      join(repoRoot, "artifacts/api-server/src/routes/chat.ts"),
      "utf8",
    );
    expect(chatRoute).toContain("llmOpenTimeoutMs({ freeTierCascade: isOpenRouterAlreadyFreeTier() })");
    expect(chatRoute).toContain("openStreamAbort(");
    expect(chatRoute).not.toMatch(/const LLM_OPEN_TIMEOUT_MS = 35_000/);
  });

  it("keeps the browser fetch abort equal to the documented client budget", () => {
    const animaApi = readFileSync(
      join(repoRoot, "artifacts/anima-protocol/src/api/animaApi.js"),
      "utf8",
    );
    expect(animaApi).toMatch(/CHAT_STREAM_TIMEOUT_MS = 115_000/);
    expect(CHAT_STREAM_TIMEOUT_MS).toBe(115_000);
  });
});
