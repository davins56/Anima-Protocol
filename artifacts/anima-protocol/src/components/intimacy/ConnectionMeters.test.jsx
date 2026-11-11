import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ConnectionMeters, { synchroTierFor } from "./ConnectionMeters";

function setViewport(mobile) {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: mobile,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

afterEach(() => cleanup());

describe("synchroTierFor", () => {
  it("uses the server tier boundaries", () => {
    const names = [0, 15, 16, 35, 36, 60, 61, 85, 86, 100].map((v) => synchroTierFor(v).label);
    expect(names).toEqual([
      "Disconnected", "Disconnected", "Linked", "Linked", "Synchronized",
      "Synchronized", "Soul Unison", "Soul Unison", "Full Cross", "Full Cross",
    ]);
  });
});

describe.each([
  ["desktop", false],
  ["mobile", true],
])("ConnectionMeters (%s)", (name, mobile) => {
  it("shows both meters with distinct values and tier label", () => {
    setViewport(mobile);
    render(<ConnectionMeters synchro={{ strength: 62 }} heat={25} showHeat />);
    const synchro = screen.getByRole("meter", { name: /Synchro/ });
    const heat = screen.getByRole("meter", { name: /Heat/ });
    expect(synchro.getAttribute("aria-valuenow")).toBe("62");
    expect(synchro.getAttribute("aria-valuetext")).toBe("Soul Unison, 62 of 100");
    expect(heat.getAttribute("aria-valuenow")).toBe("25");
    expect(heat.getAttribute("aria-valuetext")).toBe("Stirring, 25 of 100");
    expect(document.querySelector("[data-layout]").getAttribute("data-layout")).toBe(name);
  });

  it("explains each meter: inline on desktop, via accessible label on mobile", () => {
    setViewport(mobile);
    render(<ConnectionMeters synchro={{ strength: 10 }} heat={0} showHeat />);
    const synchroLabel = screen.getByRole("meter", { name: /Synchro/ }).getAttribute("aria-label");
    expect(synchroLabel).toMatch(/Long-term bond/);
    expect(screen.getByRole("meter", { name: /Heat/ }).getAttribute("aria-label")).toMatch(/Right-now/);
    const caption = screen.queryByText(/Long-term bond\. Grows/);
    if (mobile) expect(caption).toBeNull();
    else expect(caption).not.toBeNull();
  });

  it("hides Heat unless intimacy is enabled, and keeps Synchro independent of it", () => {
    setViewport(mobile);
    const { rerender } = render(<ConnectionMeters synchro={{ strength: 90 }} heat={95} showHeat={false} />);
    expect(screen.queryByRole("meter", { name: /Heat/ })).toBeNull();
    expect(screen.getByRole("meter", { name: /Synchro/ }).getAttribute("aria-valuenow")).toBe("90");
    rerender(<ConnectionMeters synchro={{ strength: 90 }} heat={0} showHeat />);
    expect(screen.getByRole("meter", { name: /Synchro/ }).getAttribute("aria-valuenow")).toBe("90");
    expect(screen.getByRole("meter", { name: /Heat/ }).getAttribute("aria-valuenow")).toBe("0");
    expect(within(document.body).getByText(/Full Cross/)).toBeTruthy();
  });

  it("renders nothing when there is nothing to show", () => {
    setViewport(mobile);
    const { container } = render(<ConnectionMeters synchro={null} heat={0} showHeat={false} />);
    expect(container.innerHTML).toBe("");
  });
});
