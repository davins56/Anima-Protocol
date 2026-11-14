import { describe, expect, it, vi } from "vitest";

vi.mock("@/api/animaApi", () => ({
  requireChatAuthHeaders: vi.fn(async (extra) => ({ Authorization: "Bearer t", ...extra })),
}));

import { calendarOutcomeMessage, disconnectCalendarProvider, loadCalendarStatus, startCalendarConnect } from "./calendarAwareness";

const ok = (body: unknown, status = 200) => ({ ok: status < 300, status, json: async () => body });
const path = (url: unknown) => new URL(String(url), "http://localhost").pathname;

describe("calendarAwareness client", () => {
  it("calls /api/calendar (not /api/api/...) and parses status", async () => {
    const f = vi.fn(async () => ok({ enabled: true, providers: { google: true, microsoft: false }, connections: [], busy: null }));
    const res = await loadCalendarStatus({ fetchImpl: f as unknown as typeof fetch });
    expect(res.ok).toBe(true);
    expect(path((f.mock.calls[0] as unknown[])[0])).toBe("/api/calendar");
  });

  it("only accepts Google or Microsoft sign-in URLs", async () => {
    const good = vi.fn(async () => ok({ url: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?x" }));
    expect(await startCalendarConnect("microsoft", { fetchImpl: good as unknown as typeof fetch })).toMatchObject({ ok: true });
    const [url, init] = good.mock.calls[0] as unknown as [string, RequestInit];
    expect(path(url)).toBe("/api/calendar/connect/microsoft");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("same-origin");
    const evil = vi.fn(async () => ok({ url: "https://evil.example/login" }));
    expect(await startCalendarConnect("google", { fetchImpl: evil as unknown as typeof fetch })).toMatchObject({ ok: false });
    const off = vi.fn(async () => ok({}, 503));
    expect(await startCalendarConnect("google", { fetchImpl: off as unknown as typeof fetch })).toEqual({
      ok: false,
      message: "Calendar sign-in is not set up on the server yet.",
    });
  });

  it("disconnects with DELETE /api/calendar/:provider", async () => {
    const f = vi.fn(async () => ok({ ok: true }));
    expect(await disconnectCalendarProvider("google", { fetchImpl: f as unknown as typeof fetch })).toEqual({ ok: true });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(path(url)).toBe("/api/calendar/google");
    expect(init.method).toBe("DELETE");
  });

  it("maps callback outcomes to messages", () => {
    expect(calendarOutcomeMessage(null)).toBeNull();
    expect(calendarOutcomeMessage("connected")?.tone).toBe("ok");
    expect(calendarOutcomeMessage("invalid_state")?.tone).toBe("error");
    expect(calendarOutcomeMessage("whatever")?.text).toMatch(/Could not connect/);
  });
});
