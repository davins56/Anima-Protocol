import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

const mocks = vi.hoisted(() => ({
  listAnima: vi.fn(),
  listCharacter: vi.fn(),
  whenBootstrapReady: vi.fn(),
  waitForStoreAuth: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
  };
});

vi.mock("@/api/base44Client", () => ({
  base44: {
    entities: {
      Anima: { list: mocks.listAnima },
      Character: { list: mocks.listCharacter },
    },
  },
  waitForStoreAuth: mocks.waitForStoreAuth,
}));

vi.mock("@/lib/syncBootstrap", () => ({
  whenBootstrapReady: mocks.whenBootstrapReady,
}));

vi.mock("@/components/character/CharacterCustomizer", () => ({
  default: ({ characterId, isAnima, storeEntity }) => (
    <div>
      Customizer {characterId} {isAnima ? "anima" : "character"} {storeEntity}
    </div>
  ),
}));

import CharacterCustomization from "./CharacterCustomization";

function renderPage(search = "?tab=animas") {
  return render(
    <MemoryRouter initialEntries={[`/customize${search}`]}>
      <CharacterCustomization />
    </MemoryRouter>,
  );
}

describe("Customization hub Animas picker", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.whenBootstrapReady.mockResolvedValue(undefined);
    mocks.waitForStoreAuth.mockResolvedValue("token");
    mocks.listAnima.mockResolvedValue([]);
    mocks.listCharacter.mockResolvedValue([]);
  });

  it("lists Serenity and a generator companion on the Animas tab", async () => {
    mocks.listAnima.mockResolvedValue([
      {
        id: "anima-serenity",
        name: "Serenity",
        created_date: "2026-01-01T00:00:00.000Z",
      },
    ]);
    mocks.listCharacter.mockResolvedValue([
      {
        id: "char-aelindra",
        name: "Aelindra",
        creation_method: "ai_prompt",
        created_date: "2026-09-05T00:00:00.000Z",
      },
      {
        id: "char-naruto",
        name: "Naruto",
        universe: "Naruto",
        created_date: "2026-09-04T00:00:00.000Z",
      },
    ]);

    renderPage("?tab=animas");

    expect(await screen.findByRole("button", { name: "Select Aelindra" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Select Serenity" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Select Naruto" })).toBeNull();
    expect(screen.getByText(/Animas \(2\)/i)).toBeTruthy();
  });

  it("opens customize for a generator companion from the Animas picker", async () => {
    mocks.listAnima.mockResolvedValue([
      {
        id: "anima-serenity",
        name: "Serenity",
        created_date: "2026-01-01T00:00:00.000Z",
      },
    ]);
    mocks.listCharacter.mockResolvedValue([
      {
        id: "char-aelindra",
        name: "Aelindra",
        creation_method: "ai_prompt",
        created_date: "2026-09-05T00:00:00.000Z",
      },
    ]);

    renderPage("?tab=animas");
    fireEvent.click(await screen.findByRole("button", { name: "Select Aelindra" }));

    await waitFor(() => {
      expect(screen.getByText("Customizer char-aelindra anima Character")).toBeTruthy();
    });
  });

  it("keeps generator companions off the Characters roster tab", async () => {
    mocks.listAnima.mockResolvedValue([]);
    mocks.listCharacter.mockResolvedValue([
      {
        id: "char-aelindra",
        name: "Aelindra",
        creation_method: "ai_prompt",
      },
      {
        id: "char-naruto",
        name: "Naruto",
        universe: "Naruto",
      },
    ]);

    renderPage("?tab=characters");

    expect(await screen.findByRole("button", { name: "Select Naruto" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Select Aelindra" })).toBeNull();
  });
});
