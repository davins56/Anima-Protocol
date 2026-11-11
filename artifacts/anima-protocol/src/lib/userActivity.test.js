import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WAITING_THRESHOLD_MS, resolveWaiting } from "./homeWake";
import {
  ACTIVITY_GRACE_MS,
  USER_ACTIVITY_KEY_PREFIX,
  _resetActivityBindingsForTests,
  absenceDurationMs,
  activityStorageKey,
  bindActivityListeners,
  captureVisibleVisit,
  markHidden,
  parseUtcMs,
  readActivityRecord,
  recordActivity,
  resolveAbsenceRange,
  resolveLastActivityMs,
  subscribeActivity,
  writeActivityRecord,
} from "./userActivity";

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (key) => (Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null),
    setItem: (key, value) => {
      data[key] = String(value);
    },
    removeItem: (key) => {
      delete data[key];
    },
    get data() {
      return data;
    },
  };
}

describe("parseUtcMs", () => {
  it("treats zone-less ISO timestamps as UTC, not local", () => {
    const ms = parseUtcMs("2026-11-10T12:00:00");
    expect(ms).toBe(Date.parse("2026-11-10T12:00:00Z"));
  });

  it("keeps an explicit Z or offset", () => {
    expect(parseUtcMs("2026-11-10T12:00:00Z")).toBe(Date.parse("2026-11-10T12:00:00.000Z"));
    expect(parseUtcMs("2026-11-10T07:00:00-05:00")).toBe(Date.parse("2026-11-10T12:00:00Z"));
  });

  it("accepts numbers, Dates, and rejects junk", () => {
    expect(parseUtcMs(1_700_000_000_000)).toBe(1_700_000_000_000);
    expect(parseUtcMs(new Date("2026-11-10T12:00:00Z"))).toBe(Date.parse("2026-11-10T12:00:00Z"));
    expect(parseUtcMs("nope")).toBeNull();
    expect(parseUtcMs(null)).toBeNull();
    expect(parseUtcMs("")).toBeNull();
  });
});

describe("resolveLastActivityMs and clock skew", () => {
  const now = Date.parse("2026-11-10T18:00:00Z");

  it("picks the latest of stored activity, last user message, and last_visit", () => {
    const stored = now - 5 * 60 * 60 * 1000;
    const message = now - 2 * 60 * 60 * 1000;
    const visit = now - 8 * 60 * 60 * 1000;
    expect(
      resolveLastActivityMs({
        storedActivityMs: stored,
        lastUserMessageAt: new Date(message).toISOString(),
        serverLastVisitAt: new Date(visit).toISOString(),
        now,
      }),
    ).toBe(message);
  });

  it("clamps a future stamp so duration is never negative", () => {
    const future = now + 3 * 60 * 60 * 1000;
    const clamped = resolveLastActivityMs({ storedActivityMs: future, now });
    expect(clamped).toBe(now);
    expect(absenceDurationMs(future, now)).toBe(0);
    expect(resolveWaiting(future, now)).toBeNull();
  });
});

