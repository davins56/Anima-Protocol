import { afterEach, describe, expect, it } from "vitest";
import {
  evolveCompanionAffectFromUser,
  initCompanionAffect,
  serializeCompanionAffect,
} from "../src/lib/companionAffect";
import {
  ACTIVE_CHAT_QUIET_WINDOW_MS,
  capBackgroundNumPredict,
  LLM_BACKGROUND_NUM_PREDICT,
  LLM_BACKGROUND_WALL_MS,
  LLM_BACKGROUND_YIELD_MS,
  LLM_EVOLUTION_NUM_PREDICT,
  LLM_EVOLUTION_WALL_MS,
  LLM_MEMORY_EXTRACT_NUM_PREDICT,
  LLM_MEMORY_EXTRACT_WALL_MS,
} from "../src/lib/chatTimeouts";
import {
  clearDeferredLlmRunnersForTests,
  deferLocalLlmJob,
  drainDeferredLocalLlmJobs,
  registerDeferredLlmRunner,
  setDeferredJobStoreForTests,
  type DeferredJobStore,
  type DeferredLocalLlmJob,
} from "../src/lib/deferredLocalLlm";
import {
  createChatCompletionWithFailover,
  LocalModelHeldForChatError,
  localOnlyProviderChain,
} from "../src/lib/llmFailover";
import {
  acquireLocalLlmBackground,
  createMemoryLocalLlmSlot,
  resetLocalLlmSlotForTests,
  setLocalLlmSlotCoordinatorForTests,
} from "../src/lib/localLlmSlot";
import {
  admitBackgroundJob,
  backgroundProviderChain,
  LOCAL_LLM_JOBS,
  localLlmJobLimits,
  setLocalChatActivityProbeForTests,
} from "../src/lib/localLlmPriority";
import { emotionalStateWithTurnMood } from "../src/lib/turnMoodWrite";

function memoryStore(): DeferredJobStore & { jobs: Map<string, DeferredLocalLlmJob> } {
  const jobs = new Map<string, DeferredLocalLlmJob>();
  return {
    jobs,
    async upsert(job) {
      jobs.set(job.id, job);
    },
    async list() {
      return [...jobs.values()];
    },
    async remove(id) {
      jobs.delete(id);
    },
    async markAttempt() {},
    async claim(id) {
      return jobs.has(id);
    },
  };
}

afterEach(() => {
  setLocalChatActivityProbeForTests(null);
  setDeferredJobStoreForTests(null);
  clearDeferredLlmRunnersForTests();
  setLocalLlmSlotCoordinatorForTests(undefined);
  resetLocalLlmSlotForTests();
});

