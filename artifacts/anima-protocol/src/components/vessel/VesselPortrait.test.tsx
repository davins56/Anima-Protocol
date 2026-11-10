import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const vesselState: { vessel: unknown } = { vessel: null };
vi.mock("@/hooks/useCharacterVessel", () => ({ useCharacterVessel: () => ({ vessel: vesselState.vessel, loading: false }) }));
const load = vi.fn();
vi.mock("@/lib/vessel/vesselSnapshot", () => ({ loadVesselSnapshot: (...a: unknown[]) => load(...a) }));

import VesselPortrait from "./VesselPortrait";
import { defaultVesselFor } from "@/lib/vessel/vesselConfig";

const fallback = <img alt="avatar" src="/a.png" />;

describe("VesselPortrait (chat header)", () => {
  beforeEach(() => {
    load.mockReset();
    vesselState.vessel = null;
  });

  it("keeps the avatar when no vessel is saved", () => {
    const { container } = render(<VesselPortrait characterId="c1" name="Scarlet" fallback={fallback} />);
    expect(screen.getByAltText("avatar")).toBeTruthy();
    expect(container.querySelector("canvas")).toBeNull();
    expect(load).not.toHaveBeenCalled();
  });

  it("shows the saved snapshot as a still image, never a canvas, even while speaking", async () => {
    vesselState.vessel = { config: defaultVesselFor({ name: "Scarlet" }), snapshot_path: "u/c1/vessel.jpg" };
    load.mockResolvedValue("blob:snap");
    const { container } = render(<VesselPortrait characterId="c1" name="Scarlet" mood="happy" intensity={8} speaking fallback={fallback} />);
    await waitFor(() => expect(screen.getByAltText("Scarlet").getAttribute("src")).toBe("blob:snap"));
    expect(load).toHaveBeenCalledWith("c1", "u/c1/vessel.jpg");
    expect(container.querySelector("canvas")).toBeNull();
    const host = container.querySelector("[data-vessel-portrait]")!;
    expect(host.getAttribute("data-vessel-portrait")).toBe("snapshot");
    expect(host.className).not.toMatch(/animate-/);
  });

  it("falls back to the avatar when the vessel has no snapshot or it fails", async () => {
    vesselState.vessel = { config: defaultVesselFor({ name: "Scarlet" }), snapshot_path: null };
    render(<VesselPortrait characterId="c1" name="Scarlet" fallback={fallback} />);
    expect(screen.getByAltText("avatar")).toBeTruthy();
    vesselState.vessel = { config: defaultVesselFor({ name: "Scarlet" }), snapshot_path: "p" };
    load.mockResolvedValue(null);
    render(<VesselPortrait characterId="c2" name="Scarlet" fallback={fallback} />);
    await waitFor(() => expect(load).toHaveBeenCalled());
    expect(screen.getAllByAltText("avatar").length).toBe(2);
  });
});
