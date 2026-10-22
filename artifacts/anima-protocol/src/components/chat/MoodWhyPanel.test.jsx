import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import MoodWhyPanel from "./MoodWhyPanel";

describe("MoodWhyPanel", () => {
  it("opens the why panel from the mood chip", () => {
    render(
      <MoodWhyPanel
        name="Aeland"
        affect={{ primary: "calm", mood: "calm", intensity: 30, intent: "attend", focus: "steward", energy: 50 }}
      />,
    );
    expect(screen.queryByTestId("mood-why-panel")).toBeNull();
    fireEvent.click(screen.getByTestId("mood-chip"));
    expect(screen.getByTestId("mood-why-panel").textContent).toContain("Aeland feels faintly calm.");
  });
  it("falls back to a plain label without a snapshot", () => {
    render(<MoodWhyPanel affect={null} fallbackMood="neutral" />);
    expect(screen.getByText("Mood: neutral")).toBeTruthy();
    expect(screen.queryByTestId("mood-chip")).toBeNull();
  });
});
