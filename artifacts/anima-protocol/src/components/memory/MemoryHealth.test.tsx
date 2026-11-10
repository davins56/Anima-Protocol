import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import MemoryHealth from "./MemoryHealth";

vi.mock("./RecallLedgerPanel", () => ({
  default: () => <div data-testid="recall-ledger">Why she said that</div>,
}));

vi.mock("@/hooks/useMemoryHealth", () => ({
  formatAge: (seconds: number) => `${seconds}s`,
  useMemoryHealth: () => ({
    memory_count: 3,
    first_memory_at: "2026-01-01T00:00:00Z",
    last_memory_at: null,
    identity_version: 2,
    last_recall_at: null,
    oldest_recent_recall: { event_id: "e1", age_s: 86400, recalled_at: "2026-11-10T00:00:00Z", content: "a week-old note" },
  }),
}));

afterEach(() => cleanup());

describe("MemoryHealth", () => {
  it("opens the memory dialog with the recall ledger and closes on Escape", async () => {
    render(<MemoryHealth characterId="char_aeland_01" characterName="Aeland" sessionId="sess_9f2" />);
    const button = screen.getByRole("button", { name: "Aeland memory health" });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    const dialog = await screen.findByRole("dialog", { name: "Aeland memory core and why she said that" });
    expect(dialog).toBeTruthy();
    expect(screen.getByText(/3 memories/)).toBeTruthy();
    // The ledger is lazy-loaded; either the fallback or the panel may be present in this unit test.
    expect(screen.getByText(/Opening what she recalled|Why she said that/)).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders nothing without a character", () => {
    const { container } = render(<MemoryHealth characterId={null} />);
    expect(container.firstChild).toBeNull();
  });
});
