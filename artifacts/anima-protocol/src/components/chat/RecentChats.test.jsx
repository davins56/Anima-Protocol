import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import RecentChats from "./RecentChats";

const navigate = vi.hoisted(() => vi.fn());

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigate,
  };
});

function renderList(props = {}) {
  return render(
    <MemoryRouter>
      <RecentChats {...props} />
    </MemoryRouter>,
  );
}

describe("RecentChats", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows an empty state that points to create companion and start chat", () => {
    const onNewSession = vi.fn();
    const onCreateCompanion = vi.fn();
    renderList({ sessions: [], onNewSession, onCreateCompanion });

    expect(screen.getByTestId("recent-chats-empty").textContent).toMatch(
      /No conversations yet/i,
    );
    fireEvent.click(screen.getByRole("button", { name: /Create companion/i }));
    expect(onCreateCompanion).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /Start a chat/i }));
    expect(onNewSession).toHaveBeenCalledTimes(1);
  });

  it("opens an existing session by id instead of starting a new one", () => {
    renderList({
      sessions: [
        {
          id: "sess-9",
          title: "Lumen",
          last_message: "The hall is still empty.",
          updated_date: new Date().toISOString(),
          character_id: "c1",
          mode: "solo",
        },
      ],
      characters: [{ id: "c1", name: "Lumen", avatar_url: "/api/storage/lumen.webp" }],
    });

    expect(screen.getByText("Lumen")).toBeTruthy();
    expect(screen.getByText("The hall is still empty.")).toBeTruthy();
    fireEvent.click(screen.getByTestId("recent-chat-sess-9"));
    expect(navigate).toHaveBeenCalledWith("/chat/sess-9");
  });

  it("uses onOpen when provided so the chat hub can resume without a new session", () => {
    const onOpen = vi.fn();
    renderList({
      sessions: [{ id: "s1", title: "Korra", last_message: "Ready." }],
      onOpen,
    });
    fireEvent.click(screen.getByTestId("recent-chat-s1"));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "s1" }));
    expect(navigate).not.toHaveBeenCalled();
  });
});
