import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchSynchro: vi.fn(),
  fetchIntimacyProfile: vi.fn(),
  patchIntimacyProfile: vi.fn(),
}));
vi.mock("@/lib/synchroClient", () => ({ fetchSynchro: mocks.fetchSynchro }));
vi.mock("@/lib/intimacyClient", () => ({
  fetchIntimacyProfile: mocks.fetchIntimacyProfile,
  patchIntimacyProfile: mocks.patchIntimacyProfile,
}));

import IntimacyDock, { HEAT_COOL_TICK_MS } from "./IntimacyDock";

const T0 = Date.parse("2026-11-13T23:00:00.000Z");

function heatMeter() {
  return screen.queryByRole("meter", { name: /Heat/ });
}
function heatNow() {
  return Number(heatMeter()?.getAttribute("aria-valuenow"));
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

const pulseOn = (over = {}) => ({ characterId: "natasha", intimacyEnabled: true, heat: 0, safeword: "red", ...over });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  mocks.fetchSynchro.mockResolvedValue({ strength: 22, level: "linked", label: "Linked" });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("IntimacyDock Heat meter", () => {
  it("regression: a heated reply no longer leaves Heat at 'Calm · 0'", async () => {
    mocks.fetchIntimacyProfile.mockResolvedValue(pulseOn());
    const { rerender } = render(<IntimacyDock characterId="natasha" conversationId="s1" refreshKey={null} />);
    await flush();
    expect(heatNow()).toBe(0);
    expect(screen.getByText(/Calm · 0/)).toBeTruthy();

    rerender(
      <IntimacyDock characterId="natasha" conversationId="s1" refreshKey={null} livePulseHeat={{ value: 46, turnId: "t1" }} />,
    );
    expect(heatNow()).toBe(46);
    expect(screen.getByText(/Warm · 46/)).toBeTruthy();
    expect(screen.getByTestId("heat-delta").textContent).toBe("+46");
  });

  it("shows stored right-now intensity from the profile", async () => {
    mocks.fetchIntimacyProfile.mockResolvedValue(
      pulseOn({ intensity: 33, intensityAt: new Date(T0).toISOString() }),
    );
    render(<IntimacyDock characterId="natasha" conversationId="s1" refreshKey={null} />);
    await flush();
    expect(heatNow()).toBe(33);
  });

  it("a re-read that lands before the turn's save does not drag Heat back to Calm", async () => {
    mocks.fetchIntimacyProfile.mockResolvedValue(pulseOn());
    const { rerender } = render(<IntimacyDock characterId="natasha" conversationId="s1" refreshKey={null} />);
    await flush();
    rerender(
      <IntimacyDock characterId="natasha" conversationId="s1" refreshKey={3} livePulseHeat={{ value: 40, turnId: "t2" }} />,
    );
    await act(async () => {
      vi.advanceTimersByTime(3500);
    });
    await flush();
    expect(heatNow()).toBe(40);
  });

  it("cools over a pause on a slow tick, not per render", async () => {
    mocks.fetchIntimacyProfile.mockResolvedValue(
      pulseOn({ intensity: 60, intensityAt: new Date(T0).toISOString() }),
    );
    const { rerender } = render(<IntimacyDock characterId="natasha" conversationId="s1" refreshKey={null} />);
    await flush();
    expect(heatNow()).toBe(60);
    rerender(<IntimacyDock characterId="natasha" conversationId="s1" refreshKey={null} />);
    expect(heatNow()).toBe(60);
    await act(async () => {
      vi.advanceTimersByTime(6 * 60_000 + HEAT_COOL_TICK_MS);
    });
    expect(heatNow()).toBe(30);
    await act(async () => {
      vi.advanceTimersByTime(60 * 60_000);
    });
    expect(heatNow()).toBe(0);
  });

  it("gate unchanged: with Pulse off there is no Heat meter at all", async () => {
    mocks.fetchIntimacyProfile.mockResolvedValue(pulseOn({ intimacyEnabled: false, intensity: 80, intensityAt: new Date(T0).toISOString() }));
    render(
      <IntimacyDock characterId="natasha" conversationId="s1" refreshKey={null} livePulseHeat={{ value: 80, turnId: "t3" }} />,
    );
    await flush();
    expect(heatMeter()).toBeNull();
    expect(screen.getByText("Pulse Off")).toBeTruthy();
  });

  it("the RED safeword button still sends heat 15", async () => {
    mocks.fetchIntimacyProfile.mockResolvedValue(pulseOn({ intensity: 70, intensityAt: new Date(T0).toISOString() }));
    mocks.patchIntimacyProfile.mockResolvedValue(pulseOn({ heat: 15, intensity: 15, intensityAt: new Date(T0).toISOString() }));
    render(<IntimacyDock characterId="natasha" conversationId="s1" refreshKey={null} />);
    await flush();
    await act(async () => {
      screen.getByTitle(/Trigger Safeword \(red\)/).click();
    });
    await flush();
    expect(mocks.patchIntimacyProfile).toHaveBeenCalledWith("natasha", { heat: 15, intimacyEnabled: true });
    expect(heatNow()).toBe(15);
  });
});
