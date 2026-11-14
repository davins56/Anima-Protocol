import { describe, expect, it, vi } from "vitest";
import { buildWorld } from "../areas";
import { MOCK_ANIMAS } from "../mockAnimas";
import { chooseJourney, NO_HINTS } from "./choose";
import { createInterestCache, interestsToHints } from "./interests";
import type { JourneyEvent } from "./log";
import { applyResponse, BATCH_MAX, createBackendSink, DAILY_CAP, emptySyncState, enqueue, nextBatch, parseSyncState, QUEUE_PER_COMPANION, SYNC_QUEUE_KEY, type SyncResponse, type Transport } from "./sync";

const T0 = Date.UTC(2026, 10, 14, 2, 0, 0);
let seq = 0;
const ev = (companionId: string, o: Partial<JourneyEvent> = {}): JourneyEvent => ({
  id: `${companionId}:${++seq}`,
  companionId,
  kind: "journey",
  areaId: "hub",
  targetId: "hub:core",
  activity: "watch the data core",
  reason: "curious about the data core",
  motive: "curiosity",
  summary: "Ada went to the data core because they were curious",
  occurredAt: new Date(T0).toISOString(),
  ...o,
});
const memStore = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};

describe("queue & batching", () => {
  it("never sends user_id or mock ids, dedupes, and caps per companion", () => {
    const e = ev("c1");
    let s = enqueue(emptySyncState(T0), [e, e, ev("mock-echo"), ev("c2")]);
    expect(s.queue.map((r) => r.character_id)).toEqual(["c1", "c2"]);
    expect(s.queue[0]).not.toHaveProperty("user_id");
    expect(s.queue[0]).toMatchObject({ event_type: "cyberworld_journey", dedupe_key: `journey:${e.id}`, source: "cyberworld" });
    s = enqueue(s, Array.from({ length: 15 }, () => ev("c1")));
    expect(s.queue.filter((r) => r.character_id === "c1")).toHaveLength(QUEUE_PER_COMPANION);
  });

  it("batches one companion at a time, within the daily cap and BATCH_MAX", () => {
    const s = enqueue(emptySyncState(T0), [...Array.from({ length: 8 }, () => ev("c1")), ev("c2")]);
    const b = nextBatch(s, T0)!;
    expect(b.every((r) => r.character_id === "c1")).toBe(true);
    expect(b).toHaveLength(DAILY_CAP);
    expect(DAILY_CAP).toBeLessThanOrEqual(BATCH_MAX);
    expect(nextBatch({ ...s, sent: { c1: DAILY_CAP } }, T0)!.every((r) => r.character_id === "c2")).toBe(true);
    expect(nextBatch({ ...s, sent: { c1: DAILY_CAP }, blocked: ["c2"] }, T0)).toBeNull();
    // A new UTC day resets the cap.
    expect(nextBatch({ ...s, sent: { c1: DAILY_CAP, c2: DAILY_CAP } }, T0 + 24 * 3600_000)).not.toBeNull();
    expect(nextBatch({ ...s, backoffUntil: T0 + 1 }, T0)).toBeNull();
    expect(nextBatch({ ...s, authPaused: true }, T0)).toBeNull();
  });
});

describe("response handling", () => {
  const base = enqueue(emptySyncState(T0), [ev("c1"), ev("c1"), ev("c2")]);
  const batch = nextBatch(base, T0)!;
  const apply = (res: SyncResponse) => applyResponse(base, batch, res, T0);

  it("200: drops inserted, duplicates and rejected rows; counts toward the cap", () => {
    const o = apply({ status: 200, body: { inserted: 1, duplicates: 0, rejected: [{ index: 1, reason: "invalid_payload" }] } });
    expect(o.state.queue.map((r) => r.character_id)).toEqual(["c2"]);
    expect(o.state.sent.c1).toBe(1);
    expect(o.log).toMatch(/rejected/);
  });

  it("400: drops the batch and logs", () => {
    const o = apply({ status: 400, body: { code: "batch_too_large" } });
    expect(o.state.queue).toHaveLength(1);
    expect(o.log).toMatch(/batch_too_large/);
  });

  it("401: pauses and keeps the queue", () => {
    const o = apply({ status: 401, body: { error: "Unauthorized" } });
    expect(o.state.authPaused).toBe(true);
    expect(o.state.queue).toHaveLength(3);
  });

  it("404 companion_not_found: drops only that companion; bare 404 backs off", () => {
    expect(apply({ status: 404, body: { code: "companion_not_found" } }).state.queue.map((r) => r.character_id)).toEqual(["c2"]);
    const bare = apply({ status: 404, body: null }).state;
    expect(bare.queue).toHaveLength(3);
    expect(bare.backoffUntil).toBeGreaterThan(T0);
  });

  it("429 rate_limited: blocks that companion for the UTC day; others keep flowing", () => {
    const s = apply({ status: 429, body: { code: "rate_limited", retry_after: 3600, character_id: "c1", limit: 5 } }).state;
    expect(s.blocked).toEqual(["c1"]);
    expect(s.queue).toHaveLength(3);
    expect(nextBatch(s, T0)!.map((r) => r.character_id)).toEqual(["c2"]);
    expect(nextBatch(s, T0 + 24 * 3600_000)![0].character_id).toBe("c1");
    // Generic 429 (no companion): global backoff from Retry-After.
    expect(apply({ status: 429, body: null, retryAfterSec: 30 }).state.backoffUntil).toBe(T0 + 30_000);
  });

  it("network / 5xx: exponential backoff, queue kept", () => {
    const a = apply({ status: 0, error: "offline" }).state;
    const b = applyResponse(a, batch, { status: 503 }, T0).state;
    expect(a.queue).toHaveLength(3);
    expect(b.backoffUntil - T0).toBe(2 * (a.backoffUntil - T0));
  });
});