describe("activity persistence and return reset", () => {
  const userId = "user_abc";
  const now = Date.parse("2026-11-10T18:00:00Z");
  /** @type {ReturnType<typeof memoryStorage>} */
  let storage;

  beforeEach(() => {
    storage = memoryStorage();
    _resetActivityBindingsForTests();
  });

  afterEach(() => {
    _resetActivityBindingsForTests();
  });

  it("persists last activity so a reload can read it back", () => {
    const leftAt = now - 3 * WAITING_THRESHOLD_MS;
    recordActivity(userId, leftAt, { storage, broadcast: false });
    const fresh = memoryStorage({ ...storage.data });
    expect(readActivityRecord(userId, fresh).lastActivityMs).toBe(leftAt);
    expect(activityStorageKey(userId)).toBe(`${USER_ACTIVITY_KEY_PREFIX}${userId}`);
  });

  it("snapshots the absence on return, then resets last activity to now", () => {
    const leftAt = now - 3 * WAITING_THRESHOLD_MS;
    recordActivity(userId, leftAt, { storage, broadcast: false });

    const afterReturn = captureVisibleVisit({
      userId,
      now,
      thresholdMs: WAITING_THRESHOLD_MS,
      storage,
    });

    expect(afterReturn.visitAbsence).toEqual({ startMs: leftAt, returnedAtMs: now });
    expect(afterReturn.lastActivityMs).toBe(now);

    const waiting = resolveWaiting(afterReturn.visitAbsence.startMs, afterReturn.visitAbsence.returnedAtMs);
    expect(waiting?.hours).toBe(3);
    expect(waiting?.text).toBe("I waited 3 hours.");

    // A later read (the next absence) starts from the return, not the old leave.
    const later = now + 10 * 60 * 1000;
    const next = captureVisibleVisit({
      userId,
      now: later,
      thresholdMs: WAITING_THRESHOLD_MS,
      storage,
    });
    expect(next.visitAbsence).toBeNull();
    expect(next.lastActivityMs).toBe(later);
    expect(resolveWaiting(next.lastActivityMs, later)).toBeNull();
  });

  it("keeps the visit tile across a reload that hides and shows within the grace window", () => {
    const leftAt = now - 4 * WAITING_THRESHOLD_MS;
    recordActivity(userId, leftAt, { storage, broadcast: false });
    captureVisibleVisit({ userId, now, thresholdMs: WAITING_THRESHOLD_MS, storage });

    const reloadHide = now + 200;
    markHidden(userId, reloadHide, { storage });
    const reloadShow = reloadHide + 50;
    expect(reloadShow - reloadHide).toBeLessThan(ACTIVITY_GRACE_MS);

    const reloaded = captureVisibleVisit({
      userId,
      now: reloadShow,
      thresholdMs: WAITING_THRESHOLD_MS,
      storage,
    });
    expect(reloaded.visitAbsence?.startMs).toBe(leftAt);
    expect(reloaded.visitAbsence?.returnedAtMs).toBe(now);
  });

  it("does not treat a short absence as waiting, even if last_visit is stale", () => {
    const recent = now - 10 * 60 * 1000;
    const staleVisit = now - 10 * WAITING_THRESHOLD_MS;
    recordActivity(userId, recent, { storage, broadcast: false });
    const captured = captureVisibleVisit({
      userId,
      now,
      serverLastVisitAt: new Date(staleVisit).toISOString(),
      thresholdMs: WAITING_THRESHOLD_MS,
      storage,
    });
    // Stored activity is later than last_visit, so the stale home-open stamp is ignored.
    expect(captured.visitAbsence).toBeNull();
    const range = resolveAbsenceRange({
      record: captured,
      serverLastVisitAt: new Date(staleVisit).toISOString(),
      now,
    });
    expect(resolveWaiting(range?.startMs, range?.endMs ?? now)).toBeNull();
  });

  it("falls back to last_visit or last user message when nothing is stored yet", () => {
    const messageAt = now - 2 * WAITING_THRESHOLD_MS;
    const visitAt = now - 6 * WAITING_THRESHOLD_MS;
    const captured = captureVisibleVisit({
      userId,
      now,
      lastUserMessageAt: new Date(messageAt).toISOString(),
      serverLastVisitAt: new Date(visitAt).toISOString(),
      thresholdMs: WAITING_THRESHOLD_MS,
      storage,
    });
    // The later of the two fallbacks is the last user-sent message.
    expect(captured.visitAbsence?.startMs).toBe(messageAt);
    expect(captured.visitAbsence?.returnedAtMs).toBe(now);
  });
});

