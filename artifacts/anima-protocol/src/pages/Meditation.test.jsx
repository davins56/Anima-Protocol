import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import {
  AFFIRMATION_AUTH_REQUIRED,
  AFFIRMATION_LOAD_TIMEOUT,
} from "@/lib/affirmationStore";

const affirmationMocks = vi.hoisted(() => ({
  me: vi.fn(),
  filter: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  listAnima: vi.fn(),
  listCharacter: vi.fn(),
}));

vi.mock("@/api/base44Client", () => ({
  base44: {
    auth: { me: affirmationMocks.me },
    entities: {
      Affirmation: {
        filter: affirmationMocks.filter,
        create: affirmationMocks.create,
        update: affirmationMocks.update,
      },
      Anima: { list: affirmationMocks.listAnima },
      Character: { list: affirmationMocks.listCharacter },
    },
  },
}));

vi.mock("@/lib/storeTimeouts", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, BOOTSTRAP_UI_TIMEOUT_MS: 50 };
});

import Meditation from "./Meditation";

function renderPage() {
  return render(
    <MemoryRouter>
      <Meditation />
    </MemoryRouter>,
  );
}

describe("Meditation affirmations", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: { cancel: vi.fn(), speak: vi.fn(), getVoices: () => [] },
    });
    affirmationMocks.me.mockResolvedValue({ email: "operator@example.com" });
    affirmationMocks.filter.mockResolvedValue([]);
    affirmationMocks.create.mockResolvedValue({
      id: "seed-1",
      text: "I am healthy, wealthy, and wise.",
      category: "abundance",
    });
    affirmationMocks.listAnima.mockResolvedValue([]);
    affirmationMocks.listCharacter.mockResolvedValue([]);
  });

  it("shows a visible load error when the store/DB seed fails", async () => {
    affirmationMocks.create.mockRejectedValue(new Error("Database unavailable"));
    renderPage();

    expect(await screen.findByText("Sacred Space")).toBeTruthy();
    expect(screen.getByText("I am healthy, wealthy, and wise.")).toBeTruthy();
    expect((await screen.findByRole("alert")).textContent).toMatch(
      /Database unavailable/,
    );
    expect(screen.queryByText("No affirmations available.")).toBeNull();
    expect(screen.getByText(/All \(12\)/)).toBeTruthy();
    expect(screen.queryByText(/Attuning frequency/i)).toBeNull();
  });

  it("clears Attuning when auth.me never settles and shows defaults", async () => {
    affirmationMocks.me.mockReturnValue(new Promise(() => {}));
    renderPage();

    expect(screen.getByText(/Attuning frequency/i)).toBeTruthy();
    expect(await screen.findByText("Sacred Space")).toBeTruthy();
    expect(screen.queryByText(/Attuning frequency/i)).toBeNull();
    expect((await screen.findByRole("alert")).textContent).toBe(
      AFFIRMATION_LOAD_TIMEOUT,
    );
    expect(screen.getByText("I am healthy, wealthy, and wise.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Affirmations/i })).toBeTruthy();
    expect(affirmationMocks.create).not.toHaveBeenCalled();
  });

  it("clears Attuning when affirmation filter never settles and shows defaults", async () => {
    affirmationMocks.filter.mockReturnValue(new Promise(() => {}));
    renderPage();

    expect(screen.getByText(/Attuning frequency/i)).toBeTruthy();
    expect(await screen.findByText("Sacred Space")).toBeTruthy();
    expect(screen.queryByText(/Attuning frequency/i)).toBeNull();
    expect((await screen.findByRole("alert")).textContent).toBe(
      AFFIRMATION_LOAD_TIMEOUT,
    );
    expect(screen.getByText("I am healthy, wealthy, and wise.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Ritual/i })).toBeTruthy();
    expect(affirmationMocks.create).not.toHaveBeenCalled();
  });

  it("keeps the Add form open and shows why create failed", async () => {
    affirmationMocks.filter.mockResolvedValue([
      { id: "existing", text: "I am already here.", category: "healing" },
    ]);
    affirmationMocks.create.mockRejectedValue(new Error("Database unavailable"));
    renderPage();

    expect(await screen.findByText("I am already here.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Add Affirmation/i }));

    const field = screen.getByPlaceholderText("Write your affirmation...");
    fireEvent.change(field, { target: { value: "My body heals itself." } });
    fireEvent.click(screen.getByRole("button", { name: /Add$/i }));

    expect((await screen.findByRole("alert")).textContent).toMatch(
      /Database unavailable/,
    );
    expect(field.value).toBe("My body heals itself.");
    expect(screen.getByPlaceholderText("Write your affirmation...")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Add Affirmation/i })).toBeNull();
  });

  it("shows a sign-in error when Add is clicked without a session", async () => {
    const unauthorized = new Error("Unauthorized");
    unauthorized.status = 401;
    affirmationMocks.me.mockRejectedValue(unauthorized);
    renderPage();

    expect((await screen.findByRole("alert")).textContent).toMatch(
      AFFIRMATION_AUTH_REQUIRED,
    );
    fireEvent.click(screen.getByRole("button", { name: /Add Affirmation/i }));
    fireEvent.change(screen.getByPlaceholderText("Write your affirmation..."), {
      target: { value: "I am safe." },
    });
    fireEvent.click(screen.getByRole("button", { name: /Add$/i }));

    await waitFor(() => {
      expect(screen.getAllByRole("alert").some((el) =>
        el.textContent.includes(AFFIRMATION_AUTH_REQUIRED),
      )).toBe(true);
    });
    expect(affirmationMocks.create).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText("Write your affirmation...")).toBeTruthy();
  });
});
