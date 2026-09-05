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
  updateAnima: vi.fn(),
  updateCharacter: vi.fn(),
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
      Anima: { list: mocks.listAnima, update: mocks.updateAnima },
      Character: { list: mocks.listCharacter, update: mocks.updateCharacter },
    },
    integrations: { Core: { InvokeLLM: vi.fn() } },
  },
}));

vi.mock("@/components/anima/SpeakToAnimaButton", () => ({
  default: () => null,
}));

vi.mock("@/components/voice/CustomAnimaVoiceStatus", () => ({
  default: () => null,
}));

import CharacterCustomizer from "./CharacterCustomizer";

function renderCustomizer(props) {
  return render(
    <MemoryRouter>
      <CharacterCustomizer {...props} />
    </MemoryRouter>,
  );
}

describe("CharacterCustomizer companion store", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listAnima.mockResolvedValue([]);
    mocks.listCharacter.mockResolvedValue([]);
    mocks.updateAnima.mockResolvedValue({});
    mocks.updateCharacter.mockResolvedValue({});
  });

  it("loads and saves a generator companion from Character, then opens look", async () => {
    mocks.listCharacter.mockResolvedValue([
      {
        id: "char-aelindra",
        name: "Aelindra",
        creation_method: "ai_prompt",
        avatar_url: "https://example.com/aelindra.png",
        personality: "Calm",
      },
    ]);

    renderCustomizer({
      characterId: "char-aelindra",
      isAnima: true,
      storeEntity: "Character",
    });

    expect(await screen.findByDisplayValue("Aelindra")).toBeTruthy();
    expect(screen.getByDisplayValue("https://example.com/aelindra.png")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Look \/ photo/i }));
    expect(mocks.navigate).toHaveBeenCalledWith(
      "/customise-anima?anima=char-aelindra&tab=look",
    );

    fireEvent.click(screen.getByRole("button", { name: /Save Changes/i }));
    await waitFor(() => {
      expect(mocks.updateCharacter).toHaveBeenCalled();
    });
    expect(mocks.updateAnima).not.toHaveBeenCalled();
    const [, patch] = mocks.updateCharacter.mock.calls[0];
    expect(patch.name).toBe("Aelindra");
    expect(patch._storeEntity).toBeUndefined();
  });
});