describe("multiple tabs", () => {
  const userId = "user_tabs";
  const now = Date.parse("2026-11-10T18:00:00Z");

  afterEach(() => {
    _resetActivityBindingsForTests();
  });

  it("lets the latest activity across tabs win, and ignores an older stamp", () => {
    const storage = memoryStorage();
    const earlier = now - 60_000;
    const later = now - 1_000;
    recordActivity(userId, later, { storage, broadcast: false });
    const afterOlder = recordActivity(userId, earlier, { storage, broadcast: false });
    expect(afterOlder.lastActivityMs).toBe(later);
    recordActivity(userId, now, { storage, broadcast: false });
    expect(readActivityRecord(userId, storage).lastActivityMs).toBe(now);
  });

  it("notifies a subscriber in another tab via a storage event", () => {
    const storage = memoryStorage();
    const seen = [];
    const stop = subscribeActivity(userId, (record) => seen.push(record), { storage });

    const otherTab = now - 3 * WAITING_THRESHOLD_MS;
    writeActivityRecord(userId, { lastActivityMs: otherTab }, { storage, now, broadcast: false });

    globalThis.dispatchEvent(
      new StorageEvent("storage", {
        key: activityStorageKey(userId),
        newValue: JSON.stringify({ lastActivityMs: otherTab, visitAbsence: null }),
      }),
    );

    expect(seen.at(-1)?.lastActivityMs).toBe(otherTab);
    stop();
  });

  it("notifies same-process subscribers when activity is recorded", () => {
    const storage = memoryStorage();
    const seen = [];
    const stop = subscribeActivity(userId, (record) => seen.push(record), { storage });
    recordActivity(userId, now, { storage });
    expect(seen.at(-1)?.lastActivityMs).toBe(now);
    stop();
  });
});

describe("bindActivityListeners", () => {
  const userId = "user_bind";

  afterEach(() => {
    _resetActivityBindingsForTests();
  });

  it("stamps a leave on hide and captures the wait when the page is shown again", () => {
    const storage = memoryStorage();
    const listeners = {};
    const doc = {
      hidden: false,
      visibilityState: "visible",
      addEventListener: (ev, fn) => {
        listeners[ev] = fn;
      },
      removeEventListener: (ev) => {
        delete listeners[ev];
      },
    };
    const win = {
      addEventListener: (ev, fn) => {
        listeners[ev] = fn;
      },
      removeEventListener: (ev) => {
        delete listeners[ev];
      },
    };
    let now = Date.parse("2026-11-10T12:00:00Z");
    const unbind = bindActivityListeners({
      userId,
      thresholdMs: WAITING_THRESHOLD_MS,
      now: () => now,
      storage,
      target: doc,
      view: win,
    });

    // Initial visible bind stamps "now" as activity (no prior absence).
    expect(readActivityRecord(userId, storage).lastActivityMs).toBe(now);

    doc.hidden = true;
    doc.visibilityState = "hidden";
    listeners.visibilitychange();
    const leftAt = now;
    expect(readActivityRecord(userId, storage).lastActivityMs).toBe(leftAt);

    now = leftAt + 3 * WAITING_THRESHOLD_MS;
    doc.hidden = false;
    doc.visibilityState = "visible";
    listeners.visibilitychange();

    const record = readActivityRecord(userId, storage);
    expect(record.visitAbsence).toEqual({ startMs: leftAt, returnedAtMs: now });
    expect(record.lastActivityMs).toBe(now);
    unbind();
  });
});

describe("resolveAbsenceRange", () => {
  it("freezes the range after a return so the tile does not keep growing", () => {
    const startMs = 1_000;
    const returnedAtMs = startMs + 3 * WAITING_THRESHOLD_MS;
    const later = returnedAtMs + 2 * WAITING_THRESHOLD_MS;
    const range = resolveAbsenceRange({
      record: { lastActivityMs: returnedAtMs, visitAbsence: { startMs, returnedAtMs } },
      now: later,
    });
    expect(range).toEqual({ startMs, endMs: returnedAtMs });
    expect(resolveWaiting(range.startMs, range.endMs)?.hours).toBe(3);
  });
});
