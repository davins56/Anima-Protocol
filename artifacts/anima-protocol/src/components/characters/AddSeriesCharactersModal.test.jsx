import { describe, it, expect, beforeEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { searchStarterSeriesMock, getStarterSeriesByIdMock, upsertCharactersMock } = vi.hoisted(() => ({
  searchStarterSeriesMock: vi.fn(),
  getStarterSeriesByIdMock: vi.fn(),
  upsertCharactersMock: vi.fn(),
}));

vi.mock("@/lib/seedCharacters", () => ({
  searchStarterSeries: searchStarterSeriesMock,
  getStarterSeriesById: getStarterSeriesByIdMock,
  upsertCharacters: upsertCharactersMock,
}));

import AddSeriesCharactersModal from "./AddSeriesCharactersModal";

function renderModal(props = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <AddSeriesCharactersModal
        open
        existingIds={new Set()}
        onClose={() => {}}
        onAdded={() => Promise.resolve()}
        {...props}
      />,
    );
  });
  return { container, root };
}

describe("AddSeriesCharactersModal", () => {
  beforeEach(() => {
    searchStarterSeriesMock.mockReset();
    getStarterSeriesByIdMock.mockReset();
    upsertCharactersMock.mockReset();
  });

  it("shows a loading message while preloaded characters are being added", async () => {
    const series = {
      id: "korra",
      name: "Avatar: Legend of Korra",
      characters: [{ id: "korra-1", name: "Korra", category: "warrior" }],
    };

    searchStarterSeriesMock.mockReturnValue([series]);
    getStarterSeriesByIdMock.mockReturnValue(series);

    let resolveAdded;
    const onAdded = vi.fn(() => new Promise((resolve) => { resolveAdded = resolve; }));
    upsertCharactersMock.mockResolvedValue({ added: 1, skipped: 0 });

    const { container, root } = renderModal({ onAdded });

    const input = container.querySelector("input");
    await act(async () => {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      nativeInputValueSetter.call(input, "korra");
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    const addButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Add")
    );

    await act(async () => {
      addButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("Preparing your library");

    await act(async () => {
      resolveAdded();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Added 1 character");

    act(() => {
      root.unmount();
      container.remove();
    });
  });
});
