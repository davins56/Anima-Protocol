import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const speakNaturally = vi.fn();

vi.mock("@/lib/naturalSpeech", () => ({
  speakNaturally: (...args) => speakNaturally(...args),
}));

import AffirmationPlayer from "./AffirmationPlayer";

describe("AffirmationPlayer voice", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    speakNaturally.mockReset();
    speakNaturally.mockReturnValue({ cancel: vi.fn() });
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: { cancel: vi.fn(), speak: vi.fn(), getVoices: () => [] },
    });
  });

  it("uses the natural speech helper with the Anima companion when playing", () => {
    render(
      <AffirmationPlayer
        affirmations={[{ text: "I am grounded, centered, and at peace.", category: "clarity" }]}
        anima={{ name: "Serenity", gender: "female" }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Play spoken line/i }));

    expect(speakNaturally).toHaveBeenCalledWith(
      "I am grounded, centered, and at peace.",
      expect.objectContaining({
        companion: { name: "Serenity", gender: "female" },
      }),
    );
  });
});
