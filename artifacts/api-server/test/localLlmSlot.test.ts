import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { LLM_LOCAL_FIRST_TOKEN_MS } from "../src/lib/chatTimeouts";
import {
  acquireLocalLlmBackground,
  createMemoryLocalLlmSlot,
  localLlmSlotEnabled,
  LocalLlmSlotClientLeftError,
  LocalLlmSlotWaitError,
  resetLocalLlmSlotForTests,
  waitForLocalChatSlot,
} from "../src/lib/localLlmSlot";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");

afterEach(() => {
  resetLocalLlmSlotForTests();
});

describe("local Ollama slot", () => {
  it("runs two chat turns one after the other", async () => {
    const slot = createMemoryLocalLlmSlot();
    let inFlight = 0;
    let maxInFlight = 0;
    const events: string[] = [];

    async function turn(id: string) {
      const grant = await waitForLocalChatSlot({
        turnId: id,
        coordinator: slot,
        onWaiting: () => {},
        pollMs: 5,
      });
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      events.push(`start:${id}`);
      await new Promise((resolve) => setTimeout(resolve, 30));
      events.push(`end:${id}`);
      inFlight -= 1;
      await grant.release();
    }

    await Promise.all([turn("a"), turn("b")]);
    expect(maxInFlight).toBe(1);
    const first = events[0] === "start:a" ? "a" : "b";
    const second = first === "a" ? "b" : "a";
    expect(events).toEqual([
      `start:${first}`,
      `end:${first}`,
      `start:${second}`,
      `end:${second}`,
    ]);
  });

  it("skips a background call while the slot is held or a chat turn is waiting", async () => {
    const slot = createMemoryLocalLlmSlot();
    expect((await slot.chatStep("chat-1")).granted).toBe(true);
    expect(await slot.tryBackground("journal")).toBe(false);

    expect((await slot.chatStep("chat-2")).granted).toBe(false);
    await slot.release("chat-1");
    expect(await slot.tryBackground("proactive")).toBe(false);

    const grant = await waitForLocalChatSlot({
      turnId: "chat-2",
      coordinator: slot,
      onWaiting: () => {},
      pollMs: 5,
    });
    await grant.release();
    expect(await slot.tryBackground("sidecar")).toBe(true);
    await slot.release("sidecar");
  });

  it("expires the lease after the TTL so a dead holder cannot wedge chat", async () => {
    let now = 0;
    const ttlMs = 1_000;
    const slot = createMemoryLocalLlmSlot({ now: () => now, ttlMs });
    expect((await slot.chatStep("crashed")).granted).toBe(true);
    now = ttlMs - 1;
    expect(await slot.tryBackground("journal")).toBe(false);
    expect((await slot.chatStep("next")).granted).toBe(false);
    now = ttlMs;
    expect((await slot.chatStep("next")).granted).toBe(true);
    expect(await slot.tryBackground("journal")).toBe(false);
  });

  it("starts the first-token timeout when the slot is acquired", async () => {
    let now = 1_000;
    const slot = createMemoryLocalLlmSlot({ now: () => now });
    expect((await slot.chatStep("holder")).granted).toBe(true);
    const pending = waitForLocalChatSlot({
      turnId: "waiter",
      coordinator: slot,
      onWaiting: () => {},
      now: () => now,
      sleep: async (ms) => {
        now += ms;
        if (now >= 41_000) await slot.release("holder");
      },
      pollMs: 10_000,
      waitMs: 180_000,
    });
    const grant = await pending;
    expect(grant.waitedMs).toBeGreaterThanOrEqual(40_000);
    expect(grant.acquiredAt).toBe(1_000 + grant.waitedMs);
    expect(grant.firstTokenDeadline - grant.acquiredAt).toBe(LLM_LOCAL_FIRST_TOKEN_MS);
    expect(grant.waitedMs).toBeLessThan(LLM_LOCAL_FIRST_TOKEN_MS);
    await grant.release();
  });

  it("takes a free slot after the client leaves, and drops a queued place", async () => {
    const slot = createMemoryLocalLlmSlot();
    const grant = await waitForLocalChatSlot({
      turnId: "late",
      coordinator: slot,
      shouldStop: () => true,
      pollMs: 5,
    });
    expect(grant.waitedMs).toBeGreaterThanOrEqual(0);
    await grant.release();

    expect((await slot.chatStep("holder")).granted).toBe(true);
    await expect(
      waitForLocalChatSlot({
        turnId: "queued",
        coordinator: slot,
        shouldStop: () => true,
        pollMs: 5,
      }),
    ).rejects.toBeInstanceOf(LocalLlmSlotClientLeftError);
    expect(await slot.tryBackground("journal")).toBe(false);
    await slot.release("holder");
    expect(await slot.tryBackground("journal")).toBe(true);
    await slot.release("journal");
  });

  it("fails clearly when the queue wait is exceeded", async () => {
    let now = 0;
    const slot = createMemoryLocalLlmSlot({ now: () => now, ttlMs: 1_000_000 });
    expect((await slot.chatStep("holder")).granted).toBe(true);
    await expect(
      waitForLocalChatSlot({
        turnId: "waiter",
        coordinator: slot,
        onWaiting: () => {},
        now: () => now,
        sleep: async (ms) => {
          now += ms;
        },
        pollMs: 60_000,
        waitMs: 180_000,
      }),
    ).rejects.toBeInstanceOf(LocalLlmSlotWaitError);
    expect(await slot.tryBackground("after")).toBe(false);
    await slot.release("holder");
    expect(await slot.tryBackground("after")).toBe(true);
  });

  it("stays off for hosted chains and when the flag is disabled", () => {
    expect(localLlmSlotEnabled({}, false)).toBe(false);
    expect(localLlmSlotEnabled({ ANIMA_LOCAL_LLM_SLOT: "true" }, false)).toBe(false);
    expect(localLlmSlotEnabled({}, true)).toBe(true);
    expect(localLlmSlotEnabled({ ANIMA_LOCAL_LLM_SLOT: "false" }, true)).toBe(false);
    expect(localLlmSlotEnabled({ ANIMA_LOCAL_LLM_SLOT: "0" }, true)).toBe(false);
  });

  it("wires the chat turn to wait before the first-token abort", () => {
    const chatRoute = readFileSync(
      join(repoRoot, "artifacts/api-server/src/routes/chat.ts"),
      "utf8",
    );
    const waitAt = chatRoute.indexOf("waitForLocalChatSlot(");
    const openAt = chatRoute.indexOf("openStreamAbort(generationBudgetMs)");
    expect(waitAt).toBeGreaterThan(0);
    expect(openAt).toBeGreaterThan(waitAt);
    expect(chatRoute).toContain('status: "waiting"');
    expect(chatRoute).toContain("producingTokens: () => producingTokens");
    const slotDo = readFileSync(
      join(repoRoot, "artifacts/api-server/src/lib/localLlmSlotDo.ts"),
      "utf8",
    );
    expect(slotDo).toContain("applyChatStep");
    expect(slotDo).toContain("applyTryBackground");
    expect(slotDo).toContain("applyHeartbeat");
    expect(slotDo).toContain("applyRelease");
    const wrangler = readFileSync(join(repoRoot, "wrangler.jsonc"), "utf8");
    expect(wrangler).toContain('"name": "LOCAL_LLM_SLOT"');
    expect(wrangler).toContain('"class_name": "LocalLlmSlot"');
    expect(wrangler).toContain('"tag": "v1-local-llm-slot"');
    expect(wrangler).toContain('"new_sqlite_classes": ["LocalLlmSlot"]');
    expect(wrangler).not.toMatch(/Durable Objects need Workers Paid/);
  });

  it("gives background callers a noop lease when the feature is off", async () => {
    const previous = process.env.ANIMA_LOCAL_LLM_SLOT;
    process.env.ANIMA_LOCAL_LLM_SLOT = "false";
    try {
      const grant = await acquireLocalLlmBackground("journal");
      expect(grant).not.toBeNull();
      await grant?.release();
    } finally {
      if (previous === undefined) delete process.env.ANIMA_LOCAL_LLM_SLOT;
      else process.env.ANIMA_LOCAL_LLM_SLOT = previous;
    }
  });
});
