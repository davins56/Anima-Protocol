import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

vi.mock("@/api/animaApi", () => ({ animaApi: {} }));

import PresenceIndicator from "@/components/continuity/PresenceIndicator";
import { greetingSeen, markGreetingSeen, presenceStyle } from "@/lib/continuity";

function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
}

describe("continuity client", () => {
  it("styles presence and pulses only while dreaming", () => {
    expect(presenceStyle("dreaming").pulse).toBe(true);
    expect(presenceStyle("here").pulse).toBe(false);
    expect(presenceStyle("??")).toEqual(presenceStyle("resting"));
  });

  it("remembers a greeting once per companion", () => {
    const st = memStorage();
    const g = { text: "Morning. I dreamt of glass tides." };
    expect(greetingSeen("c1", g, st)).toBe(false);
    markGreetingSeen("c1", g, st);
    expect(greetingSeen("c1", g, st)).toBe(true);
    expect(greetingSeen("c2", g, st)).toBe(false);
  });

  it("renders presence and a one-time greeting from the API", async () => {
    const st = memStorage();
    const load = vi.fn().mockResolvedValue({
      presence: "dreaming",
      presence_label: "Aeland is dreaming",
      greeting: { text: "Evening. You've been on my mind.", usesDream: null },
    });
    const api = { continuity: { load } };
    const { unmount } = render(<PresenceIndicator characterId="c1" name="Aeland" surface="chat" showGreeting api={api} storage={st} />);
    await waitFor(() => expect(screen.getByText("Aeland is dreaming")).toBeTruthy());
    expect(load).toHaveBeenCalledWith("c1", { surface: "chat", name: "Aeland" });
    expect(await screen.findByTestId("continuity-greeting")).toBeTruthy();
    fireEvent.click(screen.getByTestId("continuity-greeting"));
    expect(screen.queryByTestId("continuity-greeting")).toBeNull();
    unmount();
    render(<PresenceIndicator characterId="c1" name="Aeland" surface="chat" showGreeting api={api} storage={st} />);
    await waitFor(() => expect(screen.getByText("Aeland is dreaming")).toBeTruthy());
    expect(screen.queryByTestId("continuity-greeting")).toBeNull();
  });

  it("renders nothing when the API fails", async () => {
    const api = { continuity: { load: vi.fn().mockRejectedValue(new Error("down")) } };
    const { container } = render(<PresenceIndicator characterId="c1" api={api} />);
    await new Promise((r) => setTimeout(r, 0));
    expect(container.innerHTML).toBe("");
  });
});
