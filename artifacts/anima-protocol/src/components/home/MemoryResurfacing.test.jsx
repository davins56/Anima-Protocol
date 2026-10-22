import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import MemoryResurfacing from "./MemoryResurfacing";
import HomeDock from "./HomeDock";

const api = {
  getJournalEntries: vi.fn(async () => [{ id: "j1", title: "What we said about the sea" }]),
  getTimelineEvents: vi.fn(async () => [{ id: "t1", eventType: "chapter", title: "Chapter Two" }]),
  markJournalRead: vi.fn(async () => ({ ok: true })),
};

describe("MemoryResurfacing on Home", () => {
  it("shows unread entries + last chapter, and marks read", async () => {
    render(<MemoryResurfacing animaId="a1" api={api} />);
    expect(await screen.findByTestId("memory-resurfacing")).toBeTruthy();
    expect(screen.getByText("Chapter Two")).toBeTruthy();
    fireEvent.click(screen.getByText("Mark read"));
    expect(api.markJournalRead).toHaveBeenCalledWith("a1", "j1");
    await waitFor(() => expect(screen.queryByText("What we said about the sea")).toBeNull());
  });
  it("stays hidden when the user opted out", () => {
    render(<MemoryResurfacing animaId="a1" api={api} allowed={false} />);
    expect(screen.queryByTestId("memory-resurfacing")).toBeNull();
  });
  it("Home dock shows Moments only with a handler", () => {
    const { rerender } = render(<HomeDock onTalk={() => {}} />);
    expect(screen.queryByText("Moments")).toBeNull();
    const onMoments = vi.fn();
    rerender(<HomeDock onTalk={() => {}} onMoments={onMoments} />);
    fireEvent.click(screen.getByText("Moments"));
    expect(onMoments).toHaveBeenCalled();
  });
});
