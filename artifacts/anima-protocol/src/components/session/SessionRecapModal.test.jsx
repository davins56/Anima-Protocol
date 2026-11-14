import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  list: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock("@/api/animaClient", () => ({
  animaClient: {
    entities: { ChatSession: { get: mocks.get, list: mocks.list } },
    functions: { invoke: mocks.invoke },
  },
}));

import SessionRecapModal from "./SessionRecapModal";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SessionRecapModal", () => {
  it("recaps the requested session from the server's real summary and arc", async () => {
    mocks.get.mockResolvedValue({ id: "s-nat", title: "Natasha Romanoff" });
    mocks.invoke.mockResolvedValue({
      data: {
        generated: true,
        summary: "They argued about the mission, then made peace on the roof.",
        emotional_arc: "Tense, then tender.",
        key_moments: ["The argument"],
        message_count: 101,
      },
    });
    render(<SessionRecapModal isOpen sessionId="s-nat" onClose={() => {}} />);

    expect(
      await screen.findByText("They argued about the mission, then made peace on the roof."),
    ).toBeTruthy();
    expect(screen.getByText("Tense, then tender.")).toBeTruthy();
    expect(screen.getByText("101 messages")).toBeTruthy();
    expect(screen.queryByText(/narrative journey unfolds/i)).toBeNull();
    expect(screen.queryByText("Undefined")).toBeNull();
    expect(mocks.get).toHaveBeenCalledWith("s-nat", { withMessages: false });
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.invoke).toHaveBeenCalledWith("generateSessionSummary", { session_id: "s-nat" });
  });

  it("shows an honest error with a retry instead of placeholder text", async () => {
    mocks.get.mockResolvedValue({ id: "s-nat", title: "Natasha Romanoff" });
    mocks.invoke.mockResolvedValue(null);
    render(<SessionRecapModal isOpen sessionId="s-nat" onClose={() => {}} />);

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText("Try again")).toBeTruthy();
    await waitFor(() => expect(screen.queryByText(/narrative journey unfolds/i)).toBeNull());
    expect(screen.queryByText("Undefined")).toBeNull();
  });
});
