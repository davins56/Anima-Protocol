import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import MemoryResurfacing from "./MemoryResurfacing";
import HomeDock from "./HomeDock";

vi.mock("@/lib/AuthContext", () => ({
  useAuth: () => ({ logout: vi.fn() }),
}));

vi.mock("@/hooks/useModelTutor", () => ({
  useModelTutor: () => ({ isSteward: false }),
}));

vi.mock("@/api/animaClient", () => ({
  animaClient: { entities: { ChatSession: { list: async () => [] } } },
}));

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
  it("Home dock always shows five tabs including Moments", () => {
    const onMoments = vi.fn();
    render(
      <MemoryRouter>
        <HomeDock onTalk={() => {}} onMoments={onMoments} />
      </MemoryRouter>,
    );
    expect(screen.getByRole("button", { name: "Talk" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "People" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "World" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "You" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Moments" }));
    expect(onMoments).toHaveBeenCalled();
  });
});
