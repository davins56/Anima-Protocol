import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const vesselState: { vessel: unknown; loading: boolean } = { vessel: null, loading: false };
vi.mock("@/hooks/useCharacterVessel", () => ({ useCharacterVessel: () => ({ vessel: vesselState.vessel, loading: vesselState.loading }) }));
const canvasProps: Record<string, unknown>[] = [];
vi.mock("./VesselCanvas", () => ({
  default: (p: Record<string, unknown>) => {
    canvasProps.push(p);
    return <div data-testid="vessel-canvas" />;
  },
}));

import CalibratedVessel from "./CalibratedVessel";
import { defaultVesselFor } from "@/lib/vessel/vesselConfig";
import { normalizeVesselCalibration, setCalibrationField } from "@/lib/vessel/vesselCalibration";

describe("CalibratedVessel (Essence live preview)", () => {
  beforeEach(() => {
    canvasProps.length = 0;
    vesselState.vessel = null;
    vesselState.loading = false;
  });

  it("renders one canvas over her saved vessel; defaults change nothing", () => {
    const saved = defaultVesselFor({ name: "Scarlet" });
    vesselState.loading = true;
    const cal = normalizeVesselCalibration({ vesselType: "orb", theme: "light" });
    const { rerender } = render(<CalibratedVessel characterId="c1" calibration={cal} />);
    // Held while her vessel loads: no preset flash.
    expect(screen.queryByTestId("vessel-canvas")).toBeNull();
    vesselState.loading = false;
    vesselState.vessel = { config: saved };
    rerender(<CalibratedVessel characterId="c1" calibration={cal} />);
    expect(screen.getAllByTestId("vessel-canvas")).toHaveLength(1);
    const el = screen.getByTestId("calibrated-vessel");
    expect(el.dataset.vesselForm).toBe("humanoid");
    expect(el.dataset.stage).toBe("dark");
    expect(canvasProps.at(-1)).toMatchObject({ config: saved, mode: "full", stage: null });
  });

  it("follows user edits: form and stage theme", () => {
    const cal = setCalibrationField(setCalibrationField(normalizeVesselCalibration({}), "vesselType", "chalice"), "theme", "light");
    render(<CalibratedVessel name="Serenity" calibration={cal} />);
    const el = screen.getByTestId("calibrated-vessel");
    expect(el.dataset.vesselForm).toBe("chalice");
    expect(el.dataset.stage).toBe("light");
    expect(canvasProps.at(-1)).toMatchObject({ calibration: cal, stage: "light" });
  });
});
