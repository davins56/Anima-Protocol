import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import ResonanceField from "./ResonanceField";

afterEach(() => cleanup());

describe("ResonanceField", () => {
  it("re-renders the new bond value and shows how much the turn moved it", () => {
    const { rerender } = render(<ResonanceField value={34} label="ATTUNED" resetKey="s:bond" />);
    const meter = screen.getByRole("meter", { name: "Resonance Field" });
    expect(meter.getAttribute("aria-valuenow")).toBe("34");
    expect(screen.queryByTestId("resonance-delta")).toBeNull();

    rerender(<ResonanceField value={38} label="ATTUNED" resetKey="s:bond" />);
    expect(meter.getAttribute("aria-valuenow")).toBe("38");
    expect(screen.getByTestId("resonance-delta").textContent).toBe("+4");
    expect(screen.getByText(/ATTUNED · 38%/)).toBeTruthy();
  });

  it("shows a drop after a hostile turn", () => {
    const { rerender } = render(<ResonanceField value={50} label="BONDED" resetKey="s:bond" />);
    rerender(<ResonanceField value={44} label="ATTUNED" resetKey="s:bond" />);
    expect(screen.getByTestId("resonance-delta").textContent).toBe("\u22126");
  });

  it("does not flash when the first server value replaces the local estimate", () => {
    const { rerender } = render(<ResonanceField value={8} label="DISTANT" resetKey="s:estimate" />);
    rerender(<ResonanceField value={61} label="BONDED" resetKey="s:bond" />);
    expect(screen.queryByTestId("resonance-delta")).toBeNull();
  });

  it("rounds and clamps out-of-range values", () => {
    render(<ResonanceField value={104.6} label="ENTWINED" />);
    expect(screen.getByRole("meter").getAttribute("aria-valuenow")).toBe("100");
  });
});
