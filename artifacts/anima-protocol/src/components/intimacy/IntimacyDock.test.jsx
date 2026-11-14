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

import IntimacyDock from "./IntimacyDock";

function synchroNow() {
  return screen.getByRole("meter", { name: /Synchro/ }).getAttribute("aria-valuenow");
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  mocks.fetchIntimacyProfile.mockResolvedValue(null);
  mocks.fetchSynchro.mockResolvedValue({ strength: 40, level: "synchronized", label: "Synchronized" });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("IntimacyDock synchro meter", () => {
  it("moves the moment a reply reports a new bond value and shows the change", async () => {
    const { rerender } = render(<IntimacyDock characterId="c1" conversationId="s1" refreshKey={null} />);
    await flush();
    expect(synchroNow()).toBe("40");

    rerender(
      <IntimacyDock characterId="c1" conversationId="s1" refreshKey={null} liveSynchroStrength={43} />,
    );
    expect(synchroNow()).toBe("43");
    expect(screen.getByTestId("synchro-delta").textContent).toBe("+3");
  });

  it("regression: a re-read that lands before the turn's write does not drag the meter back", async () => {
    const { rerender } = render(<IntimacyDock characterId="c1" conversationId="s1" refreshKey={null} />);
    await flush();
    // Reply lands: live value 44, then the turn settles and the dock re-reads.
    rerender(
      <IntimacyDock characterId="c1" conversationId="s1" refreshKey={2} liveSynchroStrength={44} />,
    );
    // The stored row still holds the pre-turn value at the 800 ms read.
    mocks.fetchSynchro.mockResolvedValue({ strength: 40, level: "synchronized" });
    await act(async () => {
      vi.advanceTimersByTime(900);
    });
    await flush();
    expect(synchroNow()).toBe("44");

    // After the live window, the stored value is authoritative again
    // (e.g. a Sacred Space award landed).
    mocks.fetchSynchro.mockResolvedValue({ strength: 47, level: "synchronized" });
    rerender(
      <IntimacyDock characterId="c1" conversationId="s1" refreshKey={4} liveSynchroStrength={44} />,
    );
    await act(async () => {
      vi.advanceTimersByTime(7000);
    });
    await flush();
    expect(synchroNow()).toBe("47");
  });
});
