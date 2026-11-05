import { describe, expect, it, vi } from "vitest";

vi.mock("@/api/animaApi", () => ({
  requireChatAuthHeaders: vi.fn(async (extra) => ({ Authorization: "Bearer t", ...extra })),
}));

import {
  buildBrowserSensesSnapshot,
  reportSenses,
  sensesOptedIn,
  setSensesOptIn,
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
});
