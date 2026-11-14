import { describe, expect, it, vi } from "vitest";

vi.mock("@/api/animaApi", () => ({
  requireChatAuthHeaders: vi.fn(async (extra) => ({ Authorization: "Bearer t", ...extra })),
}));

import {
  DEFAULT_RHYTHM_DRAFT,
  SERVER_QUIET_HOURS_LABEL,
  SensesStatusSchema,
  formatHourLabel,
  getRhythmSettings,
  loadSensesStatus,
  optInDayRhythm,
  optOutAndForgetRhythm,
} from "./dayRhythm";

/**
 * apiUrl() already prefixes "/api". Calling apiUrl("/api/senses") produced
 * /api/api/senses, which Express answers with 404, so Day Rhythm showed
 * "Could not share your rhythm snapshot." Pin the exact path.
 */
function expectSensesUrl(url: string) {
  expect(new URL(url, "http://localhost").pathname).toBe("/api/senses");
  expect(url).not.toContain("/api/api/");
}

function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => {
      m.set(k, String(v));
    },
    removeItem: (k: string) => {
      m.delete(k);
    },
  };
}

describe("dayRhythm client", () => {
  it("parses a GET /api/senses summary without calendar titles", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        enabled: true,
        present: true,
        receivedAt: "2026-11-11T00:00:00.000Z",
        timezone: "America/New_York",
        calendarBlocks: 2,
        busyNow: false,
        nextBlockInMinutes: 40,
        device: { platform: "macOS", battery: 0.8, charging: false, online: true, focusMode: null },
        title: "should be ignored if present",
      }),
    }));
    const load = await loadSensesStatus({ fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(load.ok).toBe(true);
    if (!load.ok) return;
    expect(load.status).toMatchObject({
      enabled: true,
      present: true,
      timezone: "America/New_York",
      calendarBlocks: 2,
    });
    expect(load.status).not.toHaveProperty("title");
    expect(SensesStatusSchema.parse(load.status).timezone).toBe("America/New_York");
    const getUrl = String((fetchImpl.mock.calls[0] as unknown as [string])[0]);
    expectSensesUrl(getUrl);
  });

  it("treats an empty snapshot as present:false", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ enabled: false, present: false }),
    }));
    const load = await loadSensesStatus({ fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(load).toEqual({ ok: true, status: { enabled: false, present: false } });
  });

  it("maps 401 and invalid JSON to typed errors", async () => {
    const unauthorized = await loadSensesStatus({
      fetchImpl: vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })) as unknown as typeof fetch,
    });
    expect(unauthorized).toMatchObject({ ok: false, kind: "unauthorized" });

    const invalid = await loadSensesStatus({
      fetchImpl: vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ nope: true }) })) as unknown as typeof fetch,
    });
    expect(invalid).toMatchObject({ ok: false, kind: "invalid_response" });
  });

  it("returns a typed not-connected state for per-user quiet hours", async () => {
    const result = await getRhythmSettings();
    expect(result).toEqual({ connected: false, reason: "not_connected_yet" });
    expect(SERVER_QUIET_HOURS_LABEL).toBe("Server default: 10 PM to 8 AM");
    expect(DEFAULT_RHYTHM_DRAFT).toMatchObject({
      quietStartHour: 22,
      quietEndHour: 8,
      companionId: null,
    });
    expect(formatHourLabel(22)).toBe("10 PM");
    expect(formatHourLabel(8)).toBe("8 AM");
  });

  it("opts in by PUTting a snapshot and surfaces a 409 as server off", async () => {
    const storage = memoryStorage();
    const ok = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ enabled: true, present: true, timezone: "UTC" }),
    }));
    const result = await optInDayRhythm({
      timezone: "UTC",
      fetchImpl: ok as unknown as typeof fetch,
      storage,
      nav: {} as Navigator,
    });
    expect(result.ok).toBe(true);
    expect(storage.getItem("anima_senses_opt_in")).toBe("1");
    expect(storage.getItem("anima_senses_timezone")).toBe("UTC");
    const putCall = ok.mock.calls[0] as unknown as [string, { method: string; body: string }];
    expectSensesUrl(String(putCall[0]));
    expect(putCall[1].method).toBe("PUT");
    expect(JSON.parse(putCall[1].body).timezone).toBe("UTC");
    expect(JSON.parse(putCall[1].body).calendar).toEqual([]);

    const off = vi.fn(async () => ({
      ok: false,
      status: 409,
      json: async () => ({ enabled: false }),
    }));
    const blocked = await optInDayRhythm({
      fetchImpl: off as unknown as typeof fetch,
      storage,
      nav: {} as Navigator,
    });
    expect(blocked).toEqual({ ok: false, serverOff: true });
  });

  it("forgets rhythm data with DELETE /api/senses", async () => {
    const storage = memoryStorage();
    storage.setItem("anima_senses_opt_in", "1");
    storage.setItem("anima_senses_timezone", "UTC");
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }));
    const result = await optOutAndForgetRhythm({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      storage,
    });
    expect(result).toEqual({ ok: true });
    expect(storage.getItem("anima_senses_opt_in")).toBeNull();
    expect(storage.getItem("anima_senses_timezone")).toBeNull();
    const deleteCall = fetchImpl.mock.calls[0] as unknown as [string, { method: string }];
    expectSensesUrl(String(deleteCall[0]));
    expect(deleteCall[1].method).toBe("DELETE");
  });
});
