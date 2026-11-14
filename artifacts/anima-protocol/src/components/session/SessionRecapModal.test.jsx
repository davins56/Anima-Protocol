import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

  it("shows an honest error, and Try again recovers the recap", async () => {
    mocks.get.mockResolvedValue({ id: "s-nat", title: "Natasha Romanoff" });
    mocks.invoke.mockResolvedValueOnce(null).mockResolvedValueOnce({
      data: { generated: true, summary: "Second try worked.", emotional_arc: "Calm.", message_count: 4 },
    });
    render(<SessionRecapModal isOpen sessionId="s-nat" onClose={() => {}} />);

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByText(/narrative journey unfolds/i)).toBeNull();
    expect(screen.queryByText("Undefined")).toBeNull();

    fireEvent.click(screen.getByText("Try again"));
    expect(await screen.findByText("Second try worked.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
  });

  it("ignores a slow recap for a session the user already left", async () => {
    let resolveFirst;
    mocks.get.mockResolvedValue(null);
    mocks.invoke
      .mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; }))
      .mockResolvedValueOnce({ data: { generated: true, summary: "Second session recap.", message_count: 2 } });
    const { rerender } = render(<SessionRecapModal isOpen sessionId="s-1" onClose={() => {}} />);
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(1));
    rerender(<SessionRecapModal isOpen sessionId="s-2" onClose={() => {}} />);
    expect(await screen.findByText("Second session recap.")).toBeTruthy();
    resolveFirst({ data: { generated: true, summary: "Stale first session.", message_count: 9 } });
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText("Stale first session.")).toBeNull();
    expect(screen.getByText("Second session recap.")).toBeTruthy();
  });
});
