import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rhythmMocks = vi.hoisted(() => ({
  getRhythmSettings: vi.fn(),
  isDayRhythmOptedIn: vi.fn(),
  loadSensesStatus: vi.fn(),
  optInDayRhythm: vi.fn(),
  optOutAndForgetRhythm: vi.fn(),
  sensesTimezoneOverride: vi.fn(),
  setSensesTimezoneOverride: vi.fn(),
}));

vi.mock("@/lib/dayRhythm", async () => {
  const actual = await vi.importActual<typeof import("@/lib/dayRhythm")>("@/lib/dayRhythm");
  return {
    ...actual,
    getRhythmSettings: rhythmMocks.getRhythmSettings,
    isDayRhythmOptedIn: rhythmMocks.isDayRhythmOptedIn,
    loadSensesStatus: rhythmMocks.loadSensesStatus,
    optInDayRhythm: rhythmMocks.optInDayRhythm,
    optOutAndForgetRhythm: rhythmMocks.optOutAndForgetRhythm,
  };
});

vi.mock("@/lib/animaSenses", async () => {
  const actual = await vi.importActual<typeof import("@/lib/animaSenses")>("@/lib/animaSenses");
  return {
    ...actual,
    sensesTimezoneOverride: rhythmMocks.sensesTimezoneOverride,
    setSensesTimezoneOverride: rhythmMocks.setSensesTimezoneOverride,
  };
});

const calendarMocks = vi.hoisted(() => ({
  loadCalendarStatus: vi.fn(),
  startCalendarConnect: vi.fn(),
  disconnectCalendarProvider: vi.fn(),
}));

vi.mock("@/lib/calendarAwareness", async () => {
  const actual = await vi.importActual<typeof import("@/lib/calendarAwareness")>("@/lib/calendarAwareness");
  return { ...actual, ...calendarMocks };
});

import DayRhythmSettings from "./DayRhythmSettings";

describe("DayRhythmSettings", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    rhythmMocks.isDayRhythmOptedIn.mockReturnValue(false);
    calendarMocks.loadCalendarStatus.mockResolvedValue({
      ok: true,
      status: { enabled: true, providers: { google: true, microsoft: false }, connections: [], busy: null },
    });
    rhythmMocks.sensesTimezoneOverride.mockReturnValue(null);
    rhythmMocks.getRhythmSettings.mockResolvedValue({
      connected: false,
      reason: "not_connected_yet",
    });
    rhythmMocks.loadSensesStatus.mockResolvedValue({
      ok: true,
      status: { enabled: true, present: false },
    });
    rhythmMocks.optInDayRhythm.mockResolvedValue({
      ok: true,
      status: { enabled: true, present: true, timezone: "UTC", calendarBlocks: 0 },
    });
    rhythmMocks.optOutAndForgetRhythm.mockResolvedValue({ ok: true });
  });

  it("renders consent copy and stays off until the steward opts in", async () => {
    render(<DayRhythmSettings />);
    expect(await screen.findByRole("heading", { name: /day rhythm/i })).toBeTruthy();
    expect(
      screen.getByText(/nothing is shared until you turn this on/i),
    ).toBeTruthy();
    expect(screen.getByText(/busy or free blocks only/i)).toBeTruthy();
    const toggle = screen.getByRole("switch", { name: "Turn on day rhythm" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
  });

  it("opts in through the senses snapshot and surfaces a server-off 409", async () => {
    render(<DayRhythmSettings />);
    const toggle = await screen.findByRole("switch", { name: "Turn on day rhythm" });
    fireEvent.click(toggle);
    await waitFor(() => {
      expect(rhythmMocks.optInDayRhythm).toHaveBeenCalled();
    });

    cleanup();
    rhythmMocks.optInDayRhythm.mockResolvedValueOnce({ ok: false, serverOff: true });
    render(<DayRhythmSettings />);
    fireEvent.click(await screen.findByRole("switch", { name: "Turn on day rhythm" }));
    expect(await screen.findByText("Day rhythm is turned off on the server.")).toBeTruthy();
  });

  it("shows the server quiet-hours default and keeps draft edits out of localStorage", async () => {
    render(<DayRhythmSettings />);
    expect(await screen.findByText("Server default: 10 PM to 8 AM")).toBeTruthy();
    expect(
      screen.getByText(/quiet hours also silence her self-started messages/i),
    ).toBeTruthy();
    expect(screen.getByText(/per-user and per-companion quiet hours are not connected yet/i)).toBeTruthy();
    expect(screen.getAllByText(/quiet hours need a timezone/i).length).toBeGreaterThan(0);

    const start = screen.getByLabelText("Start");
    fireEvent.change(start, { target: { value: "21" } });
    expect((start as HTMLSelectElement).value).toBe("21");
    expect(localStorage.getItem("anima_rhythm_settings")).toBeNull();
    expect(
      Object.keys(localStorage).filter((key) => /quiet|rhythm_settings/i.test(key)),
    ).toEqual([]);
  });

  it("shows calendar awareness with busy/free-only copy and per-provider connect", async () => {
    render(<DayRhythmSettings />);
    expect(await screen.findByText(/never event titles/i)).toBeTruthy();
    expect(screen.queryByText(/coming soon/i)).toBeNull();
    expect(await screen.findByText("Google Calendar")).toBeTruthy();
    expect(screen.getByText("Not set up on the server yet.")).toBeTruthy();
    const connects = screen.getAllByRole("button", { name: "Connect" });
    expect(connects).toHaveLength(2);
    expect(connects[0]).toHaveProperty("disabled", false);
    expect(connects[1]).toHaveProperty("disabled", true);
    expect(calendarMocks.startCalendarConnect).not.toHaveBeenCalled();
  });

  it("reloads calendar status after forgetting rhythm data", async () => {
    render(<DayRhythmSettings />);
    await waitFor(() => expect(calendarMocks.loadCalendarStatus).toHaveBeenCalledTimes(1));
    fireEvent.click(await screen.findByRole("button", { name: "Forget my rhythm data" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm forget" }));
    await waitFor(() => expect(calendarMocks.loadCalendarStatus).toHaveBeenCalledTimes(2));
  });

  it("forgets rhythm data through DELETE after confirm", async () => {
    render(<DayRhythmSettings />);
    fireEvent.click(await screen.findByRole("button", { name: "Forget my rhythm data" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm forget" }));
    await waitFor(() => {
      expect(rhythmMocks.optOutAndForgetRhythm).toHaveBeenCalledOnce();
    });
  });

  it("announces when the server switch is already off on load", async () => {
    rhythmMocks.loadSensesStatus.mockResolvedValue({
      ok: true,
      status: { enabled: false, present: false },
    });
    render(<DayRhythmSettings />);
    expect(await screen.findByText("Day rhythm is turned off on the server.")).toBeTruthy();
  });
});
