import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";

vi.mock("@/api/animaApi", () => ({
  animaApi: {
    chat: {
      companionMemory: vi.fn(),
      updateCompanionMemory: vi.fn(),
      forgetCompanionMemory: vi.fn(),
    },
  },
}));

import { animaApi } from "@/api/animaApi";
import WhatSheRemembers from "./WhatSheRemembers";

const review = {
  about_you: [
    {
      fact_id: "user-name",
      text: "The human's name is Sam.",
      section: "about_you",
      kind_label: "Something about you",
      importance_hint: "She holds onto this",
      about: "user",
      memory_class: "semantic",
      protected: false,
      editable: true,
      importance: 0.91,
      confidence: 0.88,
    },
  ],
  companion: [
    {
      fact_id: "her-key",
      text: "Natasha kept the key.",
      section: "companion",
      kind_label: "Something that happened",
      importance_hint: "Worth remembering",
      about: "companion",
      memory_class: "episodic",
      protected: false,
      editable: true,
      importance: 0.55,
    },
  ],
  core: [
    {
      fact_id: "core-name",
      text: "Protected identity proposal (not applied): Natasha Romanoff — is Natasha Romanoff.",
      section: "core",
      kind_label: "Identity proposal",
      importance_hint: null,
      about: "companion",
      memory_class: "core",
      protected: true,
      editable: false,
      importance: 0.97,
    },
  ],
};

function renderScreen() {
  return render(
    <MemoryRouter initialEntries={["/what-she-remembers/natasha?name=Natasha&from=%2Fchat%2Fsess-1"]}>
      <Routes>
        <Route path="/what-she-remembers/:characterId" element={<WhatSheRemembers />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("What she remembers", () => {
  it("shows an empty line when she has not remembered anything", async () => {
    animaApi.chat.companionMemory.mockResolvedValue({
      review: { about_you: [], companion: [], core: [] },
    });
    renderScreen();
    expect((await screen.findByTestId("memory-empty")).textContent).toContain(
      "Natasha hasn't remembered anything yet.",
    );
    expect(screen.getByRole("heading", { name: "What Natasha remembers" })).toBeTruthy();
  });

  it("keeps your facts, her memories, and protected proposals apart", async () => {
    animaApi.chat.companionMemory.mockResolvedValue({ review });
    renderScreen();
    const aboutYou = await screen.findByTestId("memory-section-about-you");
    const hers = screen.getByTestId("memory-section-companion");
    const core = screen.getByTestId("memory-section-core");
    expect(aboutYou.textContent).toContain("The human's name is Sam.");
    expect(aboutYou.textContent).toContain("She holds onto this");
    expect(aboutYou.textContent).not.toContain("kept the key");
    expect(hers.textContent).toContain("Natasha kept the key.");
    expect(hers.textContent).not.toContain("name is Sam");
    expect(core.textContent).toContain("Protected");
    expect(core.querySelector("button")).toBeNull();
    expect(document.body.textContent).not.toContain("0.91");
    expect(document.body.textContent).not.toContain("0.97");
    expect(screen.getAllByRole("button", { name: "Correct" }).length).toBeGreaterThan(0);
    const correct = screen.getAllByRole("button", { name: "Correct" })[0];
    expect(correct.className).toContain("min-h-11");
  });

  it("corrects and forgets only after the confirm step", async () => {
    animaApi.chat.companionMemory.mockResolvedValue({ review });
    animaApi.chat.updateCompanionMemory.mockResolvedValue({
      review: {
        ...review,
        about_you: [{ ...review.about_you[0], text: "The human's name is Samuel.", importance: undefined }],
      },
    });
    animaApi.chat.forgetCompanionMemory.mockResolvedValue({
      review: { ...review, companion: [] },
    });
    renderScreen();
    await screen.findByText("The human's name is Sam.");

    fireEvent.click(screen.getAllByRole("button", { name: "Correct" })[0]);
    const field = screen.getByLabelText("Correct this memory");
    fireEvent.change(field, { target: { value: "The human's name is Samuel." } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(animaApi.chat.updateCompanionMemory).toHaveBeenCalledWith(
        "natasha",
        "user-name",
        "The human's name is Samuel.",
      );
    });

    fireEvent.click(within(screen.getByTestId("memory-section-companion")).getByRole("button", { name: "Forget" }));
    expect(animaApi.chat.forgetCompanionMemory).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Forget it" }));
    await waitFor(() => {
      expect(animaApi.chat.forgetCompanionMemory).toHaveBeenCalledWith("natasha", "her-key");
    });
  });

  it("clears the previous companion when the character changes", async () => {
    animaApi.chat.companionMemory.mockImplementation((id) => {
      if (id === "clint") return Promise.reject(new Error("Could not open"));
      return Promise.resolve({ review });
    });
    function Switcher() {
      const navigate = useNavigate();
      return (
        <button type="button" onClick={() => navigate("/what-she-remembers/clint?name=Clint")}>
          Open Clint
        </button>
      );
    }
    render(
      <MemoryRouter initialEntries={["/what-she-remembers/natasha?name=Natasha"]}>
        <Routes>
          <Route
            path="/what-she-remembers/:characterId"
            element={
              <>
                <Switcher />
                <WhatSheRemembers />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByText("The human's name is Sam.");
    fireEvent.click(screen.getByRole("button", { name: "Open Clint" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(document.body.textContent).not.toContain("The human's name is Sam.");
    expect(document.body.textContent).not.toContain("kept the key");
  });

  it("ignores a correction that finishes after the companion changes", async () => {
    let finishEdit = () => {};
    animaApi.chat.companionMemory.mockImplementation((id) => {
      if (id === "clint") {
        return Promise.resolve({ review: { about_you: [], companion: [], core: [] } });
      }
      return Promise.resolve({ review });
    });
    animaApi.chat.updateCompanionMemory.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishEdit = () =>
            resolve({
              review: {
                ...review,
                about_you: [{ ...review.about_you[0], text: "The human's name is Samuel." }],
              },
            });
        }),
    );
    function Switcher() {
      const navigate = useNavigate();
      return (
        <button type="button" onClick={() => navigate("/what-she-remembers/clint?name=Clint")}>
          Open Clint
        </button>
      );
    }
    render(
      <MemoryRouter initialEntries={["/what-she-remembers/natasha?name=Natasha"]}>
        <Routes>
          <Route
            path="/what-she-remembers/:characterId"
            element={
              <>
                <Switcher />
                <WhatSheRemembers />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByText("The human's name is Sam.");
    fireEvent.click(screen.getAllByRole("button", { name: "Correct" })[0]);
    fireEvent.change(screen.getByLabelText("Correct this memory"), {
      target: { value: "The human's name is Samuel." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.click(screen.getByRole("button", { name: "Open Clint" }));
    expect(await screen.findByText("Clint hasn't remembered anything yet.")).toBeTruthy();
    finishEdit();
    await waitFor(() => {
      expect(document.body.textContent).not.toContain("The human's name is Samuel.");
    });
    expect(document.body.textContent).not.toContain("The human's name is Sam.");
  });
});
