import { describe, expect, it, vi } from "vitest";

vi.mock("@/api/animaApi", () => ({
  requireChatAuthHeaders: vi.fn(async (extra) => ({ Authorization: "Bearer t", ...extra })),
}));

import {
  buildBrowserSensesSnapshot,
  forgetSenses,
  pushSensesSnapshot,
  reportSenses,
  sensesOptedIn,
  sensesTimezoneOverride,
  setSensesOptIn,
  setSensesTimezoneOverride,
} from "./animaSenses";

function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

describe("animaSenses", () => {
  it("is off until the steward opts in", () => {
    const storage = memoryStorage();
    expect(sensesOptedIn(storage)).toBe(false);
    setSensesOptIn(true, storage);
    expect(sensesOptedIn(storage)).toBe(true);
    setSensesOptIn(false, storage);
    expect(sensesOptedIn(storage)).toBe(false);
  });

  it("builds a browser snapshot with no calendar", async () => {
    const nav = { onLine: true, getBattery: async () => ({ level: 0.42, charging: false }) };
    const snap = await buildBrowserSensesSnapshot(nav);
    expect(snap.calendar).toEqual([]);
    expect(snap.device).toEqual({ platform: null, battery: 0.42, charging: false, online: true, focusMode: null });
  });

  it("tolerates a browser without battery access", async () => {
    const snap = await buildBrowserSensesSnapshot({ getBattery: async () => { throw new Error("no"); } });
    expect(snap.device.battery).toBeNull();
    expect(snap.device.online).toBeNull();
  });

  it("sends nothing without opt-in", async () => {
    const fetchImpl = vi.fn();
    expect(await reportSenses({ fetchImpl, storage: memoryStorage(), force: true })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("PUTs a snapshot when opted in, and treats 409 as off", async () => {
    const storage = memoryStorage();
    setSensesOptIn(true, storage);
    const ok = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ enabled: true, present: true }) }));
    expect(await reportSenses({ fetchImpl: ok, storage, nav: {}, force: true })).toEqual({ enabled: true, present: true });
    const [url, init] = ok.mock.calls[0];
    expect(url).toContain("/api/senses");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body).calendar).toEqual([]);

    const off = vi.fn(async () => ({ ok: false, status: 409, json: async () => ({}) }));
    expect(await reportSenses({ fetchImpl: off, storage, nav: {}, force: true })).toBeNull();
  });

  it("sends a timezone override in the snapshot", async () => {
    const storage = memoryStorage();
    setSensesTimezoneOverride("America/New_York", storage);
    expect(sensesTimezoneOverride(storage)).toBe("America/New_York");
    const snap = await buildBrowserSensesSnapshot({}, { timezone: "Europe/Paris", storage });
    expect(snap.timezone).toBe("Europe/Paris");
    const fromStore = await buildBrowserSensesSnapshot({}, { storage });
    expect(fromStore.timezone).toBe("America/New_York");
  });

  it("pushSensesSnapshot reports 409 as serverOff", async () => {
    const off = vi.fn(async () => ({ ok: false, status: 409, json: async () => ({ enabled: false }) }));
    const result = await pushSensesSnapshot({ fetchImpl: off, storage: memoryStorage(), nav: {} });
    expect(result).toEqual({ ok: false, serverOff: true });
  });

  it("forgetSenses DELETEs and clears opt-in", async () => {
    const storage = memoryStorage();
    setSensesOptIn(true, storage);
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }));
    expect(await forgetSenses({ fetchImpl, storage })).toEqual({ ok: true });
    expect(sensesOptedIn(storage)).toBe(false);
    expect(fetchImpl.mock.calls[0][1].method).toBe("DELETE");
  });
});