describe("local model priority", () => {
  it("names the quiet window and the background caps", () => {
    expect(ACTIVE_CHAT_QUIET_WINDOW_MS).toBe(3 * 60 * 1000);
    expect(LLM_BACKGROUND_YIELD_MS).toBeLessThan(30_000);
    expect(LLM_BACKGROUND_WALL_MS).toBeLessThan(30_000);
    expect(LLM_BACKGROUND_WALL_MS).toBeGreaterThan(LLM_BACKGROUND_YIELD_MS);
    expect(capBackgroundNumPredict(2_048)).toBe(LLM_BACKGROUND_NUM_PREDICT);
    expect(capBackgroundNumPredict(16)).toBe(16);
    expect(localLlmJobLimits("evolution")).toMatchObject({
      tokenCap: LLM_EVOLUTION_NUM_PREDICT,
      wallMs: LLM_EVOLUTION_WALL_MS,
    });
    expect(localLlmJobLimits("memory-extract")).toMatchObject({
      tokenCap: LLM_MEMORY_EXTRACT_NUM_PREDICT,
      wallMs: LLM_MEMORY_EXTRACT_WALL_MS,
    });
    expect(LLM_EVOLUTION_NUM_PREDICT).toBe(512);
    expect(LLM_MEMORY_EXTRACT_NUM_PREDICT).toBe(256);
    expect(LLM_EVOLUTION_WALL_MS).toBeGreaterThan(LLM_BACKGROUND_YIELD_MS);
    expect(LLM_MEMORY_EXTRACT_WALL_MS).toBeGreaterThan(LLM_BACKGROUND_YIELD_MS);
    expect((LLM_EVOLUTION_NUM_PREDICT / 9) * 1000).toBeLessThan(LLM_EVOLUTION_WALL_MS);
    expect(localLlmJobLimits("codespace").tokenCap).toBeNull();
    expect(localLlmJobLimits("context-analysis").tokenCap).toBeNull();
    expect(localLlmJobLimits("model-tutor").wallMs).toBeNull();
    expect(localLlmJobLimits("ai-chat").wallMs).toBeNull();
    expect(localLlmJobLimits("journal").tokenCap).toBe(LLM_BACKGROUND_NUM_PREDICT);
  });

  it("defers state jobs and skips optional jobs during the quiet window, then runs them", async () => {
    let active = true;
    setLocalChatActivityProbeForTests(async () => active);
    expect(await admitBackgroundJob("proactive")).toBe("skip");
    expect(await admitBackgroundJob("journal")).toBe("skip");
    expect(await admitBackgroundJob("llm-warm")).toBe("skip");
    expect(await admitBackgroundJob("sidecar")).toBe("skip");
    expect(await admitBackgroundJob("scene-mind")).toBe("skip");
    expect(await admitBackgroundJob("model-tutor")).toBe("skip");
    expect(await admitBackgroundJob("own-model-teacher")).toBe("skip");
    expect(await admitBackgroundJob("codespace")).toBe("skip");
    expect(await admitBackgroundJob("openai-user")).toBe("skip");
    expect(await admitBackgroundJob("ai-chat")).toBe("skip");
    expect(await admitBackgroundJob("context-analysis")).toBe("skip");
    expect(await admitBackgroundJob("evolution")).toBe("defer");
    expect(await admitBackgroundJob("memory-extract")).toBe("defer");
    expect(await admitBackgroundJob("mood-affect")).toBe("run");
    expect(await admitBackgroundJob("relationship")).toBe("run");
    expect(await admitBackgroundJob("turn-memory")).toBe("run");
    expect(await admitBackgroundJob("chat-reply")).toBe("run");

    const store = memoryStore();
    setDeferredJobStoreForTests(store);
    const slot = createMemoryLocalLlmSlot();
    setLocalLlmSlotCoordinatorForTests(slot);
    const previous = {
      slotFlag: process.env.ANIMA_LOCAL_LLM_SLOT,
      url: process.env.ANIMA_LOCAL_LLM_BASE_URL,
      fallback: process.env.ANIMA_LOCAL_LLM_FALLBACK,
    };
    delete process.env.ANIMA_LOCAL_LLM_SLOT;
    delete process.env.ANIMA_LOCAL_LLM_FALLBACK;
    process.env.ANIMA_LOCAL_LLM_BASE_URL = "https://llm.anima-protocol.com/v1";

    const ran: string[] = [];
    registerDeferredLlmRunner("evolution", async (job) => {
      ran.push(job.id);
    });

    try {
      const during = await acquireLocalLlmBackground("evolution:user:anima:50", {
        job: "evolution",
        onDefer: () =>
          deferLocalLlmJob({
            id: "evolution:user:anima:50",
            userId: "user",
            kind: "evolution",
            payload: { targetMilestone: 50 },
          }),
      });
      expect(during).toBeNull();
      expect(store.jobs.has("evolution:user:anima:50")).toBe(true);
      const drainedEarly = await drainDeferredLocalLlmJobs();
      expect(drainedEarly.ran).toBe(0);
      expect(ran).toEqual([]);

      active = false;
      const drained = await drainDeferredLocalLlmJobs();
      expect(drained.ran).toBe(1);
      expect(ran).toEqual(["evolution:user:anima:50"]);
      expect(store.jobs.size).toBe(0);
      expect(await admitBackgroundJob("proactive")).toBe("run");
      expect(await admitBackgroundJob("evolution")).toBe("run");
      expect(await admitBackgroundJob("model-tutor")).toBe("run");
    } finally {
      const restore = (name: string, value: string | undefined) => {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      };
      restore("ANIMA_LOCAL_LLM_SLOT", previous.slotFlag);
      restore("ANIMA_LOCAL_LLM_BASE_URL", previous.url);
      restore("ANIMA_LOCAL_LLM_FALLBACK", previous.fallback);
    }
  });

  it("keeps chat mood without a model call", () => {
    const affect = evolveCompanionAffectFromUser(
      initCompanionAffect(null),
      "I miss you. I love being with you.",
    );
    const mood = emotionalStateWithTurnMood(
      {},
      "turn_mood_1",
      serializeCompanionAffect(affect),
    );
    expect(mood.wrote).toBe(true);
    expect(mood.state.moodTurnId).toBe("turn_mood_1");
    expect(mood.state.selfState).toBeTruthy();
    expect(LOCAL_LLM_JOBS["mood-affect"].priority).toBe("inline");
    expect(LOCAL_LLM_JOBS.relationship.priority).toBe("inline");
    expect(LOCAL_LLM_JOBS["turn-memory"].priority).toBe("inline");
    expect(LOCAL_LLM_JOBS.evolution.whenActive).toBe("defer");
    expect(LOCAL_LLM_JOBS["memory-extract"].whenActive).toBe("defer");
    expect(LOCAL_LLM_JOBS.proactive.whenActive).toBe("skip");
    expect(LOCAL_LLM_JOBS.journal.whenActive).toBe("skip");
  });

  it("does not select a cloud provider for background work", () => {
    const previous = {
      url: process.env.ANIMA_LOCAL_LLM_BASE_URL,
      fallback: process.env.ANIMA_LOCAL_LLM_FALLBACK,
      openRouter: process.env.ANIMA_OPENROUTER_FALLBACK,
      key: process.env.OPENROUTER_API_KEY,
    };
    process.env.ANIMA_LOCAL_LLM_BASE_URL = "https://llm.anima-protocol.com/v1";
    process.env.ANIMA_LOCAL_LLM_FALLBACK = "true";
    process.env.ANIMA_OPENROUTER_FALLBACK = "true";
    process.env.OPENROUTER_API_KEY = "sk-test-not-used";
    try {
      expect(backgroundProviderChain()).toEqual(["local"]);
      expect(localOnlyProviderChain()).toEqual(["local"]);
      expect(backgroundProviderChain()).not.toContain("openrouter");
      expect(backgroundProviderChain()).not.toContain("workersai");
      expect(localOnlyProviderChain()).not.toContain("openrouter");
    } finally {
      const restore = (name: string, value: string | undefined) => {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      };
      restore("ANIMA_LOCAL_LLM_BASE_URL", previous.url);
      restore("ANIMA_LOCAL_LLM_FALLBACK", previous.fallback);
      restore("ANIMA_OPENROUTER_FALLBACK", previous.openRouter);
      restore("OPENROUTER_API_KEY", previous.key);
    }
  });

  it("does not open an Ollama request while the chat ledger is active", async () => {
    setLocalChatActivityProbeForTests(async () => true);
    const previous = process.env.ANIMA_LOCAL_LLM_BASE_URL;
    const previousNative = process.env.ANIMA_OLLAMA_NATIVE_CHAT;
    process.env.ANIMA_LOCAL_LLM_BASE_URL = "https://llm.anima-protocol.com/v1";
    process.env.ANIMA_OLLAMA_NATIVE_CHAT = "1";
    const previousFetch = globalThis.fetch;
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      throw new Error("Ollama was called");
    }) as typeof fetch;
    try {
      await expect(
        createChatCompletionWithFailover({
          tier: "standard",
          maxTokens: 32,
          messages: [{ role: "user", content: "background" }],
          localOnly: true,
        }),
      ).rejects.toBeInstanceOf(LocalModelHeldForChatError);
      expect(called).toBe(false);
    } finally {
      globalThis.fetch = previousFetch;
      if (previous === undefined) delete process.env.ANIMA_LOCAL_LLM_BASE_URL;
      else process.env.ANIMA_LOCAL_LLM_BASE_URL = previous;
      if (previousNative === undefined) delete process.env.ANIMA_OLLAMA_NATIVE_CHAT;
      else process.env.ANIMA_OLLAMA_NATIVE_CHAT = previousNative;
    }
  });

  it("passes the abort signal through to the Ollama fetch and closes it when chat yields", async () => {
    setLocalChatActivityProbeForTests(async () => false);
    const previous = {
      url: process.env.ANIMA_LOCAL_LLM_BASE_URL,
      native: process.env.ANIMA_OLLAMA_NATIVE_CHAT,
      slot: process.env.ANIMA_LOCAL_LLM_SLOT,
      fallback: process.env.ANIMA_LOCAL_LLM_FALLBACK,
    };
    delete process.env.ANIMA_LOCAL_LLM_SLOT;
    delete process.env.ANIMA_LOCAL_LLM_FALLBACK;
    process.env.ANIMA_LOCAL_LLM_BASE_URL = "https://llm.anima-protocol.com/v1";
    process.env.ANIMA_OLLAMA_NATIVE_CHAT = "1";
    let polls = 0;
    setLocalLlmSlotCoordinatorForTests({
      chatStep: async () => ({ granted: true, position: 0 }),
      tryBackground: async () => true,
      enqueueBackground: async () => 1,
      pollBackground: async () => {
        polls += 1;
        return { held: true, yield: true };
      },
      heartbeat: async () => true,
      release: async () => {},
    });
    const previousFetch = globalThis.fetch;
    let seenUrl = "";
    let seen: AbortSignal | undefined;
    globalThis.fetch = ((_url: unknown, init?: { signal?: AbortSignal | null }) => {
      seenUrl = String(_url);
      seen = init?.signal ?? undefined;
      return new Promise((_resolve, reject) => {
        const fail = () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        if (!seen) {
          reject(new Error("Ollama fetch was missing an abort signal"));
          return;
        }
        if (seen.aborted) {
          fail();
          return;
        }
        seen.addEventListener("abort", fail, { once: true });
      });
    }) as typeof fetch;
    try {
      const grant = await acquireLocalLlmBackground("journal-abort", { job: "journal" });
      expect(grant).not.toBeNull();
      await expect(
        createChatCompletionWithFailover({
          tier: "standard",
          maxTokens: 32,
          messages: [{ role: "user", content: "background" }],
          signal: grant!.signal,
          localOnly: true,
        }),
      ).rejects.toThrow(/abort|took too long/i);
      expect(seenUrl).toContain("/api/chat");
      expect(seen?.aborted).toBe(true);
      expect(polls).toBeGreaterThan(0);
      await grant!.release();
    } finally {
      globalThis.fetch = previousFetch;
      const restore = (name: string, value: string | undefined) => {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      };
      restore("ANIMA_LOCAL_LLM_BASE_URL", previous.url);
      restore("ANIMA_OLLAMA_NATIVE_CHAT", previous.native);
      restore("ANIMA_LOCAL_LLM_SLOT", previous.slot);
      restore("ANIMA_LOCAL_LLM_FALLBACK", previous.fallback);
    }
  }, 4_000);

  it("gives deferred evolution 512 tokens and re-queues a truncated JSON reply", async () => {
    setLocalChatActivityProbeForTests(async () => false);
    const store = memoryStore();
    setDeferredJobStoreForTests(store);
    const previous = {
      url: process.env.ANIMA_LOCAL_LLM_BASE_URL,
      native: process.env.ANIMA_OLLAMA_NATIVE_CHAT,
      slot: process.env.ANIMA_LOCAL_LLM_SLOT,
    };
    delete process.env.ANIMA_LOCAL_LLM_SLOT;
    process.env.ANIMA_LOCAL_LLM_BASE_URL = "https://llm.anima-protocol.com/v1";
    process.env.ANIMA_OLLAMA_NATIVE_CHAT = "1";
    const previousFetch = globalThis.fetch;
    let numPredict = 0;
    globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
      const body = JSON.parse(String(init?.body || "{}")) as {
        options?: { num_predict?: number };
      };
      numPredict = Number(body.options?.num_predict || 0);
      return new Response(
        JSON.stringify({ model: "anima-chat", message: { content: '{"milestone":' } }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;
    try {
      await deferLocalLlmJob({
        id: "evolution:user:anima:50",
        userId: "user",
        kind: "evolution",
        payload: {
          animaId: "anima",
          userId: "user",
          conversationCount: 50,
          historySummary: "a long friendship",
          targetMilestone: 50,
        },
      });
      const drained = await drainDeferredLocalLlmJobs();
      expect(drained.ran).toBe(0);
      expect(store.jobs.has("evolution:user:anima:50")).toBe(true);
      expect(numPredict).toBe(LLM_EVOLUTION_NUM_PREDICT);
    } finally {
      globalThis.fetch = previousFetch;
      const restore = (name: string, value: string | undefined) => {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      };
      restore("ANIMA_LOCAL_LLM_BASE_URL", previous.url);
      restore("ANIMA_OLLAMA_NATIVE_CHAT", previous.native);
      restore("ANIMA_LOCAL_LLM_SLOT", previous.slot);
    }
  });

  it("re-queues deferred evolution when chat aborts the generate", async () => {
    setLocalChatActivityProbeForTests(async () => false);
    const store = memoryStore();
    setDeferredJobStoreForTests(store);
    const previous = {
      url: process.env.ANIMA_LOCAL_LLM_BASE_URL,
      native: process.env.ANIMA_OLLAMA_NATIVE_CHAT,
      slot: process.env.ANIMA_LOCAL_LLM_SLOT,
    };
    delete process.env.ANIMA_LOCAL_LLM_SLOT;
    process.env.ANIMA_LOCAL_LLM_BASE_URL = "https://llm.anima-protocol.com/v1";
    process.env.ANIMA_OLLAMA_NATIVE_CHAT = "1";
    setLocalLlmSlotCoordinatorForTests({
      chatStep: async () => ({ granted: true, position: 0 }),
      tryBackground: async () => true,
      enqueueBackground: async () => 1,
      pollBackground: async () => ({ held: true, yield: true }),
      heartbeat: async () => true,
      release: async () => {},
    });
    const previousFetch = globalThis.fetch;
    globalThis.fetch = ((_url: unknown, init?: { signal?: AbortSignal | null }) => {
      return new Promise((_resolve, reject) => {
        const signal = init?.signal;
        const fail = () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        if (!signal) {
          reject(new Error("missing abort signal"));
          return;
        }
        if (signal.aborted) {
          fail();
          return;
        }
        signal.addEventListener("abort", fail, { once: true });
      });
    }) as typeof fetch;
    try {
      await deferLocalLlmJob({
        id: "evolution:user:anima:100",
        userId: "user",
        kind: "evolution",
        payload: {
          animaId: "anima",
          userId: "user",
          conversationCount: 100,
          historySummary: "still talking",
          targetMilestone: 100,
        },
      });
      const drained = await drainDeferredLocalLlmJobs();
      expect(drained.ran).toBe(0);
      expect(store.jobs.has("evolution:user:anima:100")).toBe(true);
    } finally {
      globalThis.fetch = previousFetch;
      const restore = (name: string, value: string | undefined) => {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      };
      restore("ANIMA_LOCAL_LLM_BASE_URL", previous.url);
      restore("ANIMA_OLLAMA_NATIVE_CHAT", previous.native);
      restore("ANIMA_LOCAL_LLM_SLOT", previous.slot);
    }
  }, 4_000);
});
