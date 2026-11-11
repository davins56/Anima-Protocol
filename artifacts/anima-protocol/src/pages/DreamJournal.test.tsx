import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { DreamJournalError } from "@/lib/dreamJournal";

const hooks = vi.hoisted(() => ({
  journal: {
    dreams: [] as Record<string, unknown>[],
    hasMore: false,
    dreamingEnabled: true,
    unreadCount: 0,
    isDreaming: false,
    loading: false,
    saving: false,
    error: null as Error | null,
    unavailable: false,
    available: true,
    loadMore: vi.fn(),
    refresh: vi.fn(),
    setLetHerDream: vi.fn(),
    rememberRead: vi.fn(),
  },
  continuity: {
    isDreaming: false,
    presence: "resting",
    presenceLabel: "She is resting",
    lastDreamAt: null,
    recentDreams: [] as Record<string, unknown>[],
    ready: true,
  },
  navigate: vi.fn(),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => hooks.navigate,
  };
});

vi.mock("@/hooks/useDreamJournal", () => ({
  useDreamJournal: () => hooks.journal,
}));

vi.mock("@/hooks/useIsDreaming", () => ({
  useIsDreaming: () => hooks.continuity,
}));

vi.mock("@/api/animaClient", () => ({
  animaClient: {
    entities: {
      Character: { list: vi.fn().mockResolvedValue([]) },
      Anima: { list: vi.fn().mockResolvedValue([{ id: "c1", name: "Aeland" }]) },
    },
  },
}));

import DreamJournal from "./DreamJournal";

function renderPage(path = "/dreams/c1?name=Aeland") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/dreams/:characterId?" element={<DreamJournal />} />
      </Routes>
    </MemoryRouter>,
  );
}

const sampleDream = {
  id: "d1",
  created_at: "2026-11-10T12:00:00.000Z",
  mood: "wistful",
  themes: ["lantern"],
  summary: "A hall of glass kept a single lantern.",
  fragment: "I kept a lantern in the empty hall.",
  read: false,
};

describe("DreamJournal page", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    hooks.navigate.mockReset();
    hooks.journal.dreams = [];
    hooks.journal.hasMore = false;
    hooks.journal.dreamingEnabled = true;
    hooks.journal.unreadCount = 0;
    hooks.journal.loading = false;
    hooks.journal.saving = false;
    hooks.journal.error = null;
    hooks.journal.unavailable = false;
    hooks.journal.setLetHerDream = vi.fn();
    hooks.journal.rememberRead = vi.fn();
    hooks.journal.refresh = vi.fn();
    hooks.journal.loadMore = vi.fn();
    hooks.continuity.isDreaming = false;
    hooks.continuity.recentDreams = [];
  });

  it("lists dreams newest first with a mood tag and opens a detail view", async () => {
    hooks.journal.dreams = [
      sampleDream,
      { ...sampleDream, id: "d0", mood: null, summary: "An older quiet sea.", fragment: "The tide.", created_at: "2026-11-01T12:00:00.000Z" },
    ];
    renderPage();
    await waitFor(() => expect(screen.getByTestId("dream-card-d1")).toBeTruthy());
    const list = screen.getByRole("list", { name: /Dreams, newest first/i });
    const cards = list.querySelectorAll("button");
    expect(cards[0].textContent).toContain("A hall of glass");
    expect(cards[0].textContent).toMatch(/wistful/i);
    expect(cards[1].textContent).toContain("An older quiet sea.");
    expect(screen.queryByTestId("dream-detail")).toBeNull();
    fireEvent.click(screen.getByTestId("dream-card-d1"));
    expect(hooks.journal.rememberRead).toHaveBeenCalledWith("d1");
    expect(screen.getByTestId("dream-detail").textContent).toContain("A hall of glass kept a single lantern.");
    expect(screen.getByTestId("dream-detail").textContent).toContain("I kept a lantern in the empty hall.");
  });

  it("shows not available yet when the journal API is missing", async () => {
    hooks.journal.unavailable = true;
    hooks.journal.error = new DreamJournalError("unavailable", 404);
    hooks.continuity.isDreaming = true;
    renderPage();
    await waitFor(() => expect(screen.getByTestId("dream-journal-unavailable")).toBeTruthy());
    expect(screen.getByTestId("dream-journal-unavailable").textContent).toMatch(/not available yet/i);
    expect(screen.getByText(/is dreaming right now/i)).toBeTruthy();
    expect(screen.getByTestId("let-her-dream")).toBeTruthy();
    expect(screen.getByText(/will not stop new dreams/i)).toBeTruthy();
  });

  it("prefills chat with What did you dream? and does not auto-send", async () => {
    renderPage();
    fireEvent.click(screen.getByTestId("ask-what-did-you-dream"));
    expect(hooks.navigate).toHaveBeenCalledWith("/chat?compose=What+did+you+dream%3F&character=c1");
    const url = hooks.navigate.mock.calls[0][0] as string;
    expect(url).not.toMatch(/send=|auto=/);
  });

  it("toggles Let her dream", async () => {
    renderPage();
    fireEvent.click(screen.getByTestId("let-her-dream"));
    expect(hooks.journal.setLetHerDream).toHaveBeenCalledWith(false);
  });
});