describe("backend sink (mocked fetch)", () => {
  it("only sends when signed in, persists the queue, and drains", async () => {
    const store = memStore();
    const transport = vi.fn<Transport>(async (rows) => ({ status: 200, body: { inserted: rows.length, duplicates: 0, rejected: [] } }));
    let token: string | null = null;
    const sink = createBackendSink({ transport, getToken: async () => token, store, now: () => T0 });
    sink.record([ev("c1"), ev("mock-x")]);
    await sink.flush();
    expect(transport).not.toHaveBeenCalled();
    expect(JSON.parse(store.m.get(SYNC_QUEUE_KEY)!).queue).toHaveLength(1);
    token = "t";
    await sink.flush();
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0][0][0]).not.toHaveProperty("user_id");
    expect(sink.state().queue).toHaveLength(0);
    expect(parseSyncState(store.m.get(SYNC_QUEUE_KEY)!, T0).sent).toEqual({ c1: 1 });
  });

  it("after a 401 stops until signed out and in again", async () => {
    const transport = vi.fn<Transport>(async () => ({ status: 401, body: {} }));
    let token: string | null = "t";
    const sink = createBackendSink({ transport, getToken: async () => token, store: memStore(), now: () => T0, log: () => {} });
    sink.record([ev("c1")]);
    await sink.flush();
    await sink.flush();
    expect(transport).toHaveBeenCalledTimes(1);
    token = null;
    await sink.flush();
    token = "t2";
    await sink.flush();
    expect(transport).toHaveBeenCalledTimes(2);
    expect(sink.state().queue).toHaveLength(1);
  });

  it("a thrown fetch is a network error (backoff, no throw)", async () => {
    const sink = createBackendSink({ transport: async () => Promise.reject(new Error("offline")), getToken: async () => "t", store: memStore(), now: () => T0 });
    sink.record([ev("c1")]);
    await expect(sink.flush()).resolves.toBeUndefined();
    expect(sink.state().failures).toBe(1);
  });
});

describe("interest hints", () => {
  it("maps API topics to normalised hints", () => {
    expect(interestsToHints({ character_id: "c1", topics: ["Coffee", "books", "mock-x", 3], source: "chat", memories: [] })).toEqual({ topics: ["coffee", "books", "book"], source: "chat" });
    expect(interestsToHints({ topics: ["art"], source: "mixed" }).source).toBe("memory");
    expect(interestsToHints(null)).toBe(NO_HINTS);
  });

  it("caches per companion, tolerates failures, skips mock ids", async () => {
    let t = T0;
    const fetcher = vi.fn(async (id: string) => {
      if (id === "bad") throw new Error("500");
      return { topics: ["coffee"], source: "memory" };
    });
    const c = createInterestCache({ fetcher, now: () => t });
    expect(c.get("c1")).toBe(NO_HINTS);
    expect(c.get("bad")).toBe(NO_HINTS);
    expect(c.get("mock-echo")).toBe(NO_HINTS);
    await new Promise((r) => setTimeout(r, 0));
    expect(c.get("c1").topics).toContain("coffee");
    expect(c.get("bad")).toBe(NO_HINTS);
    expect(fetcher).toHaveBeenCalledTimes(2);
    t += 31 * 60_000;
    c.get("c1");
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("hint topics steer chooseJourney toward matching tagged destinations", () => {
    const world = buildWorld(MOCK_ANIMAS);
    const who = { id: "c1", name: "Ada", homeZoneId: "home:none" };
    const m = { rest: 0.55, curiosity: 0.5, social: 0, creativity: 0 };
    const hints = interestsToHints({ topics: ["quiet"], source: "chat" });
    const c = chooseJourney(who, m, hints, world.areas, { currentAreaId: "hub" })!;
    expect(c.destination.tags.topics).toContain("quiet");
    expect(c.reason).toMatch(/you talked about quiet/);
  });
});
