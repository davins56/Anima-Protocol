import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const speak = vi.fn();
const stop = vi.fn();
const toggle = vi.fn();

vi.mock("@/hooks/useSacredSpaceVoice", () => ({
  useSacredSpaceVoice: () => ({
    isEnabled: true,
    isSpeaking: false,
    isSupported: true,
    speak,
    stop,
    toggle,
  }),
}));

const invokeLLM = vi.fn();
const recordSacredSpaceCheckIn = vi.fn();

vi.mock("@/api/base44Client", () => ({
  base44: {
    integrations: { Core: { InvokeLLM: (...args) => invokeLLM(...args) } },
    functions: { invoke: vi.fn() },
  },
}));

vi.mock("@/lib/sacredSpaceCheckIn", () => ({
  recordSacredSpaceCheckIn: (...args) => recordSacredSpaceCheckIn(...args),
}));

import SacredSpaceSession from "./SacredSpaceSession";

const character = {
  id: "char-1",
  name: "Serenity",
  personality: "She is warm and present. Her voice is low.",
  speaking_style: "Thoughtful and measured",
};

describe("SacredSpaceSession voice", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    speak.mockReset();
    stop.mockReset();
    toggle.mockReset();
    invokeLLM.mockReset();
    invokeLLM.mockResolvedValue("Welcome. Breathe with me. This space is yours.");
  });

  it("speaks companion lines through the natural voice path", async () => {
    render(
      <SacredSpaceSession
        character={character}
        user={{ email: "operator@example.com" }}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Healing/i }));
    fireEvent.click(screen.getByRole("button", { name: /Enter Sacred Space/i }));

    await waitFor(() => {
      expect(speak).toHaveBeenCalledWith("Welcome. Breathe with me. This space is yours.");
    });
    expect(screen.getByText(/Welcome. Breathe with me/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Mute Sacred Space voice/i })).toBeTruthy();
  });

  it("speaks follow-up companion replies and can mute from the header", async () => {
    invokeLLM
      .mockResolvedValueOnce("Welcome. Begin when you are ready.")
      .mockResolvedValueOnce("I hear you. Stay with the breath.");

    render(
      <SacredSpaceSession
        character={character}
        user={{ email: "operator@example.com" }}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Love/i }));
    fireEvent.click(screen.getByRole("button", { name: /Enter Sacred Space/i }));
    await waitFor(() => expect(speak).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByPlaceholderText("Speak from your heart..."), {
      target: { value: "I feel heavy today." },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Send$/i }));

    await waitFor(() => {
      expect(speak).toHaveBeenCalledWith("I hear you. Stay with the breath.");
    });

    fireEvent.click(screen.getByRole("button", { name: /Mute Sacred Space voice/i }));
    expect(toggle).toHaveBeenCalled();
  });
});
