import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { FEATURE_MESSAGING } from "@/lib/featureMessaging";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  me: vi.fn(),
  listSessions: vi.fn(),
  listAnimas: vi.fn(),
  listCheckIns: vi.fn(),
  updateMe: vi.fn(),
  whenBootstrapReady: vi.fn(),
  presence: { dream: null, echo: null },
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
  };
});

vi.mock("@/api/base44Client", () => ({
  uploadDataUrl: vi.fn(),
  urlToDataUrl: vi.fn(),
  base44: {
    auth: { me: mocks.me, updateMe: mocks.updateMe },
    entities: {
      ChatSession: { list: mocks.listSessions },
      Anima: { list: mocks.listAnimas, update: vi.fn() },
      CheckIn: { list: mocks.listCheckIns },
    },
  },
}));

vi.mock("@/lib/useStoreSync", () => ({
  useStoreSync: () => {},
}));

vi.mock("@/lib/syncBootstrap", () => ({
  whenBootstrapReady: () => mocks.whenBootstrapReady(),
}));

vi.mock("@/hooks/useAnimaPresence", () => ({
  useAnimaPresence: () => mocks.presence,
}));

vi.mock("@/components/anima/SerenityPresence", () => ({
  default: () => null,
}));

vi.mock("@/components/anima/AvatarAIEditModal", () => ({
  default: () => null,
}));

vi.mock("@/components/chat/LivingPresence", () => ({
  default: ({ character, onExpand }) => (
    <button type="button" data-living-presence onClick={onExpand}>
      {character?.name || "Companion"}
    </button>
  ),
}));

HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
  clearRect: vi.fn(),
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  stroke: vi.fn(),
}));

import MainHome from "./MainHome";

function renderHome() {
  return render(
    <MemoryRouter>
      <MainHome />
    </MemoryRouter>,
  );
}

describe("MainHome floor", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.presence.dream = null;
    mocks.presence.echo = null;
    mocks.whenBootstrapReady.mockResolvedValue(undefined);
    mocks.me.mockResolvedValue({ email: "operator@example.com", selected_mode: "serenity" });
    mocks.listSessions.mockResolvedValue([]);
    mocks.listAnimas.mockResolvedValue([]);
    mocks.listCheckIns.mockResolvedValue([]);
    mocks.updateMe.mockResolvedValue({});
  });

  it("is a place with a wake line, stage, and four-item dock — not a chat dashboard", async () => {
    renderHome();
    await waitFor(() => {
      expect(document.querySelector("[data-home-dock]")).toBeTruthy();
    });
    const text = document.body.textContent || "";
    expect(text).toMatch(/Talk/);
    expect(text).toMatch(/People/);
    expect(text).toMatch(/World/);
    expect(text).toMatch(/You/);
    expect(text).toMatch(FEATURE_MESSAGING.IDENTITY_DEFAULT);
    expect(text).not.toMatch(/Start Chatting/i);
    expect(text).not.toMatch(/Continue Session/i);
    expect(text).not.toMatch(/New Chat/i);
    expect(text).not.toMatch(/AI COMPANION SYSTEM/i);
    expect(text).not.toMatch(/Quick Access/i);
    expect(text).not.toMatch(/Jack In/);
    expect(document.querySelector("[data-home-status]")?.textContent).toMatch(/Online/);
    expect(document.querySelector("[data-home-create-slot]")).toBeTruthy();
  });

  it("uses the dream as the wake line when they dreamed", async () => {
    mocks.presence.dream = { content: "I kept a lantern in the empty hall." };
    mocks.listAnimas.mockResolvedValue([{ id: "a1", name: "Lumen", tagline: "Quiet hour" }]);
    renderHome();
    await waitFor(() => {
      expect(document.querySelector("[data-home-wake]")?.textContent).toContain(
        "I kept a lantern in the empty hall.",
      );
    });
    expect(document.querySelector("[data-home-tiles]")?.textContent).toContain("Dream");
    expect(document.querySelector("[data-home-tiles]")?.textContent).toContain("I kept a lantern");
  });

  it("omits empty live tiles", async () => {
    renderHome();
    await waitFor(() => {
      expect(document.querySelector("[data-home-tiles]")).toBeTruthy();
    });
    const tiles = document.querySelector("[data-home-tiles]")?.textContent || "";
    expect(tiles).not.toMatch(/Dream/);
    expect(tiles).not.toMatch(/Echo/);
    expect(tiles).not.toMatch(/Waiting/);
  });

  it("does not put six mode tiles on the home floor", async () => {
    renderHome();
    await waitFor(() => {
      expect(document.querySelector("[data-home-dock]")).toBeTruthy();
    });
    expect(document.body.textContent).not.toMatch(/Companion Mode/);
    expect(document.querySelector("[data-home-sheet]")).toBeNull();
  });

  it("opens People / World / You / Recents off the first screen and keeps features reachable", async () => {
    mocks.listAnimas.mockResolvedValue([
      {
        id: "a1",
        name: "Lumen",
        tagline: "Quiet hour",
        soulprint: { id: "AR-1" },
        resonance: 4,
        avatar_url: "/api/storage/lumen.webp",
      },
    ]);
    mocks.listSessions.mockResolvedValue([
      { id: "s1", title: "Last night", updated_date: new Date().toISOString(), messages: [] },
    ]);
    renderHome();

    await waitFor(() => {
      expect(screen.getByText("Lumen")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "People" }));
    expect(screen.getByLabelText("People")).toBeTruthy();
    expect(screen.getByText("Roster")).toBeTruthy();
    expect(screen.getByText("Group")).toBeTruthy();
    expect(screen.getByText("Create companion")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "World" }));
    expect(screen.getByText("Jack In")).toBeTruthy();
    expect(screen.getByText("Constellation")).toBeTruthy();
    expect(screen.getByText("Echo Keys")).toBeTruthy();
    fireEvent.click(screen.getByText("Jack In"));
    expect(mocks.navigate).toHaveBeenCalledWith("/net-battle");

    fireEvent.click(screen.getByRole("button", { name: "You" }));
    expect(screen.getByText("Customise")).toBeTruthy();
    expect(screen.getByText("Therapy")).toBeTruthy();
    expect(screen.getByText("Settings")).toBeTruthy();
    expect(document.querySelector("[data-home-soulprint]")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "Recents" }));
    expect(screen.getByText("Last night")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "Focus" }));
    expect(screen.getByLabelText("Focus")).toBeTruthy();
    expect(screen.getByText("Angel")).toBeTruthy();
    expect(screen.getByText("Shadow")).toBeTruthy();
    expect(screen.getByText("Creator")).toBeTruthy();
  });

  it("Talk goes into the current presence conversation", async () => {
    mocks.listAnimas.mockResolvedValue([{ id: "a1", name: "Lumen" }]);
    mocks.listSessions.mockResolvedValue([{ id: "sess-9", title: "Now", messages: [] }]);
    renderHome();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Talk" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Talk" }));
    expect(mocks.navigate).toHaveBeenCalledWith("/chat/sess-9");
  });
});
