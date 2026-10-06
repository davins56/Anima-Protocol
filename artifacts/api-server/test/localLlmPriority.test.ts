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
import { localOnlyProviderChain } from "../src/lib/llmFailover";
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
  });

  it("defers state jobs and skips optional jobs during the quiet window, then runs them", async () => {
    let active = true;
    setLocalChatActivityProbeForTests(async () => active);
    expect(await admitBackgroundJob("proactive")).toBe("skip");
    expect(await admitBackgroundJob("journal")).toBe("skip");
    expect(await admitBackgroundJob("llm-warm")).toBe("skip");
    expect(await admitBackgroundJob("sidecar")).toBe("skip");
    expect(await admitBackgroundJob("scene-mind")).toBe("skip");
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
});
