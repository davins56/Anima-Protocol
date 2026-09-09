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
  peekMe: vi.fn(),
  filter: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  listAnima: vi.fn(),
  listCharacter: vi.fn(),
}));

vi.mock("@/api/base44Client", () => ({
  base44: {
    auth: { me: affirmationMocks.me, peekMe: affirmationMocks.peekMe },
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
  return {
    ...actual,
    STORE_FETCH_TIMEOUT_MS: 50,
    STORE_LIST_TIMEOUT_MS: 50,
    STORE_AUTH_WAIT_MS: 20,
    STORE_TOKEN_TIMEOUT_MS: 0,
    BOOTSTRAP_UI_TIMEOUT_MS: 50,
  };
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
    affirmationMocks.peekMe.mockReturnValue({ email: "operator@example.com" });
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

  it("loads account affirmations once peekMe hydrates email while auth.me hangs", async () => {
    affirmationMocks.me.mockReturnValue(new Promise(() => {}));
    let peekCalls = 0;
    affirmationMocks.peekMe.mockImplementation(() => {
      peekCalls += 1;
      return peekCalls < 2 ? {} : { email: "operator@example.com" };
    });
    affirmationMocks.filter.mockResolvedValue([
      { id: "acct-7", text: "Hydrated email keeps this vow.", category: "love" },
    ]);
    renderPage();

    expect(screen.getByText(/Attuning frequency/i)).toBeTruthy();
    expect(await screen.findByText("Hydrated email keeps this vow.")).toBeTruthy();
    expect(screen.queryByText(AFFIRMATION_LOAD_TIMEOUT)).toBeNull();
    expect(screen.queryByText("I am healthy, wealthy, and wise.")).toBeNull();
    expect(affirmationMocks.filter).toHaveBeenCalled();
  });

  it("loads account affirmations when auth.me never settles but peek has email", async () => {
    affirmationMocks.me.mockReturnValue(new Promise(() => {}));
    affirmationMocks.filter.mockResolvedValue([
      { id: "acct-6", text: "Profile GET cannot own this vow.", category: "healing" },
    ]);
    renderPage();

    expect(screen.getByText(/Attuning frequency/i)).toBeTruthy();
    expect(await screen.findByText("Profile GET cannot own this vow.")).toBeTruthy();
    expect(screen.queryByText(/Attuning frequency/i)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(AFFIRMATION_LOAD_TIMEOUT)).toBeNull();
    expect(screen.queryByText("I am healthy, wealthy, and wise.")).toBeNull();
    expect(affirmationMocks.filter).toHaveBeenCalled();
    expect(affirmationMocks.create).not.toHaveBeenCalled();
  });

  it("clears Attuning when auth.me never settles and peek has no email", async () => {
    affirmationMocks.me.mockReturnValue(new Promise(() => {}));
    affirmationMocks.peekMe.mockReturnValue({});
    renderPage();

    expect(screen.getByText(/Attuning frequency/i)).toBeTruthy();
    expect(await screen.findByText("Sacred Space")).toBeTruthy();
    expect(screen.queryByText(/Attuning frequency/i)).toBeNull();
    expect((await screen.findByRole("alert")).textContent).toBe(
      AFFIRMATION_LOAD_TIMEOUT,
    );
    expect(screen.getByText("I am healthy, wealthy, and wise.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Affirmations/i })).toBeTruthy();
    expect(affirmationMocks.filter).not.toHaveBeenCalled();
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
    expect(screen.getByRole("button", { name: /^Retry$/i })).toBeTruthy();
    expect(affirmationMocks.create).not.toHaveBeenCalled();
  });

  it("loads account affirmations after a first list timeout once auth settles", async () => {
    const timeout = Object.assign(
      new Error("The server took too long to respond. Check your connection."),
      { code: "timeout" },
    );
    affirmationMocks.filter
      .mockRejectedValueOnce(timeout)
      .mockResolvedValueOnce([
        { id: "acct-1", text: "I keep my own vow.", category: "healing" },
      ]);
    renderPage();

    expect(await screen.findByText("I keep my own vow.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(AFFIRMATION_LOAD_TIMEOUT)).toBeNull();
    expect(screen.queryByText("I am healthy, wealthy, and wise.")).toBeNull();
    expect(affirmationMocks.filter).toHaveBeenCalledTimes(2);
  });

  it("shows in-memory defaults without the timeout banner when filter is empty", async () => {
    affirmationMocks.filter.mockResolvedValue([]);
    affirmationMocks.create.mockReturnValue(new Promise(() => {}));
    renderPage();

    expect(await screen.findByText("Sacred Space")).toBeTruthy();
    expect(screen.getByText("I am healthy, wealthy, and wise.")).toBeTruthy();
    expect(screen.queryByText(AFFIRMATION_LOAD_TIMEOUT)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(affirmationMocks.filter).toHaveBeenCalled();
  });

  it("loads account affirmations when auth.me is slow but filter is ready", async () => {
    affirmationMocks.me.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve({ email: "operator@example.com" }), 35);
        }),
    );
    affirmationMocks.filter.mockResolvedValue([
      { id: "acct-4", text: "Profile GET cannot steal this vow.", category: "clarity" },
    ]);
    renderPage();

    expect(await screen.findByText("Profile GET cannot steal this vow.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(AFFIRMATION_LOAD_TIMEOUT)).toBeNull();
    expect(screen.queryByText("I am healthy, wealthy, and wise.")).toBeNull();
  });

  it("populates Anima when filter and Anima.list are both slow", async () => {
    affirmationMocks.filter.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(
            () =>
              resolve([
                {
                  id: "acct-5",
                  text: "Companions cannot starve this vow.",
                  category: "healing",
                },
              ]),
            30,
          );
        }),
    );
    affirmationMocks.listAnima.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(
            () =>
              resolve([
                {
                  id: "anima-serenity",
                  name: "Serenity",
                  assigned_user: "operator@example.com",
                },
              ]),
            30,
          );
        }),
    );
    renderPage();

    expect(
      await screen.findByText("Companions cannot starve this vow."),
    ).toBeTruthy();
    expect(await screen.findByText(/Serenity · Wellness Protocol/)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(AFFIRMATION_LOAD_TIMEOUT)).toBeNull();
  });

  it("keeps account affirmations when Character.list never settles", async () => {
    affirmationMocks.filter.mockResolvedValue([
      { id: "acct-3", text: "Roster cannot steal this vow.", category: "strength" },
    ]);
    affirmationMocks.listCharacter.mockReturnValue(new Promise(() => {}));
    affirmationMocks.listAnima.mockReturnValue(new Promise(() => {}));
    renderPage();

    expect(await screen.findByText("Roster cannot steal this vow.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(AFFIRMATION_LOAD_TIMEOUT)).toBeNull();
    expect(screen.queryByText("I am healthy, wealthy, and wise.")).toBeNull();
    expect(screen.queryByText(/Attuning frequency/i)).toBeNull();
    expect(affirmationMocks.filter).toHaveBeenCalledTimes(1);
  });

  it("retries Sacred Space after a timeout instead of leaving sticky defaults", async () => {
    affirmationMocks.filter
      .mockReturnValueOnce(new Promise(() => {}))
      .mockReturnValueOnce(new Promise(() => {}))
      .mockResolvedValueOnce([
        { id: "acct-2", text: "I return after sync.", category: "clarity" },
      ]);
    renderPage();

    expect((await screen.findByRole("alert")).textContent).toBe(
      AFFIRMATION_LOAD_TIMEOUT,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Retry$/i }));
    expect(await screen.findByText("I return after sync.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(AFFIRMATION_LOAD_TIMEOUT)).toBeNull();
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
    affirmationMocks.peekMe.mockReturnValue({});
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
