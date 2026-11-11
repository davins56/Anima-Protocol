import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const completeSacredSpace = vi.fn();

vi.mock("@/api/animaClient", () => ({
  animaClient: { integrations: { Core: { InvokeLLM: vi.fn() } } },
}));
vi.mock("@/lib/sacredSpaceCheckIn", () => ({ recordSacredSpaceCheckIn: vi.fn() }));
vi.mock("@/lib/synchroClient", () => ({
  completeSacredSpace: (...a) => completeSacredSpace(...a),
  newSacredSessionId: (p) => `${p}-fixed-id`,
}));

import MeditationRitual from "./MeditationRitual";

async function finishAllSteps() {
  for (let i = 0; i < 6; i++) {
    fireEvent.click(screen.getAllByText("Begin")[0]);
    fireEvent.click(await screen.findByText("Complete"));
  }
}

describe("MeditationRitual resonance", () => {
  beforeEach(() => {
    completeSacredSpace.mockReset();
    completeSacredSpace.mockResolvedValue({ awarded: 2, label: "Linked", strength: 32 });
  });
  afterEach(() => cleanup());

  it("reports the finished ritual once, with a stable session id, and shows the result", async () => {
    render(<MeditationRitual anima={{ id: "char-1", name: "Serenity" }} user={{}} />);
    await finishAllSteps();
    await waitFor(() => expect(screen.getByTestId("ritual-resonance").textContent).toBe("Resonance +2 — Linked (32/100)"));
    expect(completeSacredSpace).toHaveBeenCalledTimes(1);
    expect(completeSacredSpace).toHaveBeenCalledWith(
      expect.objectContaining({
        characterId: "char-1",
        sessionId: "sacred-ritual-fixed-id",
        activity: "meditation_ritual",
        stepsCompleted: 6,
      }),
    );
  });

  it("does not report for a ritual without a companion id", async () => {
    render(<MeditationRitual anima={{ name: "Serenity" }} user={{}} />);
    await finishAllSteps();
    expect(completeSacredSpace).not.toHaveBeenCalled();
  });
});
