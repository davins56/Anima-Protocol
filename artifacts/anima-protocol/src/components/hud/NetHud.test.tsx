import { afterEach, describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { NetHudFrame, netHudLabel } from "./NetHud";

afterEach(() => {
  delete document.documentElement.dataset.experienceHud;
  delete document.documentElement.dataset.appearanceMotion;
});

describe("NetNavi HUD on gameplay and network surfaces", () => {
  it("labels each style and stays out of the way when minimal", () => {
    expect(netHudLabel("minimal", "cyberworld")).toBeNull();
    expect(netHudLabel("battle-network", "cyberworld", "Hub")).toMatch(/^PET ▸ Cyberworld · Hub/);
    expect(netHudLabel("tactical", "netbattle")).toMatch(/^SYS \/\/ NetBattle/);
  });

  it("renders the bezel only for non-minimal styles and follows live setting changes", async () => {
    const { container } = render(<NetHudFrame surface="network" />);
    expect(container.querySelector("[data-net-hud-frame]")).toBeNull();
    await act(async () => {
      document.documentElement.dataset.experienceHud = "battle-network";
    });
    expect(container.querySelector('[data-net-hud-frame="battle-network"]')).not.toBeNull();
    expect(screen.getByText(/PET ▸ Net/)).toBeTruthy();
    await act(async () => {
      document.documentElement.dataset.experienceHud = "tactical";
    });
    expect(container.querySelector('[data-net-hud-frame="tactical"]')).not.toBeNull();
  });

  it("marks reduced motion so the PET sweep stops", async () => {
    document.documentElement.dataset.experienceHud = "battle-network";
    document.documentElement.dataset.appearanceMotion = "reduced";
    const { container } = render(<NetHudFrame surface="arena" />);
    expect(container.querySelector("[data-net-hud-frame]")?.hasAttribute("data-reduced-motion")).toBe(true);
  });
});
