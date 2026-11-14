import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  loadCalendarStatus: vi.fn(),
  startCalendarConnect: vi.fn(),
  disconnectCalendarProvider: vi.fn(),
}));
vi.mock("@/lib/calendarAwareness", async () => {
  const actual = await vi.importActual<typeof import("@/lib/calendarAwareness")>("@/lib/calendarAwareness");
  return { ...actual, ...m };
});

import CalendarAwarenessSection from "./CalendarAwarenessSection";

const base = { enabled: true, providers: { google: true, microsoft: true }, busy: null };

describe("CalendarAwarenessSection", () => {
  afterEach(() => cleanup());
  beforeEach(() => vi.clearAllMocks());

  it("starts sign-in by navigating to the URL the server returns", async () => {
    m.loadCalendarStatus.mockResolvedValue({ ok: true, status: { ...base, connections: [] } });
    m.startCalendarConnect.mockResolvedValue({ ok: true, url: "https://accounts.google.com/o/oauth2/v2/auth?x=1" });
    const navigate = vi.fn();
    render(<CalendarAwarenessSection navigate={navigate} />);
    const [google] = await screen.findAllByRole("button", { name: "Connect" });
    fireEvent.click(google);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("https://accounts.google.com/o/oauth2/v2/auth?x=1"));
    expect(m.startCalendarConnect).toHaveBeenCalledWith("google");
  });

  it("disconnects a connected provider and reloads", async () => {
    m.loadCalendarStatus
      .mockResolvedValueOnce({
        ok: true,
        status: { ...base, connections: [{ provider: "microsoft", status: "active", lastSyncedAt: null }] },
      })
      .mockResolvedValue({ ok: true, status: { ...base, connections: [] } });
    m.disconnectCalendarProvider.mockResolvedValue({ ok: true });
    render(<CalendarAwarenessSection navigate={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Disconnect" }));
    await waitFor(() => expect(m.disconnectCalendarProvider).toHaveBeenCalledWith("microsoft"));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Disconnect" })).toBeNull());
  });

  it("shows a server-off notice and a reconnect hint", async () => {
    m.loadCalendarStatus.mockResolvedValue({
      ok: true,
      status: { ...base, enabled: false, connections: [{ provider: "google", status: "reauth_required" }] },
    });
    render(<CalendarAwarenessSection navigate={vi.fn()} />);
    expect(await screen.findByText(/turned off on the server/i)).toBeTruthy();
    expect(screen.getByText(/Sign-in expired/)).toBeTruthy();
  });
});
